/*
  VelocityPaintOil Engine
  True oil-slick effect — very dark, deeply saturated colors
  (deep purple, dark teal, muted olive) on a near-black base.
  Uses squared color for darkness, 4-layer interference,
  wet darkening pass, and viscous pooling distortion.
*/

import { VERT } from './shaders/vert';
import { PAINT_FRAG, PAINT_FRAG_NOISE, PAINT_FRAG_NOISE_2 } from './shaders/paintFrag';
import { OIL_FRAG } from './shaders/oilFrag';
import { BLUR_FRAG } from './shaders/blurFrag';
import { COPY_FRAG } from './shaders/copyFrag';
import { BG_FRAG } from './shaders/bgFrag';

// ── Config ────────────────────────────────────────────────

export interface VPOilConfig {
  // Brush / Velocity
  pushStrength: number;
  velocityDissipation: number;
  weight1Dissipation: number;
  weight2Dissipation: number;
  accelDissipation: number;
  velCapture: number;
  useNoise: boolean;
  doubleOctaveNoise: boolean;
  noiseScale: number;
  noiseStrength: number;
  minRadius: number;
  maxRadius: number;
  radiusRange: number;
  // Oil-specific
  distortionAmount: number;
  filmThickness: number;
  iridIntensity: number;
  fresnelPower: number;
  flowFreq: number;
  weightFreq: number;
  velocityScale: number;
  edgeShade: number;
  bgOpacity: number;
  viscosity: number;
  darkness: number;
  bgColor: { r: number; g: number; b: number };
}

export const VP_OIL_DEFAULTS: VPOilConfig = {
  pushStrength: 25,
  velocityDissipation: 0.98,
  weight1Dissipation: 0.96,
  weight2Dissipation: 0.85,
  accelDissipation: 0.75,
  velCapture: 0.8,
  useNoise: true,
  doubleOctaveNoise: true,
  noiseScale: 0.02,
  noiseStrength: 2,
  minRadius: 0,
  maxRadius: 100,
  radiusRange: 80,
  // Oil defaults — tuned for dark oil-slick look
  distortionAmount: 8,
  filmThickness: 2.8,
  iridIntensity: 5,
  fresnelPower: 1.8,
  flowFreq: 5,
  weightFreq: 1.2,
  velocityScale: 8,
  edgeShade: 3.5,
  bgOpacity: 1,
  viscosity: 0.7,
  darkness: 1.5,
  bgColor: { r: 4, g: 5, b: 10 },
};


// ── GL Helpers ────────────────────────────────────────────

interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  attach: (unit: number) => number;
}

interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    console.error('Shader error:', gl.getShaderInfoLog(shader));
  return shader;
}

function createShaderProgram(gl: WebGL2RenderingContext, vs: string, fs: string): ShaderProgram {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram()!;
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    console.error('Program error:', gl.getProgramInfoLog(program));

  gl.deleteShader(v);
  gl.deleteShader(f);

  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i)!;
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function createRenderTarget(gl: WebGL2RenderingContext, w: number, h: number): FBO {
  const texture = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return {
    texture, fbo, width: w, height: h,
    attach(unit: number) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      return unit;
    },
  };
}


// ── Main Engine ───────────────────────────────────────────

export class VelocityPaintOilEngine {
  private gl: WebGL2RenderingContext;
  config: VPOilConfig;

  private paintShaderNoise!:  ShaderProgram;
  private paintShaderNoise2!: ShaderProgram;
  private paintShaderFlat!:   ShaderProgram;
  private oilShader!: ShaderProgram;
  private blurShader!: ShaderProgram;
  private copyShader!: ShaderProgram;
  private bgShader!: ShaderProgram;

  private rtPrev!: FBO;
  private rtCurr!: FBO;
  private rtLow!: FBO;
  private rtLowB!: FBO;
  private rtScene!: FBO;
  private rtReady = false;

  private quadVAO!: WebGLVertexArrayObject;

  private segFrom = { x: 0, y: 0, z: 0, w: 0 };
  private segTo   = { x: 0, y: 0, z: 0, w: 0 };
  private motionX = 0;
  private motionY = 0;
  private prevPixX = 0;
  private prevPixY = 0;
  private initialized = false;
  private cursorX = 0;
  private cursorY = 0;
  private cursorPixX = 0;
  private cursorPixY = 0;
  private hasMoved = false;
  private settleFrames = 0;

  private disposed = false;
  private now = 0;
  private bgCache = { r: -1, g: -1, b: -1, aspect: -1 };
  private lowTexelW = 0;
  private lowTexelH = 0;

  private outputFBO: WebGLFramebuffer | null = null;
  private viewportW = 0;
  private viewportH = 0;
  private dpr = 1;

  constructor(gl: WebGL2RenderingContext, config?: Partial<VPOilConfig>) {
    this.gl = gl;
    this.config = { ...VP_OIL_DEFAULTS, ...config };

    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    this.viewportW = gl.drawingBufferWidth;
    this.viewportH = gl.drawingBufferHeight;

    this.buildQuad();
    this.buildShaders();
    this.buildRenderTargets();
    this.resetPaint();
    this.rtReady = true;
  }

  private get paintShader(): ShaderProgram {
    if (!this.config.useNoise) return this.paintShaderFlat;
    return this.config.doubleOctaveNoise ? this.paintShaderNoise2 : this.paintShaderNoise;
  }

  // ── Setup ────────────────────────────────────────────────

  private buildQuad() {
    const gl = this.gl;
    this.quadVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVAO);

    const vbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, -1,1, 1,1, 1,-1]), gl.STATIC_DRAW);

    const ibuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 0,2,3]), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private buildShaders() {
    const gl = this.gl;
    this.paintShaderNoise  = createShaderProgram(gl, VERT, PAINT_FRAG_NOISE);
    this.paintShaderNoise2 = createShaderProgram(gl, VERT, PAINT_FRAG_NOISE_2);
    this.paintShaderFlat   = createShaderProgram(gl, VERT, PAINT_FRAG);
    this.oilShader         = createShaderProgram(gl, VERT, OIL_FRAG);
    this.blurShader        = createShaderProgram(gl, VERT, BLUR_FRAG);
    this.copyShader        = createShaderProgram(gl, VERT, COPY_FRAG);
    this.bgShader          = createShaderProgram(gl, VERT, BG_FRAG);

    for (const ps of [this.paintShaderNoise, this.paintShaderNoise2, this.paintShaderFlat]) {
      gl.useProgram(ps.program);
      gl.uniform2f(ps.uniforms.v_scrollDelta, 0.0, 0.0);
    }
    gl.useProgram(null);

    this.bgCache = { r: -1, g: -1, b: -1, aspect: -1 };
  }

  private buildRenderTargets() {
    const gl = this.gl;
    const pw = this.viewportW >> 2;
    const ph = this.viewportH >> 2;
    const lw = pw >> 1;
    const lh = ph >> 1;

    this.rtPrev = createRenderTarget(gl, pw, ph);
    this.rtCurr = createRenderTarget(gl, pw, ph);
    this.rtLow  = createRenderTarget(gl, lw, lh);
    this.rtLowB = createRenderTarget(gl, lw, lh);

    this.lowTexelW = 1.0 / lw;
    this.lowTexelH = 1.0 / lh;

    const sceneTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8,
      this.viewportW, this.viewportH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const sceneFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    this.rtScene = {
      texture: sceneTex, fbo: sceneFbo, width: this.viewportW, height: this.viewportH,
      attach(unit: number) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, sceneTex);
        return unit;
      },
    };
  }

  private resetPaint() {
    const gl = this.gl;
    const paintClear = new Float32Array([0.5, 0.5, 0.0, 0.0]);
    for (const rt of [this.rtPrev, this.rtCurr, this.rtLow, this.rtLowB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
      gl.viewport(0, 0, rt.width, rt.height);
      gl.clearBufferfv(gl.COLOR, 0, paintClear);
    }
    this.motionX = 0;
    this.motionY = 0;
  }

  // ── Draw ─────────────────────────────────────────────────

  private drawQuad(target: FBO | null) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFBO);
      gl.viewport(0, 0, this.viewportW, this.viewportH);
    }
    gl.bindVertexArray(this.quadVAO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // ── Resize ────────────────────────────────────────────────

  resize(width: number, height: number) {
    if (width === this.viewportW && height === this.viewportH) return;
    this.viewportW = Math.max(width, 1);
    this.viewportH = Math.max(height, 1);
    this.bgCache.aspect = -1;
    this.destroyRenderTargets();
    this.buildRenderTargets();
    this.resetPaint();
    this.rtReady = true;
  }

  // ── VRAM Cleanup ──────────────────────────────────────────

  private destroyRenderTargets() {
    if (!this.rtReady) return;
    const gl = this.gl;
    for (const rt of [this.rtPrev, this.rtCurr, this.rtLow, this.rtLowB, this.rtScene]) {
      if (!rt) continue;
      gl.deleteTexture(rt.texture);
      gl.deleteFramebuffer(rt.fbo);
    }
    this.rtReady = false;
  }

  // ── Paint Pass ───────────────────────────────────────────

  private paintPass(dt: number) {
    const gl = this.gl;
    const cfg = this.config;

    const pw = this.rtCurr.width;
    const ph = this.rtCurr.height;

    const tmp = this.rtPrev;
    this.rtPrev = this.rtCurr;
    this.rtCurr = tmp;

    let dist = 0;
    if (this.initialized) {
      const dx = this.cursorPixX - this.prevPixX;
      const dy = this.cursorPixY - this.prevPixY;
      dist = Math.sqrt(dx * dx + dy * dy);
    }

    let radius = cfg.minRadius + (cfg.maxRadius - cfg.minRadius) *
      Math.min(dist / cfg.radiusRange, 1.0);
    if (!this.hasMoved) radius = 0;
    if (this.settleFrames > 0) { radius = 0; this.settleFrames--; }
    radius = radius / this.viewportH * ph;

    this.segFrom.x = this.segTo.x;
    this.segFrom.y = this.segTo.y;
    this.segFrom.z = this.segTo.z;
    this.segFrom.w = this.segTo.w;

    this.segTo.x = (this.cursorX + 1.0) * pw / 2.0;
    this.segTo.y = (this.cursorY + 1.0) * ph / 2.0;
    this.segTo.z = radius;
    this.segTo.w = 1.0;

    if (!this.initialized) {
      if (this.hasMoved) {
        this.segFrom.x = this.segTo.x;
        this.segFrom.y = this.segTo.y;
        this.segFrom.z = 0;
        this.segFrom.w = 0;
        this.prevPixX  = this.cursorPixX;
        this.prevPixY  = this.cursorPixY;
        this.initialized = true;
      }
      radius = 0;
      this.segTo.z = 0;
      this.segTo.w = 0;
      this.motionX = 0;
      this.motionY = 0;
    }

    const scaledDt = dt * cfg.velCapture;
    const mvx = (this.segTo.x - this.segFrom.x) * scaledDt;
    const mvy = (this.segTo.y - this.segFrom.y) * scaledDt;
    this.motionX = this.motionX * cfg.accelDissipation + mvx;
    this.motionY = this.motionY * cfg.accelDissipation + mvy;

    this.prevPixX = this.cursorPixX;
    this.prevPixY = this.cursorPixY;

    const ps = this.paintShader;
    gl.useProgram(ps.program);
    gl.uniform1i(ps.uniforms.t_blurredPaint, this.rtLow.attach(0));
    gl.uniform1i(ps.uniforms.t_prevFrame,    this.rtPrev.attach(1));
    gl.uniform2f(ps.uniforms.v_texelSize, 1.0 / pw, 1.0 / ph);
    gl.uniform4f(ps.uniforms.p_segFrom,
      this.segFrom.x, this.segFrom.y, this.segFrom.z, this.segFrom.w);
    gl.uniform4f(ps.uniforms.p_segTo,
      this.segTo.x, this.segTo.y, this.segTo.z, this.segTo.w);
    gl.uniform1f(ps.uniforms.p_spread, cfg.pushStrength);
    if (cfg.useNoise) {
      gl.uniform1f(ps.uniforms.n_scale,    cfg.noiseScale);
      gl.uniform1f(ps.uniforms.n_strength, cfg.noiseStrength);
    }
    gl.uniform2f(ps.uniforms.p_motionVec, this.motionX, this.motionY);
    gl.uniform4f(ps.uniforms.p_decay,
      cfg.velocityDissipation,
      cfg.velocityDissipation,
      cfg.weight1Dissipation,
      cfg.weight2Dissipation);
    this.drawQuad(this.rtCurr);

    // Downscale + H-blur
    gl.useProgram(this.blurShader.program);
    gl.uniform1i(this.blurShader.uniforms.t_input, this.rtCurr.attach(0));
    gl.uniform2f(this.blurShader.uniforms.v_texelSize, this.lowTexelW, this.lowTexelH);
    gl.uniform2f(this.blurShader.uniforms.v_blurDir, 1.0, 0.0);
    this.drawQuad(this.rtLowB);

    // V-blur
    gl.uniform1i(this.blurShader.uniforms.t_input, this.rtLowB.attach(0));
    gl.uniform2f(this.blurShader.uniforms.v_blurDir, 0.0, 1.0);
    this.drawQuad(this.rtLow);

    this.hasMoved = false;
  }

  // ── Render Pass (Oil) ─────────────────────────────────────

  private renderPass() {
    const gl = this.gl;

    gl.useProgram(this.bgShader.program);
    const bg = this.config.bgColor;
    const aspect = this.viewportW / this.viewportH;
    if (
      bg.r !== this.bgCache.r || bg.g !== this.bgCache.g || bg.b !== this.bgCache.b ||
      aspect !== this.bgCache.aspect
    ) {
      const r = bg.r / 255, g = bg.g / 255, b = bg.b / 255;
      gl.uniform3f(this.bgShader.uniforms.u_centerColor, r + 0.03, g + 0.03, b + 0.04);
      gl.uniform3f(this.bgShader.uniforms.u_edgeColor, r, g, b);
      gl.uniform1f(this.bgShader.uniforms.u_aspect, aspect);
      this.bgCache = { r: bg.r, g: bg.g, b: bg.b, aspect };
    }
    gl.uniform1f(this.bgShader.uniforms.u_time, this.now * 0.001);
    this.drawQuad(this.rtScene);

    if (this.config.distortionAmount > 0) {
      gl.useProgram(this.oilShader.program);
      gl.uniform1i(this.oilShader.uniforms.t_scene,    this.rtScene.attach(0));
      gl.uniform1i(this.oilShader.uniforms.t_velPaint, this.rtCurr.attach(1));
      gl.uniform2f(this.oilShader.uniforms.v_paintTexel,
        1.0 / this.rtCurr.width, 1.0 / this.rtCurr.height);
      gl.uniform1f(this.oilShader.uniforms.p_stepScale,
        this.config.distortionAmount * this.config.velocityScale * 0.25);
      gl.uniform1f(this.oilShader.uniforms.p_filmThickness, this.config.filmThickness);
      gl.uniform1f(this.oilShader.uniforms.p_iridIntensity, this.config.iridIntensity);
      gl.uniform1f(this.oilShader.uniforms.p_fresnelPower,  this.config.fresnelPower);
      gl.uniform1f(this.oilShader.uniforms.p_edgeShade,     this.config.edgeShade);
      gl.uniform1f(this.oilShader.uniforms.p_flowFreq,      this.config.flowFreq);
      gl.uniform1f(this.oilShader.uniforms.p_weightFreq,    this.config.weightFreq);
      gl.uniform1f(this.oilShader.uniforms.p_bgOpacity,     this.config.bgOpacity);
      gl.uniform1f(this.oilShader.uniforms.p_time,          this.now * 0.001);
      gl.uniform1f(this.oilShader.uniforms.p_viscosity,     this.config.viscosity);
      gl.uniform1f(this.oilShader.uniforms.p_darkness,      this.config.darkness);
      this.drawQuad(null);
    } else {
      gl.useProgram(this.copyShader.program);
      gl.uniform1i(this.copyShader.uniforms.t_input, this.rtScene.attach(0));
      this.drawQuad(null);
    }
  }

  // ── Public API ─────────────────────────────────────────────

  setOutputFramebuffer(fbo: WebGLFramebuffer | null) {
    this.outputFBO = fbo;
  }

  update(dt: number, now?: number) {
    if (this.disposed || !this.rtReady) return;
    this.now = now ?? performance.now();
    this.gl.disable(this.gl.BLEND);
    this.paintPass(dt);
    this.renderPass();
  }

  resetCursorState() {
    this.initialized = false;
    this.hasMoved    = false;
    this.motionX     = 0;
    this.motionY     = 0;
    this.segFrom.x = this.segFrom.y = this.segFrom.z = this.segFrom.w = 0;
    this.segTo.x   = this.segTo.y   = this.segTo.z   = this.segTo.w   = 0;
    this.settleFrames = 2;
  }

  onMove(clientX: number, clientY: number, rect: DOMRect) {
    this.cursorPixX = (clientX - rect.left) * this.dpr;
    this.cursorPixY = (clientY - rect.top)  * this.dpr;
    this.cursorX =  (this.cursorPixX / this.viewportW)  * 2.0 - 1.0;
    this.cursorY = -((this.cursorPixY / this.viewportH) * 2.0 - 1.0);
    this.hasMoved = true;
  }

  setDPR(dpr: number) {
    this.dpr = dpr;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    this.destroyRenderTargets();

    const gl = this.gl;
    gl.deleteProgram(this.paintShaderNoise.program);
    gl.deleteProgram(this.paintShaderNoise2.program);
    gl.deleteProgram(this.paintShaderFlat.program);
    gl.deleteProgram(this.oilShader.program);
    gl.deleteProgram(this.blurShader.program);
    gl.deleteProgram(this.copyShader.program);
    gl.deleteProgram(this.bgShader.program);

    gl.deleteVertexArray(this.quadVAO);
  }
}
