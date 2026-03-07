'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { VelocityPaintOilEngine } from './VelocityPaintOilEngine';
import type { VPOilConfig } from './VelocityPaintOilEngine';

interface R3VelocityPaintOilProps {
  config?: Partial<VPOilConfig>;
}

export default function R3VelocityPaintOil({ config }: R3VelocityPaintOilProps) {
  const { gl, size } = useThree();
  const engineRef = useRef<VelocityPaintOilEngine | null>(null);
  const rectRef = useRef<DOMRect | null>(null);

  // ── Init engine with R3F's GL context ──
  useEffect(() => {
    const glCtx = gl.getContext() as WebGL2RenderingContext;
    const engine = new VelocityPaintOilEngine(glCtx, config);
    engine.setDPR(gl.getPixelRatio());
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  // ── Sync config changes ──
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !config) return;
    Object.assign(engine.config, config);
  }, [config]);

  // ── Resize ──
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const dpr = gl.getPixelRatio();
    const w = Math.floor(size.width  * dpr);
    const h = Math.floor(size.height * dpr);
    engine.setDPR(dpr);
    engine.resize(w, h);
    rectRef.current = null;
  }, [gl, size]);

  // ── Frame loop — driven by R3F ──
  useFrame((_, dt) => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.update(Math.min(dt, 1 / 60), performance.now());

    // Re-sync Three.js internal state after raw GL calls
    gl.resetState();
  });

  // ── Mouse/Touch Events ──
  const onPointerMove = useCallback((e: PointerEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    const canvas = gl.domElement;
    rectRef.current ??= canvas.getBoundingClientRect();
    engine.onMove(e.clientX, e.clientY, rectRef.current);
  }, [gl]);

  useEffect(() => {
    const canvas = gl.domElement;
    const onMouseEnter = () => engineRef.current?.resetCursorState();

    window.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('mouseenter', onMouseEnter);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('mouseenter', onMouseEnter);
    };
  }, [gl, onPointerMove]);

  return null;
}
