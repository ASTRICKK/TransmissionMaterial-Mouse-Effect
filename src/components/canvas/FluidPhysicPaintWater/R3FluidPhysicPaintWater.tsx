'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { FluidSimulation, FluidConfig } from '../MouseFluid/fluidSimulation';

interface R3FluidPhysicPaintWaterProps {
  config?: Partial<FluidConfig>;
}

/**
 * R3F variant of FluidPhysicPaintWater.
 * Creates an overlay canvas for the fluid simulation since FluidSimulation
 * manages its own WebGL context. The canvas is layered on top of the R3F scene.
 */
export default function R3FluidPhysicPaintWater({ config }: R3FluidPhysicPaintWaterProps) {
  const { gl, size } = useThree();
  const simRef = useRef<FluidSimulation | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const r3fCanvas = gl.domElement;
    const parent = r3fCanvas.parentElement;
    if (!parent) return;

    // Create overlay canvas matching R3F canvas
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'auto';
    parent.appendChild(canvas);
    canvasRef.current = canvas;

    const sim = new FluidSimulation(canvas, {
      TRANSMISSION2: true,
      TRANSMISSION1: false,
      BLOOM: false,
      SUNRAYS: false,
      VP1_ENABLED: false,
      CURL: 12,
      VELOCITY_SPLAT: true,
      VELOCITY_MAX_RADIUS: 0.38,
      TRANSMISSION2_IOR: 2.5,
      TRANSMISSION2_CA_INTENSITY: 2.00,
      TRANSMISSION2_CA_EDGE_WIDTH: 0.20,
      TRANSMISSION2_FRESNEL_POWER: 10.0,
      TRANSMISSION2_FRESNEL_INTENSITY: 0.50,
      ...config,
    });
    simRef.current = sim;

    // Mouse/Touch handlers
    const scaleByPixelRatio = (input: number) =>
      Math.floor(input * (window.devicePixelRatio || 1));

    const onMouseDown = (e: MouseEvent) => {
      sim.updatePointerDownData(
        sim.pointers[0], -1,
        scaleByPixelRatio(e.offsetX),
        scaleByPixelRatio(e.offsetY)
      );
    };
    const onMouseMove = (e: MouseEvent) => {
      const pointer = sim.pointers[0];
      if (!pointer.down) return;
      sim.updatePointerMoveData(
        pointer,
        scaleByPixelRatio(e.offsetX),
        scaleByPixelRatio(e.offsetY)
      );
    };
    const onMouseUp = () => sim.updatePointerUpData(sim.pointers[0]);

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      sim.destroy();
      simRef.current = null;
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      parent.removeChild(canvas);
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim || !config) return;
    Object.assign(sim.config, config);
    sim.updateKeywords();
  }, [config]);

  return null;
}
