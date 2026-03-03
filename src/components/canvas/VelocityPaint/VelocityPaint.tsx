'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useControls, folder } from 'leva';
import { VelocityPaintEngine } from './velocityPaintEngine';

export default function VelocityPaint() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<VelocityPaintEngine | null>(null);

  // ── Leva Controls ──────────────────────────────────────

  const controls = useControls('VelocityPaint', {
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
    distortion: folder({
      distortionAmount:  { value: 3,    min: 0,  max: 100, step: 0.5,  label: 'Amount' },
      chromaticShift:    { value: 0.5,  min: 0,  max: 5,   step: 0.1,  label: 'Chromatic Shift' },
      velocityScale:     { value: 5,    min: 0,  max: 20,  step: 0.05, label: 'Velocity Scale' },
      colorBoost:        { value: 10,   min: 0,  max: 30,  step: 0.1,  label: 'Color Boost' },
      edgeShade:         { value: 1.25, min: 0,  max: 5,   step: 0.05, label: 'Edge Shade' },
    }),
    backgroundColor: { value: '#11131a', label: 'Background' },
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
    engine.config.chromaticShift      = controls.chromaticShift;
    engine.config.velocityScale       = controls.velocityScale;
    engine.config.colorBoost          = controls.colorBoost;
    engine.config.edgeShade           = controls.edgeShade;
    engine.config.bgColor             = { r, g, b };
  }, [controls]);

  // ── Event Handlers ─────────────────────────────────────

  const onMouseMove  = useCallback((e: MouseEvent) => engineRef.current?.onMove(e.clientX, e.clientY), []);
  const onMouseDown  = useCallback(() => engineRef.current?.onDown(), []);
  const onMouseUp    = useCallback(() => engineRef.current?.onUp(), []);

  const onTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) { engineRef.current?.onDown(); engineRef.current?.onMove(t.clientX, t.clientY); }
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) engineRef.current?.onMove(t.clientX, t.clientY);
  }, []);

  const onTouchEnd = useCallback(() => engineRef.current?.onUp(), []);

  // ── Init / Cleanup ─────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new VelocityPaintEngine(canvas);
    engineRef.current = engine;

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup',   onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    window.addEventListener('touchend',   onTouchEnd);

    return () => {
      engine.dispose();
      engineRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup',   onMouseUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
      window.removeEventListener('touchend',   onTouchEnd);
    };
  }, [onMouseMove, onMouseDown, onMouseUp, onTouchStart, onTouchMove, onTouchEnd]);

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
