/*
  VelocityPaint Engine — v3
  Standalone WebGL2 velocity-painting + screen distortion.
  Zero external dependencies.
*/

// ── Config ────────────────────────────────────────────────

export interface VPConfig {
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
  distortionAmount: number;
  chromaticShift: number;
  velocityScale: number;
  colorBoost: number;
  edgeShade: number;
  bgColor: { r: number; g: number; b: number };
}

export const VP_DEFAULTS: VPConfig = {
  pushStrength: 25,
  velocityDissipation: 0.975,
  weight1Dissipation: 0.951,
  weight2Dissipation: 0.803,
  accelDissipation: 0.8,
  velCapture: 0.8,
  useNoise: true,
  doubleOctaveNoise: true,
  noiseScale: 0.021,
  noiseStrength: 3,
  minRadius: 0,
  maxRadius: 100,
  radiusRange: 100,
  distortionAmount: 3,
  chromaticShift: 0.5,
  velocityScale: 5,
  colorBoost: 10,
  edgeShade: 1.25,
  bgColor: { r: 17, g: 19, b: 26 },
};

// ── Shaders ───────────────────────────────────────────────

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// Compiled three ways: flat / 1-octave noise / 2-octave noise
const PAINT_FRAG_BODY = `precision highp float;
precision highp sampler2D;

uniform sampler2D t_blurredPaint;
uniform sampler2D t_prevFrame;
uniform vec2 v_texelSize;
uniform vec2 v_scrollDelta;
uniform vec4 p_segFrom;
uniform vec4 p_segTo;
uniform float p_spread;
uniform vec4 p_decay;
uniform vec2 p_motionVec;

#ifdef USE_NOISE
uniform float n_scale;
uniform float n_strength;
#endif

in vec2 vUv;
out vec4 fragColor;

#ifdef USE_NOISE
// PCG-style integer hash — two independent axes
vec2 pcgGrad(ivec2 cell) {
    uvec2 s = uvec2(cell);
    s = s * 1664525u + 1013904223u;
    s.x += s.y * 1664525u;
    s.y += s.x * 1664525u;
    s ^= s >> 16u;
    return vec2(s & 0x7FFFFFFFu) * (2.0 / float(0x7FFFFFFF)) - 1.0;
}

// Simplex 2D noise — returns: .x = value  .yz = (dn/dx, dn/dy)
vec3 paintNoise(vec2 p) {
    const float F2 = 0.36602540378;  // (sqrt(3) - 1) / 2  — skew
    const float G2 = 0.21132486540;  // (3 - sqrt(3)) / 6  — unskew

    // Skew to simplex cell
    vec2  s  = floor(p + dot(p, vec2(F2)));
    vec2  x0 = p - s + dot(s, vec2(G2));

    // Simplex triangle: which half?
    vec2  e  = step(x0.yx, x0.xy);
    vec2  i1 = e - e.yx * e;       // offset to middle vertex
    vec2  x1 = x0 - i1 + G2;
    vec2  x2 = x0 - 1.0 + 2.0 * G2;

    // Gradients at three simplex vertices
    vec2 g0 = pcgGrad(ivec2(s));
    vec2 g1 = pcgGrad(ivec2(s + i1));
    vec2 g2 = pcgGrad(ivec2(s + 1.0));

    // Radial falloff weights (0.5 - r^2, clamped)
    vec3 w  = max(0.5 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
    vec3 w2 = w * w;
    vec3 w3 = w2 * w;
    vec3 w4 = w2 * w2;

    // Noise value = sum of weighted gradient projections
    vec3 gd = vec3(dot(g0, x0), dot(g1, x1), dot(g2, x2));
    float n = dot(w4, gd) * 70.0;

    // Analytic derivatives
    vec2 dn = -8.0 * 70.0 * (w3.x * gd.x * x0 + w3.y * gd.y * x1 + w3.z * gd.z * x2)
              + 70.0 * (w4.x * g0 + w4.y * g1 + w4.z * g2);

    return vec3(n, dn);
}
#endif

void main() {
    const vec2 kVelCenter = vec2(0.5);

    // Closest point on brush stroke segment
    vec2  segAB   = p_segTo.xy - p_segFrom.xy;
    vec2  toFrag  = gl_FragCoord.xy - p_segFrom.xy;
    float segLen2 = max(dot(segAB, segAB), 1e-6);
    float segT    = clamp(dot(toFrag, segAB) / segLen2, 0.0, 1.0);
    vec2  sr      = mix(p_segFrom.zw, p_segTo.zw, segT);

    const float kBrushAA = 0.5;
    float brushDist = length(toFrag - segAB * segT);
    float brush     = 1.0 - smoothstep(-kBrushAA, sr.x, brushDist);

    // Self-advection: negative feedback from blurred flow field
    vec4 lowSample = texture(t_blurredPaint, vUv - v_scrollDelta);
    vec2 flowField = lowSample.xy - kVelCenter;
    vec2 pushVec   = flowField * (-p_spread);

    #ifdef USE_NOISE
    vec2  nP   = gl_FragCoord.xy * n_scale;
    vec3  nVal = paintNoise(nP);
    vec2  swirl = vec2(nVal.z, -nVal.y);

    #ifdef USE_NOISE_2OCT
    const mat2 kOctRot = mat2(1.6, 1.2, -1.2, 1.6);
    swirl = pcgGrad(ivec2(kOctRot * nP + nVal.yz * 0.15));
    #endif

    float curlMask = smoothstep(0.35, 0.02, length(lowSample.xy - 0.5));
    pushVec += swirl * (dot(lowSample.zw, vec2(1.0)) * n_strength * curlMask);
    #endif

    vec4 frag = texture(t_prevFrame, vUv - v_scrollDelta + pushVec * v_texelSize);
    vec2 vel  = frag.xy - kVelCenter;

    // Velocity: direct decay + splat injection (single MAD per component)
    vel = vel * p_decay.xy + p_motionVec * brush;

    // Weight: decay towards target with minimum-magnitude floor
    float brushW = sr.y * brush;
    vec2 wTarget = frag.zw * p_decay.zw + vec2(brushW);
    vec2 wDelta  = wTarget - frag.zw;
    const float kWeightFloor = 1.0 / 255.0;
    wDelta = mix(sign(wDelta) * kWeightFloor, wDelta, step(kWeightFloor, abs(wDelta)));
    frag.zw += wDelta;

    fragColor = clamp(vec4(vel + kVelCenter, frag.zw), vec4(0.0), vec4(1.0));
}
`;

const PAINT_FRAG         = `#version 300 es\n`                                       + PAINT_FRAG_BODY;
const PAINT_FRAG_NOISE   = `#version 300 es\n#define USE_NOISE\n`                    + PAINT_FRAG_BODY;
const PAINT_FRAG_NOISE_2 = `#version 300 es\n#define USE_NOISE\n#define USE_NOISE_2OCT\n` + PAINT_FRAG_BODY;

// 8-tap directional blur + iridescent fringing via R2 low-discrepancy jitter
const DISTORT_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D t_scene;
uniform sampler2D t_velPaint;
uniform vec2 v_paintTexel;
uniform float p_stepScale;
uniform float p_chromatic;
uniform float p_colorBoost;
uniform float p_edgeShade;

in vec2 vUv;
out vec4 fragColor;

// R2 quasi-random sequence — generalized golden ratio in 2D
vec2 r2Jitter(vec2 seed) {
    const vec2 alpha = vec2(0.7548776662466927, 0.5698402909980532); // 1/phi2
    return fract(seed * alpha);
}

// Parabolic periodic oscillator — analytic, no trig intrinsics
vec3 smoothOsc(vec3 x) {
    x -= floor(x * 0.15915494 + 0.5) * 6.28318530;
    vec3 y = x * (3.14159265 - abs(x)) * 0.40528473;
    return y * (0.775 + 0.225 * abs(y));
}

const float kChannelStep = 2.09439510239;

void main() {
    vec2 jitter = r2Jitter(gl_FragCoord.xy);

    vec4  velTex   = texture(t_velPaint, vUv);
    float paintMix = dot(velTex.zw, vec2(0.5));
    // Linear decode: xy * negScale + bias  (eps folded into bias constant)
    vec2  flowDir  = velTex.xy * (-2.0 * paintMix) + (paintMix * (1023.0 / 1024.0));

    // Directional blur along flow field
    vec2 stepVec  = flowDir * p_stepScale * v_paintTexel;
    vec2 sampleUV = vUv + jitter * stepVec;
    vec4 result   = vec4(0.0);
    for (int i = 0; i < 8; i++) {
        result += texture(t_scene, sampleUV);
        sampleUV += stepVec;
    }
    result *= 0.125;

    // Chromatic iridescence — peaks at low paint density
    const float kChromaFreq = 38.0;
    float chromaRamp = 1.0 - smoothstep(-0.9, 0.4, paintMix);
    vec2 absFlow  = abs(flowDir);
    float flowPeak = max(absFlow.x, absFlow.y);
    result.rgb += smoothOsc(
        vec3(dot(flowDir, vec2(1.0))) * kChromaFreq
        + vec3(0.0, kChannelStep, kChannelStep * 2.0) * p_chromatic
    ) * (chromaRamp * p_edgeShade * flowPeak * p_colorBoost);

    fragColor = result;
}
`;

// Separable Gaussian blur
const BLUR_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D t_input;
uniform vec2 v_texelSize;
uniform vec2 v_blurDir;

in vec2 vUv;
out vec4 fragColor;

void main() {
    vec4 accum = vec4(0.0);
    vec2 s1 = v_blurDir * v_texelSize * 1.3846153846;
    vec2 s2 = v_blurDir * v_texelSize * 3.2307692308;
    accum += texture(t_input, vUv)      * 0.2270270270;
    accum += texture(t_input, vUv + s1) * 0.3162162162;
    accum += texture(t_input, vUv - s1) * 0.3162162162;
    accum += texture(t_input, vUv + s2) * 0.0702702703;
    accum += texture(t_input, vUv - s2) * 0.0702702703;
    fragColor = accum;
}
`;

const COPY_FRAG = `#version 300 es
precision mediump float;
precision mediump sampler2D;

in vec2 vUv;
out vec4 fragColor;
uniform sampler2D t_input;

void main() {
    fragColor = texture(t_input, vUv);
}
`;

// Radial gradient background + temporal film grain
const BG_FRAG = `#version 300 es
precision highp float;

uniform vec3 u_centerColor;
uniform vec3 u_edgeColor;
uniform float u_aspect;
uniform float u_time;

in vec2 vUv;
out vec4 fragColor;

float filmGrain(vec3 p) {
    // Three-axis fold hash — vec3 scale + .zxy cross-mix
    p = fract(p * vec3(0.1179, 0.1323, 0.0917));
    p += dot(p, p.zxy + 39.47);
    return fract((p.y + p.z) * p.x);
}

void main() {
    vec2 q = vUv - 0.5;
    q.x *= u_aspect;
    float r = smoothstep(0.2, 1.2, length(q));
    vec3 color = mix(u_centerColor, u_edgeColor, 0.925 + 0.075 * r);
    color += (filmGrain(vec3(gl_FragCoord.xy, u_time)) - 0.5) / 255.0;
    fragColor = vec4(color, 1.0);
}
`;


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

export class VelocityPaintEngine {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  config: VPConfig;

  private paintShaderNoise!:  ShaderProgram;
  private paintShaderNoise2!: ShaderProgram;
  private paintShaderFlat!:   ShaderProgram;
  private distortShader!: ShaderProgram;
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
  private isDown = false;
  private hasMoved = false;
  private settleFrames = 0;

  private lastTime = performance.now();
  private frameId = 0;
  private disposed = false;
  private paused = false;

  private resizeObserver!: ResizeObserver;
  private resizeTimer = 0;

  private readonly boundTick = () => this.tick();
  private cachedRect: DOMRect | null = null;
  private dpr = 1;
  private now = 0;
  private bgCache = { r: -1, g: -1, b: -1, aspect: -1 };
  private lowTexelW = 0;
  private lowTexelH = 0;

  constructor(canvas: HTMLCanvasElement, config?: Partial<VPConfig>) {
    this.canvas = canvas;
    this.config = { ...VP_DEFAULTS, ...config };

    const gl = canvas.getContext('webgl2', {
      alpha: true, depth: false, stencil: false,
      antialias: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    this.buildQuad();
    this.buildShaders();
    this.applyResize();
    this.resetPaint();

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    canvas.addEventListener('mouseenter', this.onMouseEnter);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.onResizeSettled(), 150);
    });
    this.resizeObserver.observe(canvas);

    this.lastTime = performance.now();
    this.tick();
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
    this.distortShader    = createShaderProgram(gl, VERT, DISTORT_FRAG);
    this.blurShader       = createShaderProgram(gl, VERT, BLUR_FRAG);
    this.copyShader       = createShaderProgram(gl, VERT, COPY_FRAG);
    this.bgShader         = createShaderProgram(gl, VERT, BG_FRAG);

    // v_scrollDelta is always (0,0) — upload once, not every frame
    for (const ps of [this.paintShaderNoise, this.paintShaderNoise2, this.paintShaderFlat]) {
      gl.useProgram(ps.program);
      gl.uniform2f(ps.uniforms.v_scrollDelta, 0.0, 0.0);
    }
    gl.useProgram(null);

    this.bgCache = { r: -1, g: -1, b: -1, aspect: -1 };
  }

  private buildRenderTargets() {
    const gl = this.gl;
    // Paint at quarter viewport; blur at half-paint for smooth self-advection
    const pw = gl.drawingBufferWidth  >> 2;
    const ph = gl.drawingBufferHeight >> 2;
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
      gl.drawingBufferWidth, gl.drawingBufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const sceneFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    this.rtScene = {
      texture: sceneTex, fbo: sceneFbo, width: w, height: h,
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.bindVertexArray(this.quadVAO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // ── Resize ────────────────────────────────────────────────

  private applyResize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    const w = Math.floor(this.canvas.clientWidth  * this.dpr);
    const h = Math.floor(this.canvas.clientHeight * this.dpr);
    this.canvas.width  = Math.max(w, 1);
    this.canvas.height = Math.max(h, 1);

    this.cachedRect = null;
    this.bgCache.aspect = -1;

    this.destroyRenderTargets();
    this.buildRenderTargets();
    this.resetPaint();
    this.rtReady = true;
  }

  private onResizeSettled() {
    if (this.disposed) return;
    this.applyResize();
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
    radius = radius / gl.drawingBufferHeight * ph;

    this.segFrom.x = this.segTo.x;
    this.segFrom.y = this.segTo.y;
    this.segFrom.z = this.segTo.z;
    this.segFrom.w = this.segTo.w;

    this.segTo.x = (this.cursorX + 1.0) * pw / 2.0;
    this.segTo.y = (this.cursorY + 1.0) * ph / 2.0;
    this.segTo.z = radius;
    this.segTo.w = 1.0;

    if (!this.initialized) {
      // Only initialize once we have real cursor data from a mouse event.
      // Until then, paint with zero radius so nothing is drawn.
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

    // Downscale + H-blur in single pass (eliminates separate blit)
    gl.useProgram(this.blurShader.program);
    gl.uniform1i(this.blurShader.uniforms.t_input, this.rtCurr.attach(0));
    gl.uniform2f(this.blurShader.uniforms.v_texelSize, this.lowTexelW, this.lowTexelH);
    gl.uniform2f(this.blurShader.uniforms.v_blurDir, 1.0, 0.0);
    this.drawQuad(this.rtLowB);

    // V-blur at low resolution
    gl.uniform1i(this.blurShader.uniforms.t_input, this.rtLowB.attach(0));
    gl.uniform2f(this.blurShader.uniforms.v_blurDir, 0.0, 1.0);
    this.drawQuad(this.rtLow);

    this.hasMoved = false;
  }

  // ── Render Pass ──────────────────────────────────────────

  private renderPass() {
    const gl = this.gl;

    gl.useProgram(this.bgShader.program);
    const bg = this.config.bgColor;
    const aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
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
      gl.useProgram(this.distortShader.program);
      gl.uniform1i(this.distortShader.uniforms.t_scene,    this.rtScene.attach(0));
      gl.uniform1i(this.distortShader.uniforms.t_velPaint, this.rtCurr.attach(1));
      gl.uniform2f(this.distortShader.uniforms.v_paintTexel,
        1.0 / this.rtCurr.width, 1.0 / this.rtCurr.height);
      gl.uniform1f(this.distortShader.uniforms.p_stepScale,
        this.config.distortionAmount * this.config.velocityScale * 0.25);
      gl.uniform1f(this.distortShader.uniforms.p_chromatic,  this.config.chromaticShift);
      gl.uniform1f(this.distortShader.uniforms.p_colorBoost, this.config.colorBoost);
      gl.uniform1f(this.distortShader.uniforms.p_edgeShade,  this.config.edgeShade);
      this.drawQuad(null);
    } else {
      gl.useProgram(this.copyShader.program);
      gl.uniform1i(this.copyShader.uniforms.t_input, this.rtScene.attach(0));
      this.drawQuad(null);
    }
  }

  // ── Robustness Handlers ───────────────────────────────────

  private resetCursorState() {
    this.initialized = false;
    this.hasMoved    = false;
    this.motionX     = 0;
    this.motionY     = 0;
    // Clear stale segment so no streak is drawn from an old position
    this.segFrom.x = this.segFrom.y = this.segFrom.z = this.segFrom.w = 0;
    this.segTo.x   = this.segTo.y   = this.segTo.z   = this.segTo.w   = 0;
    this.settleFrames = 2; // suppress paint for 2 frames after re-entry
  }

  private onMouseEnter = () => this.resetCursorState();

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.paused = true;
      cancelAnimationFrame(this.frameId);
    } else {
      this.paused = false;
      this.resetCursorState();
      this.lastTime = performance.now();
      this.tick();
    }
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.frameId);
    this.rtReady = false;
  };

  private onContextRestored = () => {
    this.gl.getExtension('EXT_color_buffer_float');
    this.gl.getExtension('OES_texture_float_linear');
    this.buildQuad();
    this.buildShaders();
    this.applyResize();
    this.resetPaint();
    this.resetCursorState();
    this.lastTime = performance.now();
    this.tick();
  };

  // ── Main Loop ─────────────────────────────────────────────

  private tick() {
    if (this.disposed || this.paused || this.gl.isContextLost()) return;

    this.now = performance.now();
    const dt = Math.min((this.now - this.lastTime) * 1e-3, 1.0 / 60.0);
    this.lastTime = this.now;

    if (this.rtReady) {
      this.gl.disable(this.gl.BLEND);
      this.paintPass(dt);
      this.renderPass();
    }

    this.frameId = requestAnimationFrame(this.boundTick);
  }

  // ── Cursor API ────────────────────────────────────────────

  onMove(clientX: number, clientY: number) {
    this.cachedRect ??= this.canvas.getBoundingClientRect();
    const rect = this.cachedRect;
    this.cursorPixX = (clientX - rect.left) * this.dpr;
    this.cursorPixY = (clientY - rect.top)  * this.dpr;
    this.cursorX =  (this.cursorPixX / this.gl.drawingBufferWidth)  * 2.0 - 1.0;
    this.cursorY = -((this.cursorPixY / this.gl.drawingBufferHeight) * 2.0 - 1.0);
    this.hasMoved = true;
  }

  onDown() { this.isDown = true; }
  onUp()   { this.isDown = false; }

  // ── Dispose ───────────────────────────────────────────────

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    cancelAnimationFrame(this.frameId);
    clearTimeout(this.resizeTimer);
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.canvas.removeEventListener('mouseenter', this.onMouseEnter);

    this.destroyRenderTargets();

    const gl = this.gl;
    gl.deleteProgram(this.paintShaderNoise.program);
    gl.deleteProgram(this.paintShaderNoise2.program);
    gl.deleteProgram(this.paintShaderFlat.program);
    gl.deleteProgram(this.distortShader.program);
    gl.deleteProgram(this.blurShader.program);
    gl.deleteProgram(this.copyShader.program);
    gl.deleteProgram(this.bgShader.program);

    gl.deleteVertexArray(this.quadVAO);
  }
}
