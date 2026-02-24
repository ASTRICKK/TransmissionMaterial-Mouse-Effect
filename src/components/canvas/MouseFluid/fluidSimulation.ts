/*
  Fluid Simulation Engine
  Ported from PavelDoGreat/WebGL-Fluid-Simulation
  MIT License - Copyright (c) 2017 Pavel Dobryakov
*/

import {
  baseVertexShaderSource,
  blurVertexShaderSource,
  blurShaderSource,
  copyShaderSource,
  clearShaderSource,
  colorShaderSource,
  checkerboardShaderSource,
  displayShaderSource,
  bloomPrefilterShaderSource,
  bloomBlurShaderSource,
  bloomFinalShaderSource,
  sunraysMaskShaderSource,
  sunraysShaderSource,
  splatShaderSource,
  advectionShaderSource,
  divergenceShaderSource,
  curlShaderSource,
  vorticityShaderSource,
  pressureShaderSource,
  gradientSubtractShaderSource,
} from './shaders';

// ── Types ──────────────────────────────────────────────────

export interface FluidConfig {
  SIM_RESOLUTION: number;
  DYE_RESOLUTION: number;
  DENSITY_DISSIPATION: number;
  VELOCITY_DISSIPATION: number;
  PRESSURE: number;
  PRESSURE_ITERATIONS: number;
  CURL: number;
  SPLAT_RADIUS: number;
  SPLAT_FORCE: number;
  SHADING: boolean;
  COLORFUL: boolean;
  COLOR_UPDATE_SPEED: number;
  PAUSED: boolean;
  BACK_COLOR: { r: number; g: number; b: number };
  TRANSPARENT: boolean;
  BLOOM: boolean;
  BLOOM_ITERATIONS: number;
  BLOOM_RESOLUTION: number;
  BLOOM_INTENSITY: number;
  BLOOM_THRESHOLD: number;
  BLOOM_SOFT_KNEE: number;
  SUNRAYS: boolean;
  SUNRAYS_RESOLUTION: number;
  SUNRAYS_WEIGHT: number;
  TRANSMISSION1: boolean;
  TRANSMISSION1_CA: number;
  TRANSMISSION1_CA_INTENSITY: number;
  TRANSMISSION1_CA_EDGE_WIDTH: number;
  TRANSMISSION1_CA_HUE_SHIFT: number;
  TRANSMISSION1_SPEC_POWER: number;
  TRANSMISSION1_SPEC_INTENSITY: number;
  TRANSMISSION1_FRESNEL_POWER: number;
  TRANSMISSION1_FRESNEL_INTENSITY: number;
  TRANSMISSION1_LIGHTING: boolean;
  TRANSMISSION2: boolean;
  TRANSMISSION2_IOR: number;
  TRANSMISSION2_THICKNESS: number;
  TRANSMISSION2_CA_SPREAD: number;
  TRANSMISSION2_CA_INTENSITY: number;
  TRANSMISSION2_CA_EDGE_WIDTH: number;
  TRANSMISSION2_GRAD_AMP: number;
  TRANSMISSION2_ROUGHNESS: number;
  TRANSMISSION2_CAUSTIC_INT: number;
  TRANSMISSION2_SPEC_POWER: number;
  TRANSMISSION2_SPEC_INTENSITY: number;
  TRANSMISSION2_FRESNEL_POWER: number;
  TRANSMISSION2_FRESNEL_INTENSITY: number;
  TRANSMISSION2_LIGHTING: boolean;
  TRANSMISSION3: boolean;
  TRANSMISSION3_IOR: number;
  TRANSMISSION3_THICKNESS: number;
  TRANSMISSION3_CA_SPREAD: number;
  TRANSMISSION3_CA_INTENSITY: number;
  TRANSMISSION3_CA_EDGE_WIDTH: number;
  TRANSMISSION3_GRAD_AMP: number;
  TRANSMISSION3_ROUGHNESS: number;
  TRANSMISSION3_CAUSTIC_INT: number;
  TRANSMISSION3_SPEC_POWER: number;
  TRANSMISSION3_SPEC_INTENSITY: number;
  TRANSMISSION3_FRESNEL_POWER: number;
  TRANSMISSION3_FRESNEL_INTENSITY: number;
  TRANSMISSION3_LIGHTING: boolean;
  VELOCITY_SPLAT: boolean;
  VELOCITY_MAX_RADIUS: number;
  VELOCITY_SENSITIVITY: number;
  VELOCITY_SPEED_BOOST: number;
  VELOCITY_THRESHOLD: number;
}

interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  attach: (id: number) => number;
}

interface DoubleFBO {
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  read: FBO;
  write: FBO;
  swap: () => void;
}

interface GLFormats {
  formatRGBA: { internalFormat: number; format: number } | null;
  formatRG: { internalFormat: number; format: number } | null;
  formatR: { internalFormat: number; format: number } | null;
  halfFloatTexType: number;
  supportLinearFiltering: boolean;
}

interface Pointer {
  id: number;
  texcoordX: number;
  texcoordY: number;
  prevTexcoordX: number;
  prevTexcoordY: number;
  deltaX: number;
  deltaY: number;
  down: boolean;
  moved: boolean;
  color: { r: number; g: number; b: number };
}

// ── Helper Classes ─────────────────────────────────────────

class GLProgram {
  uniforms: Record<string, WebGLUniformLocation | null>;
  program: WebGLProgram;

  constructor(gl: WebGL2RenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader) {
    this.uniforms = {};
    this.program = createProgram(gl, vertexShader, fragmentShader);
    this.uniforms = getUniforms(gl, this.program);
  }

  bind(gl: WebGL2RenderingContext) {
    gl.useProgram(this.program);
  }
}

class Material {
  vertexShader: WebGLShader;
  fragmentShaderSource: string;
  programs: Map<number, WebGLProgram>;
  activeProgram: WebGLProgram | null;
  uniforms: Record<string, WebGLUniformLocation | null>;

  constructor(vertexShader: WebGLShader, fragmentShaderSource: string) {
    this.vertexShader = vertexShader;
    this.fragmentShaderSource = fragmentShaderSource;
    this.programs = new Map();
    this.activeProgram = null;
    this.uniforms = {};
  }

  setKeywords(gl: WebGL2RenderingContext, keywords: string[]) {
    let hash = 0;
    for (let i = 0; i < keywords.length; i++) hash += hashCode(keywords[i]);

    let program = this.programs.get(hash);
    if (program == null) {
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
      program = createProgram(gl, this.vertexShader, fragmentShader);
      this.programs.set(hash, program);
    }

    if (program === this.activeProgram) return;

    this.uniforms = getUniforms(gl, program);
    this.activeProgram = program;
  }

  bind(gl: WebGL2RenderingContext) {
    gl.useProgram(this.activeProgram);
  }
}

// ── GL Utility Functions ───────────────────────────────────

function createProgram(gl: WebGL2RenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    console.trace(gl.getProgramInfoLog(program));
  return program;
}

function getUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): Record<string, WebGLUniformLocation | null> {
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
    const uniformName = gl.getActiveUniform(program, i)!.name;
    uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
  }
  return uniforms;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string, keywords?: string[]): WebGLShader {
  source = addKeywords(source, keywords);
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    console.trace(gl.getShaderInfoLog(shader));
  return shader;
}

function addKeywords(source: string, keywords?: string[]): string {
  if (keywords == null) return source;
  let keywordsString = '';
  keywords.forEach(keyword => {
    keywordsString += '#define ' + keyword + '\n';
  });
  return keywordsString + source;
}

function hashCode(s: string): number {
  if (s.length === 0) return 0;
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// ── Color Utilities ────────────────────────────────────────

function HSVtoRGB(h: number, s: number, v: number): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r, g, b };
}

function generateColor(): { r: number; g: number; b: number } {
  const c = HSVtoRGB(Math.random(), 1.0, 1.0);
  c.r *= 0.15;
  c.g *= 0.15;
  c.b *= 0.15;
  return c;
}

function normalizeColor(input: { r: number; g: number; b: number }) {
  return { r: input.r / 255, g: input.g / 255, b: input.b / 255 };
}

function wrap(value: number, min: number, max: number) {
  const range = max - min;
  if (range === 0) return min;
  return ((value - min) % range) + min;
}

function scaleByPixelRatio(input: number) {
  const pixelRatio = window.devicePixelRatio || 1;
  return Math.floor(input * pixelRatio);
}

// ── Dithering Texture (procedural) ─────────────────────────

function createDitheringTexture(gl: WebGL2RenderingContext): { texture: WebGLTexture; width: number; height: number; attach: (id: number) => number } {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  // Generate a noise texture instead of loading an image
  const size = 128;
  const data = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size * 3; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, size, size, 0, gl.RGB, gl.UNSIGNED_BYTE, data);

  return {
    texture,
    width: size,
    height: size,
    attach(id: number) {
      gl.activeTexture(gl.TEXTURE0 + id);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      return id;
    }
  };
}

// ── Main Fluid Simulation Class ────────────────────────────

export class FluidSimulation {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private ext: GLFormats;
  config: FluidConfig;

  // FBOs
  private dye!: DoubleFBO;
  private velocity!: DoubleFBO;
  private divergenceFBO!: FBO;
  private curlFBO!: FBO;
  private pressureFBO!: DoubleFBO;
  private bloom!: FBO;
  private bloomFramebuffers: FBO[] = [];
  private sunraysFBO!: FBO;
  private sunraysTempFBO!: FBO;

  // Dithering
  private ditheringTexture: { texture: WebGLTexture; width: number; height: number; attach: (id: number) => number };

  // Programs
  private blurProgram!: GLProgram;
  private copyProgram!: GLProgram;
  private clearProgram!: GLProgram;
  private colorProgram!: GLProgram;
  private checkerboardProgram!: GLProgram;
  private bloomPrefilterProgram!: GLProgram;
  private bloomBlurProgram!: GLProgram;
  private bloomFinalProgram!: GLProgram;
  private sunraysMaskProgram!: GLProgram;
  private sunraysProgram!: GLProgram;
  private splatProgram!: GLProgram;
  private advectionProgram!: GLProgram;
  private divergenceProgram!: GLProgram;
  private curlProgram!: GLProgram;
  private vorticityProgram!: GLProgram;
  private pressureProgram!: GLProgram;
  private gradientSubtractProgram!: GLProgram;
  private displayMaterial!: Material;

  // Blit function
  private blit!: (target: FBO | null, clear?: boolean) => void;

  // Pointers
  pointers: Pointer[] = [];
  private splatStack: number[] = [];

  // Animation
  private lastUpdateTime = Date.now();
  private colorUpdateTimer = 0.0;
  private animFrameId = 0;
  private _destroyed = false;

  // Tracking for reinit
  private _dyeInited = false;
  private _velocityInited = false;

  constructor(canvas: HTMLCanvasElement, config?: Partial<FluidConfig>) {
    this.canvas = canvas;

    this.config = {
      SIM_RESOLUTION: 128,
      DYE_RESOLUTION: 1024,
      DENSITY_DISSIPATION: 1,
      VELOCITY_DISSIPATION: 0.2,
      PRESSURE: 0.8,
      PRESSURE_ITERATIONS: 20,
      CURL: 30,
      SPLAT_RADIUS: 0.25,
      SPLAT_FORCE: 6000,
      SHADING: true,
      COLORFUL: true,
      COLOR_UPDATE_SPEED: 10,
      PAUSED: false,
      BACK_COLOR: { r: 0, g: 0, b: 0 },
      TRANSPARENT: false,
      BLOOM: true,
      BLOOM_ITERATIONS: 8,
      BLOOM_RESOLUTION: 256,
      BLOOM_INTENSITY: 0.8,
      BLOOM_THRESHOLD: 0.6,
      BLOOM_SOFT_KNEE: 0.7,
      SUNRAYS: true,
      SUNRAYS_RESOLUTION: 196,
      SUNRAYS_WEIGHT: 1.0,
      TRANSMISSION1: false,
      TRANSMISSION1_CA: 0.5,
      TRANSMISSION1_CA_INTENSITY: 0.5,
      TRANSMISSION1_CA_EDGE_WIDTH: 0.1,
      TRANSMISSION1_CA_HUE_SHIFT: 0.0,
      TRANSMISSION1_SPEC_POWER: 96.0,
      TRANSMISSION1_SPEC_INTENSITY: 0.35,
      TRANSMISSION1_FRESNEL_POWER: 2.0,
      TRANSMISSION1_FRESNEL_INTENSITY: 0.15,
      TRANSMISSION1_LIGHTING: true,
      TRANSMISSION2: false,
      TRANSMISSION2_IOR: 1.45,
      TRANSMISSION2_THICKNESS: 2.5,
      TRANSMISSION2_CA_SPREAD: 0.15,
      TRANSMISSION2_CA_INTENSITY: 0.6,
      TRANSMISSION2_CA_EDGE_WIDTH: 0.02,
      TRANSMISSION2_GRAD_AMP: 3.0,
      TRANSMISSION2_ROUGHNESS: 0.0,
      TRANSMISSION2_CAUSTIC_INT: 0.5,
      TRANSMISSION2_SPEC_POWER: 64.0,
      TRANSMISSION2_SPEC_INTENSITY: 0.4,
      TRANSMISSION2_FRESNEL_POWER: 3.0,
      TRANSMISSION2_FRESNEL_INTENSITY: 0.2,
      TRANSMISSION2_LIGHTING: true,
      TRANSMISSION3: false,
      TRANSMISSION3_IOR: 1.45,
      TRANSMISSION3_THICKNESS: 2.5,
      TRANSMISSION3_CA_SPREAD: 0.15,
      TRANSMISSION3_CA_INTENSITY: 0.6,
      TRANSMISSION3_CA_EDGE_WIDTH: 0.02,
      TRANSMISSION3_GRAD_AMP: 3.0,
      TRANSMISSION3_ROUGHNESS: 0.0,
      TRANSMISSION3_CAUSTIC_INT: 0.5,
      TRANSMISSION3_SPEC_POWER: 64.0,
      TRANSMISSION3_SPEC_INTENSITY: 0.4,
      TRANSMISSION3_FRESNEL_POWER: 3.0,
      TRANSMISSION3_FRESNEL_INTENSITY: 0.2,
      TRANSMISSION3_LIGHTING: true,
      VELOCITY_SPLAT: true,
      VELOCITY_MAX_RADIUS: 0.5,
      VELOCITY_SENSITIVITY: 0.005,
      VELOCITY_SPEED_BOOST: 1.0,
      VELOCITY_THRESHOLD: 0.001,
      ...config,
    };

    // WebGL2 context
    const params: WebGLContextAttributes = {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    };
    const glCtx = canvas.getContext('webgl2', params);
    if (!glCtx) throw new Error('WebGL2 not supported');
    this.gl = glCtx;

    // Extensions
    this.gl.getExtension('EXT_color_buffer_float');
    const supportLinearFiltering = !!this.gl.getExtension('OES_texture_float_linear');

    this.gl.clearColor(0.0, 0.0, 0.0, 1.0);

    const halfFloatTexType = this.gl.HALF_FLOAT;

    const formatRGBA = this.getSupportedFormat(this.gl.RGBA16F, this.gl.RGBA, halfFloatTexType);
    const formatRG = this.getSupportedFormat(this.gl.RG16F, this.gl.RG, halfFloatTexType);
    const formatR = this.getSupportedFormat(this.gl.R16F, this.gl.RED, halfFloatTexType);

    this.ext = { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering };

    if (!supportLinearFiltering) {
      this.config.DYE_RESOLUTION = 512;
      this.config.SHADING = false;
      this.config.BLOOM = false;
      this.config.SUNRAYS = false;
    }

    // Dithering
    this.ditheringTexture = createDitheringTexture(this.gl);

    // Init blit
    this.initBlit();

    // Compile programs
    this.compileAllPrograms();

    // Init framebuffers
    this.initFramebuffers();

    // Initial keywords
    this.updateKeywords();

    // Initial splats
    this.multipleSplats(Math.floor(Math.random() * 20) + 5);

    // Init pointers
    this.pointers = [this.createPointer()];

    // Start loop
    this.lastUpdateTime = Date.now();
    this.update();
  }

  private createPointer(): Pointer {
    return {
      id: -1,
      texcoordX: 0,
      texcoordY: 0,
      prevTexcoordX: 0,
      prevTexcoordY: 0,
      deltaX: 0,
      deltaY: 0,
      down: false,
      moved: false,
      color: { r: 30, g: 0, b: 300 },
    };
  }

  // ── Format Detection ───────────────────────────────────

  private getSupportedFormat(internalFormat: number, format: number, type: number): { internalFormat: number; format: number } | null {
    if (!this.supportRenderTextureFormat(internalFormat, format, type)) {
      switch (internalFormat) {
        case this.gl.R16F:
          return this.getSupportedFormat(this.gl.RG16F, this.gl.RG, type);
        case this.gl.RG16F:
          return this.getSupportedFormat(this.gl.RGBA16F, this.gl.RGBA, type);
        default:
          return null;
      }
    }
    return { internalFormat, format };
  }

  private supportRenderTextureFormat(internalFormat: number, format: number, type: number): boolean {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(fbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return status === gl.FRAMEBUFFER_COMPLETE;
  }

  // ── Blit ───────────────────────────────────────────────

  private initBlit() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    this.blit = (target: FBO | null, clear = false) => {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      if (clear) {
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
  }

  // ── Compile All Programs ───────────────────────────────

  private compileAllPrograms() {
    const gl = this.gl;
    const baseVertexShader = compileShader(gl, gl.VERTEX_SHADER, baseVertexShaderSource);
    const blurVertexShader = compileShader(gl, gl.VERTEX_SHADER, blurVertexShaderSource);

    this.blurProgram = new GLProgram(gl, blurVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, blurShaderSource));
    this.copyProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, copyShaderSource));
    this.clearProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, clearShaderSource));
    this.colorProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, colorShaderSource));
    this.checkerboardProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, checkerboardShaderSource));
    this.bloomPrefilterProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, bloomPrefilterShaderSource));
    this.bloomBlurProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, bloomBlurShaderSource));
    this.bloomFinalProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, bloomFinalShaderSource));
    this.sunraysMaskProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, sunraysMaskShaderSource));
    this.sunraysProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, sunraysShaderSource));
    this.splatProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, splatShaderSource));
    this.advectionProgram = new GLProgram(gl, baseVertexShader,
      compileShader(gl, gl.FRAGMENT_SHADER, advectionShaderSource,
        this.ext.supportLinearFiltering ? undefined : ['MANUAL_FILTERING']
      )
    );
    this.divergenceProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, divergenceShaderSource));
    this.curlProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, curlShaderSource));
    this.vorticityProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, vorticityShaderSource));
    this.pressureProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, pressureShaderSource));
    this.gradientSubtractProgram = new GLProgram(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, gradientSubtractShaderSource));

    this.displayMaterial = new Material(baseVertexShader, displayShaderSource);
  }

  // ── FBO Management ─────────────────────────────────────

  private createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): FBO {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const texelSizeX = 1.0 / w;
    const texelSizeY = 1.0 / h;

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX,
      texelSizeY,
      attach(id: number) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      }
    };
  }

  private createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): DoubleFBO {
    let fbo1 = this.createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = this.createFBO(w, h, internalFormat, format, type, param);

    return {
      width: w,
      height: h,
      texelSizeX: fbo1.texelSizeX,
      texelSizeY: fbo1.texelSizeY,
      get read() { return fbo1; },
      set read(value) { fbo1 = value; },
      get write() { return fbo2; },
      set write(value) { fbo2 = value; },
      swap() {
        const temp = fbo1;
        fbo1 = fbo2;
        fbo2 = temp;
      }
    };
  }

  private resizeFBO(target: FBO, w: number, h: number, internalFormat: number, format: number, type: number, param: number): FBO {
    const newFBO = this.createFBO(w, h, internalFormat, format, type, param);
    this.copyProgram.bind(this.gl);
    this.gl.uniform1i(this.copyProgram.uniforms.uTexture, target.attach(0));
    this.blit(newFBO);
    return newFBO;
  }

  private resizeDoubleFBO(target: DoubleFBO, w: number, h: number, internalFormat: number, format: number, type: number, param: number): DoubleFBO {
    if (target.width === w && target.height === h) return target;
    target.read = this.resizeFBO(target.read, w, h, internalFormat, format, type, param);
    target.write = this.createFBO(w, h, internalFormat, format, type, param);
    target.width = w;
    target.height = h;
    target.texelSizeX = 1.0 / w;
    target.texelSizeY = 1.0 / h;
    return target;
  }

  private getResolution(resolution: number): { width: number; height: number } {
    const gl = this.gl;
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;

    const min = Math.round(resolution);
    const max = Math.round(resolution * aspectRatio);

    if (gl.drawingBufferWidth > gl.drawingBufferHeight)
      return { width: max, height: min };
    else
      return { width: min, height: max };
  }

  initFramebuffers() {
    const gl = this.gl;
    const simRes = this.getResolution(this.config.SIM_RESOLUTION);
    const dyeRes = this.getResolution(this.config.DYE_RESOLUTION);

    const texType = this.ext.halfFloatTexType;
    const rgba = this.ext.formatRGBA!;
    const rg = this.ext.formatRG!;
    const r = this.ext.formatR!;
    const filtering = this.ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);

    if (!this._dyeInited)
      this.dye = this.createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    else
      this.dye = this.resizeDoubleFBO(this.dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    this._dyeInited = true;

    if (!this._velocityInited)
      this.velocity = this.createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    else
      this.velocity = this.resizeDoubleFBO(this.velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    this._velocityInited = true;

    this.divergenceFBO = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    this.curlFBO = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    this.pressureFBO = this.createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

    this.initBloomFramebuffers();
    this.initSunraysFramebuffers();
  }

  private initBloomFramebuffers() {
    const gl = this.gl;
    const res = this.getResolution(this.config.BLOOM_RESOLUTION);
    const texType = this.ext.halfFloatTexType;
    const rgba = this.ext.formatRGBA!;
    const filtering = this.ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    this.bloom = this.createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);

    this.bloomFramebuffers = [];
    for (let i = 0; i < this.config.BLOOM_ITERATIONS; i++) {
      const width = res.width >> (i + 1);
      const height = res.height >> (i + 1);
      if (width < 2 || height < 2) break;
      const fbo = this.createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering);
      this.bloomFramebuffers.push(fbo);
    }
  }

  private initSunraysFramebuffers() {
    const gl = this.gl;
    const res = this.getResolution(this.config.SUNRAYS_RESOLUTION);
    const texType = this.ext.halfFloatTexType;
    const r = this.ext.formatR!;
    const filtering = this.ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    this.sunraysFBO = this.createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
    this.sunraysTempFBO = this.createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
  }

  // ── Keywords ───────────────────────────────────────────

  updateKeywords() {
    const displayKeywords: string[] = [];
    if (this.config.TRANSMISSION1) {
      displayKeywords.push('TRANSMISSION1');
    } else if (this.config.TRANSMISSION2) {
      displayKeywords.push('TRANSMISSION2');
    } else if (this.config.TRANSMISSION3) {
      displayKeywords.push('TRANSMISSION3');
    } else {
      if (this.config.SHADING) displayKeywords.push('SHADING');
      if (this.config.BLOOM) displayKeywords.push('BLOOM');
      if (this.config.SUNRAYS) displayKeywords.push('SUNRAYS');
    }
    this.displayMaterial.setKeywords(this.gl, displayKeywords);
  }

  // ── Simulation Step ────────────────────────────────────

  private step(dt: number) {
    const gl = this.gl;
    gl.disable(gl.BLEND);

    this.curlProgram.bind(gl);
    gl.uniform2f(this.curlProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.curlProgram.uniforms.uVelocity, this.velocity.read.attach(0));
    this.blit(this.curlFBO);

    this.vorticityProgram.bind(gl);
    gl.uniform2f(this.vorticityProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.vorticityProgram.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(this.vorticityProgram.uniforms.uCurl, this.curlFBO.attach(1));
    gl.uniform1f(this.vorticityProgram.uniforms.curl, this.config.CURL);
    gl.uniform1f(this.vorticityProgram.uniforms.dt, dt);
    this.blit(this.velocity.write);
    this.velocity.swap();

    this.divergenceProgram.bind(gl);
    gl.uniform2f(this.divergenceProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.divergenceProgram.uniforms.uVelocity, this.velocity.read.attach(0));
    this.blit(this.divergenceFBO);

    this.clearProgram.bind(gl);
    gl.uniform1i(this.clearProgram.uniforms.uTexture, this.pressureFBO.read.attach(0));
    gl.uniform1f(this.clearProgram.uniforms.value, this.config.PRESSURE);
    this.blit(this.pressureFBO.write);
    this.pressureFBO.swap();

    this.pressureProgram.bind(gl);
    gl.uniform2f(this.pressureProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.pressureProgram.uniforms.uDivergence, this.divergenceFBO.attach(0));
    for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(this.pressureProgram.uniforms.uPressure, this.pressureFBO.read.attach(1));
      this.blit(this.pressureFBO.write);
      this.pressureFBO.swap();
    }

    this.gradientSubtractProgram.bind(gl);
    gl.uniform2f(this.gradientSubtractProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.gradientSubtractProgram.uniforms.uPressure, this.pressureFBO.read.attach(0));
    gl.uniform1i(this.gradientSubtractProgram.uniforms.uVelocity, this.velocity.read.attach(1));
    this.blit(this.velocity.write);
    this.velocity.swap();

    this.advectionProgram.bind(gl);
    gl.uniform2f(this.advectionProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    if (!this.ext.supportLinearFiltering)
      gl.uniform2f(this.advectionProgram.uniforms.dyeTexelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    const velocityId = this.velocity.read.attach(0);
    gl.uniform1i(this.advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(this.advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(this.advectionProgram.uniforms.dt, dt);
    gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.VELOCITY_DISSIPATION);
    this.blit(this.velocity.write);
    this.velocity.swap();

    if (!this.ext.supportLinearFiltering)
      gl.uniform2f(this.advectionProgram.uniforms.dyeTexelSize, this.dye.texelSizeX, this.dye.texelSizeY);
    gl.uniform1i(this.advectionProgram.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(this.advectionProgram.uniforms.uSource, this.dye.read.attach(1));
    gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.DENSITY_DISSIPATION);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  // ── Rendering ──────────────────────────────────────────

  private render(target: FBO | null) {
    const gl = this.gl;

    if (this.config.BLOOM) this.applyBloom(this.dye.read, this.bloom);
    if (this.config.SUNRAYS) {
      this.applySunrays(this.dye.read, this.dye.write, this.sunraysFBO);
      this.blur(this.sunraysFBO, this.sunraysTempFBO, 1);
    }

    if (target == null || !this.config.TRANSPARENT) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
    } else {
      gl.disable(gl.BLEND);
    }

    if (!this.config.TRANSPARENT)
      this.drawColor(target, normalizeColor(this.config.BACK_COLOR));
    if (target == null && this.config.TRANSPARENT)
      this.drawCheckerboard(target);
    this.drawDisplay(target);
  }

  private drawColor(target: FBO | null, color: { r: number; g: number; b: number }) {
    this.colorProgram.bind(this.gl);
    this.gl.uniform4f(this.colorProgram.uniforms.color, color.r, color.g, color.b, 1);
    this.blit(target);
  }

  private drawCheckerboard(target: FBO | null) {
    this.checkerboardProgram.bind(this.gl);
    this.gl.uniform1f(this.checkerboardProgram.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
    this.blit(target);
  }

  private drawDisplay(target: FBO | null) {
    const gl = this.gl;
    const width = target == null ? gl.drawingBufferWidth : target.width;
    const height = target == null ? gl.drawingBufferHeight : target.height;

    this.displayMaterial.bind(gl);
    // Always pass texelSize for both SHADING and TRANSMISSION
    gl.uniform2f(this.displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);
    gl.uniform1i(this.displayMaterial.uniforms.uTexture, this.dye.read.attach(0));

    if (this.config.TRANSMISSION1) {
      // TransmissionMaterial1 (soap bubble) uniforms
      gl.uniform1f(this.displayMaterial.uniforms.uChromaticAberration, this.config.TRANSMISSION1_CA);
      gl.uniform1f(this.displayMaterial.uniforms.uCaIntensity, this.config.TRANSMISSION1_CA_INTENSITY);
      gl.uniform1f(this.displayMaterial.uniforms.uCaEdgeWidth, this.config.TRANSMISSION1_CA_EDGE_WIDTH);
      gl.uniform1f(this.displayMaterial.uniforms.uCaHueShift, this.config.TRANSMISSION1_CA_HUE_SHIFT);
      gl.uniform1f(this.displayMaterial.uniforms.uSpecPower3, this.config.TRANSMISSION1_SPEC_POWER);
      gl.uniform1f(this.displayMaterial.uniforms.uSpecIntensity3, this.config.TRANSMISSION1_SPEC_INTENSITY);
      gl.uniform1f(this.displayMaterial.uniforms.uFresnelPower3, this.config.TRANSMISSION1_FRESNEL_POWER);
      gl.uniform1f(this.displayMaterial.uniforms.uFresnelIntensity3, this.config.TRANSMISSION1_FRESNEL_INTENSITY);
      gl.uniform1f(this.displayMaterial.uniforms.uLighting, this.config.TRANSMISSION1_LIGHTING ? 1.0 : 0.0);
      const bgNorm = normalizeColor(this.config.BACK_COLOR);
      gl.uniform3f(this.displayMaterial.uniforms.uBackColor, bgNorm.r, bgNorm.g, bgNorm.b);
    } else if (this.config.TRANSMISSION2) {
      // TransmissionMaterial2 (refraction caustics) uniforms
      gl.uniform1f(this.displayMaterial.uniforms.uIor2, this.config.TRANSMISSION2_IOR);
      gl.uniform1f(this.displayMaterial.uniforms.uThickness2, this.config.TRANSMISSION2_THICKNESS);
      gl.uniform1f(this.displayMaterial.uniforms.uCaSpread2, this.config.TRANSMISSION2_CA_SPREAD);
      gl.uniform1f(this.displayMaterial.uniforms.uCaIntensity2, this.config.TRANSMISSION2_CA_INTENSITY);
      gl.uniform1f(this.displayMaterial.uniforms.uCaEdgeWidth2, this.config.TRANSMISSION2_CA_EDGE_WIDTH);
      gl.uniform1f(this.displayMaterial.uniforms.uGradAmp2, this.config.TRANSMISSION2_GRAD_AMP);
      gl.uniform1f(this.displayMaterial.uniforms.uRoughness2, this.config.TRANSMISSION2_ROUGHNESS);
      gl.uniform1f(this.displayMaterial.uniforms.uCausticInt2, this.config.TRANSMISSION2_CAUSTIC_INT);
      gl.uniform1f(this.displayMaterial.uniforms.uSpecPower2, this.config.TRANSMISSION2_SPEC_POWER);
      gl.uniform1f(this.displayMaterial.uniforms.uSpecIntensity2, this.config.TRANSMISSION2_SPEC_INTENSITY);
      gl.uniform1f(this.displayMaterial.uniforms.uFresnelPower2, this.config.TRANSMISSION2_FRESNEL_POWER);
      gl.uniform1f(this.displayMaterial.uniforms.uFresnelIntensity2, this.config.TRANSMISSION2_FRESNEL_INTENSITY);
      gl.uniform1f(this.displayMaterial.uniforms.uLighting, this.config.TRANSMISSION2_LIGHTING ? 1.0 : 0.0);
      const bgNorm = normalizeColor(this.config.BACK_COLOR);
      gl.uniform3f(this.displayMaterial.uniforms.uBackColor, bgNorm.r, bgNorm.g, bgNorm.b);
    } else if (this.config.TRANSMISSION3) {
      gl.uniform1f(this.displayMaterial.uniforms.uIor3, this.config.TRANSMISSION3_IOR);
      gl.uniform1f(this.displayMaterial.uniforms.uThickness3, this.config.TRANSMISSION3_THICKNESS);
      gl.uniform1f(this.displayMaterial.uniforms.uCaSpread3, this.config.TRANSMISSION3_CA_SPREAD);
      gl.uniform1f(this.displayMaterial.uniforms.uCaIntensity3, this.config.TRANSMISSION3_CA_INTENSITY);
      gl.uniform1f(this.displayMaterial.uniforms.uCaEdgeWidth3, this.config.TRANSMISSION3_CA_EDGE_WIDTH);
      gl.uniform1f(this.displayMaterial.uniforms.uGradAmp3, this.config.TRANSMISSION3_GRAD_AMP);
      gl.uniform1f(this.displayMaterial.uniforms.uRoughness3, this.config.TRANSMISSION3_ROUGHNESS);
      gl.uniform1f(this.displayMaterial.uniforms.uCausticInt3, this.config.TRANSMISSION3_CAUSTIC_INT);
      gl.uniform1f(this.displayMaterial.uniforms.uSpecPower4, this.config.TRANSMISSION3_SPEC_POWER);
      gl.uniform1f(this.displayMaterial.uniforms.uSpecIntensity4, this.config.TRANSMISSION3_SPEC_INTENSITY);
      gl.uniform1f(this.displayMaterial.uniforms.uFresnelPower4, this.config.TRANSMISSION3_FRESNEL_POWER);
      gl.uniform1f(this.displayMaterial.uniforms.uFresnelIntensity4, this.config.TRANSMISSION3_FRESNEL_INTENSITY);
      gl.uniform1f(this.displayMaterial.uniforms.uLighting, this.config.TRANSMISSION3_LIGHTING ? 1.0 : 0.0);
      const bgNorm = normalizeColor(this.config.BACK_COLOR);
      gl.uniform3f(this.displayMaterial.uniforms.uBackColor, bgNorm.r, bgNorm.g, bgNorm.b);
    } else {
      if (this.config.BLOOM) {
        gl.uniform1i(this.displayMaterial.uniforms.uBloom, this.bloom.attach(1));
        gl.uniform1i(this.displayMaterial.uniforms.uDithering, this.ditheringTexture.attach(2));
        const scale = this.getTextureScale(this.ditheringTexture, width, height);
        gl.uniform2f(this.displayMaterial.uniforms.ditherScale, scale.x, scale.y);
      }
      if (this.config.SUNRAYS)
        gl.uniform1i(this.displayMaterial.uniforms.uSunrays, this.sunraysFBO.attach(3));
    }
    this.blit(target);
  }

  private getTextureScale(texture: { width: number; height: number }, width: number, height: number) {
    return { x: width / texture.width, y: height / texture.height };
  }

  // ── Bloom ──────────────────────────────────────────────

  private applyBloom(source: FBO, destination: FBO) {
    if (this.bloomFramebuffers.length < 2) return;

    const gl = this.gl;
    let last = destination;

    gl.disable(gl.BLEND);
    this.bloomPrefilterProgram.bind(gl);
    const knee = this.config.BLOOM_THRESHOLD * this.config.BLOOM_SOFT_KNEE + 0.0001;
    const curve0 = this.config.BLOOM_THRESHOLD - knee;
    const curve1 = knee * 2;
    const curve2 = 0.25 / knee;
    gl.uniform3f(this.bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2);
    gl.uniform1f(this.bloomPrefilterProgram.uniforms.threshold, this.config.BLOOM_THRESHOLD);
    gl.uniform1i(this.bloomPrefilterProgram.uniforms.uTexture, source.attach(0));
    this.blit(last);

    this.bloomBlurProgram.bind(gl);
    for (let i = 0; i < this.bloomFramebuffers.length; i++) {
      const dest = this.bloomFramebuffers[i];
      gl.uniform2f(this.bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(this.bloomBlurProgram.uniforms.uTexture, last.attach(0));
      this.blit(dest);
      last = dest;
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);

    for (let i = this.bloomFramebuffers.length - 2; i >= 0; i--) {
      const baseTex = this.bloomFramebuffers[i];
      gl.uniform2f(this.bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(this.bloomBlurProgram.uniforms.uTexture, last.attach(0));
      gl.viewport(0, 0, baseTex.width, baseTex.height);
      this.blit(baseTex);
      last = baseTex;
    }

    gl.disable(gl.BLEND);
    this.bloomFinalProgram.bind(gl);
    gl.uniform2f(this.bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
    gl.uniform1i(this.bloomFinalProgram.uniforms.uTexture, last.attach(0));
    gl.uniform1f(this.bloomFinalProgram.uniforms.intensity, this.config.BLOOM_INTENSITY);
    this.blit(destination);
  }

  // ── Sunrays ────────────────────────────────────────────

  private applySunrays(source: FBO, mask: FBO, destination: FBO) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    this.sunraysMaskProgram.bind(gl);
    gl.uniform1i(this.sunraysMaskProgram.uniforms.uTexture, source.attach(0));
    this.blit(mask);

    this.sunraysProgram.bind(gl);
    gl.uniform1f(this.sunraysProgram.uniforms.weight, this.config.SUNRAYS_WEIGHT);
    gl.uniform1i(this.sunraysProgram.uniforms.uTexture, mask.attach(0));
    this.blit(destination);
  }

  // ── Blur ───────────────────────────────────────────────

  private blur(target: FBO, temp: FBO, iterations: number) {
    const gl = this.gl;
    this.blurProgram.bind(gl);
    for (let i = 0; i < iterations; i++) {
      gl.uniform2f(this.blurProgram.uniforms.texelSize, target.texelSizeX, 0.0);
      gl.uniform1i(this.blurProgram.uniforms.uTexture, target.attach(0));
      this.blit(temp);

      gl.uniform2f(this.blurProgram.uniforms.texelSize, 0.0, target.texelSizeY);
      gl.uniform1i(this.blurProgram.uniforms.uTexture, temp.attach(0));
      this.blit(target);
    }
  }

  // ── Splats ─────────────────────────────────────────────

  splat(x: number, y: number, dx: number, dy: number, color: { r: number; g: number; b: number }) {
    const gl = this.gl;
    this.splatProgram.bind(gl);
    gl.uniform1i(this.splatProgram.uniforms.uTarget, this.velocity.read.attach(0));
    gl.uniform1f(this.splatProgram.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
    gl.uniform2f(this.splatProgram.uniforms.point, x, y);
    gl.uniform3f(this.splatProgram.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(this.splatProgram.uniforms.radius, this.correctRadius(this.config.SPLAT_RADIUS / 100.0));
    this.blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(this.splatProgram.uniforms.uTarget, this.dye.read.attach(0));
    gl.uniform3f(this.splatProgram.uniforms.color, color.r, color.g, color.b);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  private splatWithRadius(x: number, y: number, dx: number, dy: number, color: { r: number; g: number; b: number }, radius: number) {
    const gl = this.gl;
    this.splatProgram.bind(gl);
    gl.uniform1i(this.splatProgram.uniforms.uTarget, this.velocity.read.attach(0));
    gl.uniform1f(this.splatProgram.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
    gl.uniform2f(this.splatProgram.uniforms.point, x, y);
    gl.uniform3f(this.splatProgram.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(this.splatProgram.uniforms.radius, this.correctRadius(radius));
    this.blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(this.splatProgram.uniforms.uTarget, this.dye.read.attach(0));
    gl.uniform3f(this.splatProgram.uniforms.color, color.r, color.g, color.b);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  private splatPointer(pointer: Pointer) {
    const dx = pointer.deltaX * this.config.SPLAT_FORCE;
    const dy = pointer.deltaY * this.config.SPLAT_FORCE;

    if (this.config.VELOCITY_SPLAT) {
      // Raw speed in texcoord space
      const speed = Math.sqrt(pointer.deltaX * pointer.deltaX + pointer.deltaY * pointer.deltaY);

      // Boost amplifies the measured speed
      const boostedSpeed = speed * this.config.VELOCITY_SPEED_BOOST;

      // Threshold: speed below this = no fluid at all (dead zone)
      const effectiveSpeed = Math.max(boostedSpeed - this.config.VELOCITY_THRESHOLD, 0);

      // Normalize: effectiveSpeed / sensitivity → 0 to 1
      const normalizedSpeed = Math.min(effectiveSpeed / this.config.VELOCITY_SENSITIVITY, 1.0);

      // Radius: 0 at rest, maxRadius at full speed
      const radius = normalizedSpeed * this.config.VELOCITY_MAX_RADIUS / 100.0;

      if (radius < 0.00001) return;

      this.splatWithRadius(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color, radius);
    } else {
      this.splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
    }
  }

  multipleSplats(amount: number) {
    for (let i = 0; i < amount; i++) {
      const color = generateColor();
      color.r *= 10.0;
      color.g *= 10.0;
      color.b *= 10.0;
      const x = Math.random();
      const y = Math.random();
      const dx = 1000 * (Math.random() - 0.5);
      const dy = 1000 * (Math.random() - 0.5);
      this.splat(x, y, dx, dy, color);
    }
  }

  private correctRadius(radius: number) {
    const aspectRatio = this.canvas.width / this.canvas.height;
    if (aspectRatio > 1) radius *= aspectRatio;
    return radius;
  }

  private correctDeltaX(delta: number) {
    const aspectRatio = this.canvas.width / this.canvas.height;
    if (aspectRatio < 1) delta *= aspectRatio;
    return delta;
  }

  private correctDeltaY(delta: number) {
    const aspectRatio = this.canvas.width / this.canvas.height;
    if (aspectRatio > 1) delta /= aspectRatio;
    return delta;
  }

  // ── Canvas Resize ──────────────────────────────────────

  resizeCanvas(): boolean {
    const width = scaleByPixelRatio(this.canvas.clientWidth);
    const height = scaleByPixelRatio(this.canvas.clientHeight);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      return true;
    }
    return false;
  }

  // ── Pointer Data ───────────────────────────────────────

  updatePointerDownData(pointer: Pointer, id: number, posX: number, posY: number) {
    pointer.id = id;
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = posX / this.canvas.width;
    pointer.texcoordY = 1.0 - posY / this.canvas.height;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
    pointer.color = generateColor();
  }

  updatePointerMoveData(pointer: Pointer, posX: number, posY: number) {
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / this.canvas.width;
    pointer.texcoordY = 1.0 - posY / this.canvas.height;
    pointer.deltaX = this.correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
    pointer.deltaY = this.correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
  }

  updatePointerUpData(pointer: Pointer) {
    pointer.down = false;
  }

  // ── Main Update Loop ──────────────────────────────────

  private update() {
    if (this._destroyed) return;

    const dt = this.calcDeltaTime();
    if (this.resizeCanvas()) this.initFramebuffers();
    this.updateColors(dt);
    this.applyInputs();
    if (!this.config.PAUSED) this.step(dt);
    this.render(null);
    this.animFrameId = requestAnimationFrame(() => this.update());
  }

  private calcDeltaTime() {
    const now = Date.now();
    let dt = (now - this.lastUpdateTime) / 1000;
    dt = Math.min(dt, 0.016666);
    this.lastUpdateTime = now;
    return dt;
  }

  private updateColors(dt: number) {
    if (!this.config.COLORFUL) return;

    this.colorUpdateTimer += dt * this.config.COLOR_UPDATE_SPEED;
    if (this.colorUpdateTimer >= 1) {
      this.colorUpdateTimer = wrap(this.colorUpdateTimer, 0, 1);
      this.pointers.forEach(p => {
        p.color = generateColor();
      });
    }
  }

  private applyInputs() {
    if (this.splatStack.length > 0)
      this.multipleSplats(this.splatStack.pop()!);

    this.pointers.forEach(p => {
      if (p.moved) {
        p.moved = false;
        this.splatPointer(p);
      }
    });
  }

  // ── Destroy ────────────────────────────────────────────

  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this.animFrameId);
  }
}
