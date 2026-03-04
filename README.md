# VelocityPaint
Real-time GPU-driven fluid-aesthetic effect — zero dependencies, pure WebGL 2.0.
Derived from semi-Lagrangian advection (Stam, SIGGRAPH '99), reduced to a single-pass velocity-field model that bypasses pressure projection entirely.
## How It Works
```
                    ╭─── State Texture (RGBA16F) ───╮
                    │  R  momentum x   ─┐           │
                    │  G  momentum y    ├─ biased   │
                    │  B  density w₁   ─┘  FP16     │
                    │  A  density w₂                │
                    ╰───────────────────────────────╯
```
Each frame evolves the state through three coupled stages:

```
    ┌──────────┐         ┌──────────┐           ┌──────────┐
    │  Splat   │────────▶│ Advect   │──────── ▶│ Distort  │───▶ Screen
    │  (¼ res) │         │  + Curl  │           │  (full)  │
    └──────────┘         └─────┬────┘           └──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Cascade Blur      │
                    │   H → V  (⅛ res)    │
                    └──────────┬──────────┘
                               │
                    ╭──────────▼──────────╮
                    │  Low-freq feedback  │──── feeds back
                    │  (self-advection)   │     into Advect
                    ╰─────────────────────╯
```
## Core Equations
**Advection** — the field pushes itself through its own blurred velocity:
```
    û(x, t+1) = S[ u(x − v̂·Δ, t) ] · λ  +  splat(x)
    where  v̂  = low-pass filtered velocity at ⅛ resolution
           λ  = per-channel exponential decay  ∈ (0, 1)
           S  = bilinear sampler with subpixel offset
```

**Curl turbulence** — analytic simplex derivatives → divergence-free swirl:

```
    ψ(p)  = SimplexNoise(p)      →  returns (n, ∂n/∂x, ∂n/∂y)
    curl  = ( ∂ψ/∂y,  −∂ψ/∂x ) ·  α(v)
    α(v)  = smoothstep attenuation  ∝  ‖v‖⁻¹
```

**Chromatic dispersion** — analytic periodic oscillator (no trig intrinsics):
```
    Ω(x) ≈ x(π − |x|) · 4/π²     parabolic base
    Ω(x) ← Ω · (a + b|Ω|)        refinement,  max error < 0.1%
```

## Pipeline Budget
```
    Pass           Resolution    Samples    Cost
    ─────────────────────────────────────────────
    Paint + Splat    W/4 × H/4       1       ██░░░░░░
    Blur H           W/8 × H/8       5       █░░░░░░░
    Blur V           W/8 × H/8       5       █░░░░░░░
    Background       W   × H         1       █░░░░░░░
    Distort + Comp   W   × H         8       ████░░░░
    ─────────────────────────────────────────────
    Total                            20       < 0.4ms @ 1080p
```
## Stack
```
    WebGL 2.0 ──▶ GLSL 300 es ──▶ RGBA16F ping-pong FBOs
    React 19  ──▶ <canvas>    ──▶ requestAnimationFrame
    Leva      ──▶ debug GUI        (dev only)
```
No Three.js. No scene graph. No material abstraction layer. Direct `gl.*` calls only.

## Design Choices
```
    ╭────────────────────────┬──────────────────────────────────────╮
    │  Noise primitive       │  Simplex 2D + PCG lattice hash       │
    │                        │  (analytic ∂n/∂x, ∂n/∂y — no         │
    │                        │   finite-difference needed)          │
    ├────────────────────────┼──────────────────────────────────────┤
    │  Curl attenuation      │  Output-space smoothstep mask        │
    │                        │  (prevents degenerate sampling       │
    │                        │   near velocity saturation)          │
    ├────────────────────────┼──────────────────────────────────────┤
    │  Periodic oscillator   │  Parabolic polynomial Ω(x)           │
    │                        │  (−40% ALU vs trig intrinsics        │
    │                        │   for full vec3 evaluation)          │
    ├────────────────────────┼──────────────────────────────────────┤
    │  Temporal jitter       │  R2 quasi-random sequence            │
    │                        │  (deterministic, zero VRAM)          │
    ├────────────────────────┼──────────────────────────────────────┤
    │  Blur cascade          │  Merged blit + H-blur                │
    │                        │  (one fewer render pass)             │
    ├────────────────────────┼──────────────────────────────────────┤
    │  Directional blur      │  8-tap with jittered start           │
    │                        │  (−12.5% bandwidth, sub-pixel AA)    │
    ├────────────────────────┼──────────────────────────────────────┤
    │  2nd noise octave      │  Rotated domain warp via             │
    │                        │  constant mat2 — breaks lattice      │
    │                        │  alignment without full evaluation   │
    ╰────────────────────────┴──────────────────────────────────────╯
```
## Run
```bash
npm i && npm run dev
```
## License
Private — all rights reserved.
