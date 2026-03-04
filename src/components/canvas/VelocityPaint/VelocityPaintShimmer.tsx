'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useControls, folder } from 'leva';
import { VelocityPaintShimmerEngine } from './VelocityPaintShimmerEngine';

export default function VelocityPaintShimmer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<VelocityPaintShimmerEngine | null>(null);
  const frameRef = useRef(0);
  const lastTimeRef = useRef(0);
  const pausedRef = useRef(false);
  const rectRef = useRef<DOMRect | null>(null);

  // ── Leva Controls ──────────────────────────────────────

  const controls = useControls('VelocityPaintShimmer', {
    paint: folder({
      pushStrength:         { value: 25,    min: 0,    max: 100, step: 1,     label: 'Push Strength' },
      velocityDissipation:  { value: 0.975, min: 0.9,  max: 1.0, step: 0.001, label: 'Vel Dissipation' },
      weight1Dissipation:   { value: 0.95,  min: 0.8,  max: 1.0, step: 0.005, label: 'W1 Dissipation' },
      weight2Dissipation:   { value: 0.80,  min: 0.3,  max: 1.0, step: 0.01,  label: 'W2 Dissipation' },
      accelDissipation:     { value: 0.8,   min: 0.1,  max: 1.0, step: 0.01,  label: 'Accel Dissip' },
      useNoise:             { value: true,  label: 'Curl Noise' },
      noiseScale:           { value: 0.02,  min: 0.001, max: 0.5, step: 0.001, label: 'Noise Scale' },
      noiseStrength:        { value: 3,     min: 0,    max: 20,  step: 0.1,   label: 'Noise Strength' },
      minRadius:            { value: 0,     min: 0,    max: 50,  step: 1,     label: 'Min Radius' },
      maxRadius:            { value: 100,   min: 10,   max: 500, step: 1,     label: 'Max Radius' },
      radiusRange:          { value: 100,   min: 10,   max: 500, step: 1,     label: 'Radius Range' },
    }),
    shimmer: folder({
      distortionAmount:  { value: 2.5,  min: 0,  max: 100, step: 0.5,  label: 'Distortion' },
      filmThickness:     { value: 1.8,  min: 0.1, max: 5,  step: 0.05, label: 'Film Thickness' },
      iridIntensity:     { value: 12,   min: 0,   max: 30, step: 0.5,  label: 'Irid Intensity' },
      fresnelPower:      { value: 2.5,  min: 0.5, max: 8,  step: 0.1,  label: 'Fresnel Power' },
      velocityScale:     { value: 5,    min: 0,  max: 20,  step: 0.05, label: 'Velocity Scale' },
      edgeShade:         { value: 1.5,  min: 0,  max: 5,   step: 0.05, label: 'Edge Shade' },
    }),
    backgroundColor: { value: '#0a0c16', label: 'Background' },
  });

  // ── Sync Leva → Engine ─────────────────────────────────

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const hex = controls.backgroundColor;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    engine.config.pushStrength        = controls.pushStrength;
    engine.config.velocityDissipation = controls.velocityDissipation;
    engine.config.weight1Dissipation  = controls.weight1Dissipation;
    engine.config.weight2Dissipation  = controls.weight2Dissipation;
    engine.config.accelDissipation    = controls.accelDissipation;
    engine.config.useNoise            = controls.useNoise;
    engine.config.noiseScale          = controls.noiseScale;
    engine.config.noiseStrength       = controls.noiseStrength;
    engine.config.minRadius           = controls.minRadius;
    engine.config.maxRadius           = controls.maxRadius;
    engine.config.radiusRange         = controls.radiusRange;
    engine.config.distortionAmount    = controls.distortionAmount;
    engine.config.filmThickness       = controls.filmThickness;
    engine.config.iridIntensity       = controls.iridIntensity;
    engine.config.fresnelPower        = controls.fresnelPower;
    engine.config.velocityScale       = controls.velocityScale;
    engine.config.edgeShade           = controls.edgeShade;
    engine.config.bgColor             = { r, g, b };
  }, [controls]);

  // ── Event Handlers ─────────────────────────────────────

  const onMouseMove = useCallback((e: MouseEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    rectRef.current ??= canvasRef.current!.getBoundingClientRect();
    engine.onMove(e.clientX, e.clientY, rectRef.current);
  }, []);

  const onTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) {
      rectRef.current ??= canvasRef.current!.getBoundingClientRect();
      engineRef.current?.onMove(t.clientX, t.clientY, rectRef.current);
    }
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) {
      rectRef.current ??= canvasRef.current!.getBoundingClientRect();
      engineRef.current?.onMove(t.clientX, t.clientY, rectRef.current);
    }
  }, []);

  // ── Init / Cleanup ─────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth  * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    canvas.width  = Math.max(w, 1);
    canvas.height = Math.max(h, 1);

    const gl = canvas.getContext('webgl2', {
      alpha: true, depth: false, stencil: false,
      antialias: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');

    const engine = new VelocityPaintShimmerEngine(gl);
    engine.setDPR(dpr);
    engineRef.current = engine;

    // ── Frame loop ──
    const tick = () => {
      if (pausedRef.current) return;
      const now = performance.now();
      const dt = Math.min((now - lastTimeRef.current) * 1e-3, 1.0 / 60.0);
      lastTimeRef.current = now;
      engine.update(dt, now);
      frameRef.current = requestAnimationFrame(tick);
    };
    lastTimeRef.current = performance.now();
    tick();

    // ── Resize ──
    let resizeTimer = 0;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const d = Math.min(window.devicePixelRatio || 1, 2);
        const rw = Math.max(Math.floor(canvas.clientWidth  * d), 1);
        const rh = Math.max(Math.floor(canvas.clientHeight * d), 1);
        canvas.width  = rw;
        canvas.height = rh;
        engine.setDPR(d);
        engine.resize(rw, rh);
        rectRef.current = null;
      }, 150);
    });
    resizeObserver.observe(canvas);

    // ── Events ──
    const onMouseEnter = () => engine.resetCursorState();
    const onVisChange = () => {
      if (document.hidden) {
        pausedRef.current = true;
        cancelAnimationFrame(frameRef.current);
      } else {
        pausedRef.current = false;
        engine.resetCursorState();
        lastTimeRef.current = performance.now();
        tick();
      }
    };
    const onCtxLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(frameRef.current); };
    const onCtxRestored = () => {
      const newGl = canvas.getContext('webgl2')!;
      const newEngine = new VelocityPaintShimmerEngine(newGl);
      newEngine.setDPR(Math.min(window.devicePixelRatio || 1, 2));
      engineRef.current = newEngine;
      lastTimeRef.current = performance.now();
      tick();
    };

    window.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('mouseenter', onMouseEnter);
    document.addEventListener('visibilitychange', onVisChange);
    canvas.addEventListener('webglcontextlost', onCtxLost);
    canvas.addEventListener('webglcontextrestored', onCtxRestored);

    return () => {
      cancelAnimationFrame(frameRef.current);
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      engine.dispose();
      engineRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
      canvas.removeEventListener('mouseenter', onMouseEnter);
      document.removeEventListener('visibilitychange', onVisChange);
      canvas.removeEventListener('webglcontextlost', onCtxLost);
      canvas.removeEventListener('webglcontextrestored', onCtxRestored);
    };
  }, [onMouseMove, onTouchStart, onTouchMove]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
      }}
    />
  );
}
