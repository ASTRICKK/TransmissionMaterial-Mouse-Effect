'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useControls, folder } from 'leva';
import { FluidSimulation } from './fluidSimulation';

export default function MouseFluid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<FluidSimulation | null>(null);

  // ── Leva Controls ───────────────────────────────────────

  const controls = useControls({
    quality: {
      value: 1024,
      options: { high: 1024, medium: 512, low: 256, 'very low': 128 },
      label: 'Quality',
    },
    simResolution: {
      value: 128,
      options: { '32': 32, '64': 64, '128': 128, '256': 256 },
      label: 'Sim Resolution',
    },
    densityDiffusion: { value: 18.88, min: 0, max: 20.0, step: 0.01, label: 'Density Diffusion' },
    velocityDiffusion: { value: 0.20, min: 0, max: 4.0, step: 0.01, label: 'Velocity Diffusion' },
    pressure: { value: 0, min: 0.0, max: 1.0, step: 0.01, label: 'Pressure' },
    vorticity: { value: 5, min: 0, max: 50, step: 1, label: 'Vorticity' },
    splatRadius: { value: 0, min: 0, max: 1.0, step: 0.01, label: 'Splat Radius' },
    shading: { value: true, label: 'Shading' },
    colorful: { value: true, label: 'Colorful' },
    bloom: folder({
      bloomEnabled: { value: true, label: 'Enabled' },
      bloomIntensity: { value: 0.8, min: 0.1, max: 2.0, step: 0.1, label: 'Intensity' },
      bloomThreshold: { value: 0.6, min: 0.0, max: 1.0, step: 0.1, label: 'Threshold' },
    }),
    sunrays: folder({
      sunraysEnabled: { value: true, label: 'Enabled' },
      sunraysWeight: { value: 1.0, min: 0.3, max: 1.0, step: 0.1, label: 'Weight' },
    }),
    velocitySplat: folder({
      velocitySplatEnabled: { value: true, label: 'Velocity Splat' },
      velocityMaxRadius: { value: 0.12, min: 0.01, max: 2.0, step: 0.01, label: 'Max Radius' },
      velocitySensitivity: { value: 0.03, min: 0.001, max: 0.1, step: 0.001, label: 'Sensitivity' },
      velocitySpeedBoost: { value: 1.00, min: 0.001, max: 10.0, step: 0.01, label: 'Speed Boost' },
      velocityThreshold: { value: 0, min: 0.0, max: 0.01, step: 0.0001, label: 'Speed Threshold' },
    }),
    backgroundColor: { value: '#000000', label: 'Background Color' },
    transmissionMaterial1: folder({
      transmission1Enabled: { value: false, label: 'TransmissionMaterial1' },
      caSpread1: { value: 0.0, min: 0.0, max: 50.0, step: 0.1, label: 'CA Spread' },
      caIntensity1: { value: 0.90, min: 0.0, max: 2.0, step: 0.01, label: 'CA Intensity' },
      caEdgeWidth1: { value: 0.01, min: 0.01, max: 0.5, step: 0.01, label: 'CA Edge Width' },
      caHueShift1: { value: -5.8, min: -6.28, max: 6.28, step: 0.1, label: 'CA Hue Shift' },
      specPower1: { value: 96, min: 1.0, max: 256.0, step: 1.0, label: 'Specular Power' },
      specIntensity1: { value: 0.35, min: 0.0, max: 1.0, step: 0.01, label: 'Specular Intensity' },
      fresnelPower1: { value: 10.0, min: -10.0, max: 10.0, step: 0.1, label: 'Fresnel Power' },
      fresnelIntensity1: { value: 0.00, min: -10.0, max: 1.0, step: 0.01, label: 'Fresnel Intensity' },
      lighting3d1: { value: true, label: 'Shadow/AO' },
    }),
    transmissionMaterial2: folder({
      transmission2Enabled: { value: false, label: 'TransmissionMaterial2' },
      ior2: { value: 1.45, min: 1.0, max: 2.5, step: 0.01, label: 'IOR' },
      thickness2: { value: 2.5, min: 0.0, max: 10.0, step: 0.05, label: 'Thickness' },
      caSpread2: { value: 0.15, min: 0.0, max: 1.0, step: 0.01, label: 'CA Spread' },
      caIntensity2: { value: 0.6, min: 0.0, max: 2.0, step: 0.01, label: 'CA Intensity' },
      caEdgeWidth2: { value: 0.02, min: 0.001, max: 0.2, step: 0.001, label: 'CA Edge Width' },
      gradAmp2: { value: 3.0, min: 1.0, max: 20.0, step: 0.1, label: 'Gradient Amplify' },
      roughness2: { value: 0.0, min: 0.0, max: 1.0, step: 0.01, label: 'Roughness' },
      causticInt2: { value: 0.5, min: 0.0, max: 2.0, step: 0.01, label: 'Caustic Intensity' },
      specPower2: { value: 64, min: 1.0, max: 1024.0, step: 1.0, label: 'Specular Power' },
      specIntensity2: { value: 0.4, min: 0.0, max: 1.0, step: 0.01, label: 'Specular Intensity' },
      fresnelPower2: { value: 3.0, min: 0.5, max: 10.0, step: 0.1, label: 'Fresnel Power' },
      fresnelIntensity2: { value: 0.2, min: 0.0, max: 1.0, step: 0.01, label: 'Fresnel Intensity' },
      lighting3d2: { value: true, label: '3D Lighting' },
    }),
    transmissionMaterial3: folder({
      transmission3Enabled: { value: false, label: 'TransmissionMaterial3' },
      ior3: { value: 1.45, min: 1.0, max: 2.5, step: 0.01, label: 'IOR' },
      thickness3: { value: 2.5, min: 0.0, max: 10.0, step: 0.05, label: 'Thickness' },
      caSpread3: { value: 0.15, min: 0.0, max: 1.0, step: 0.01, label: 'CA Spread' },
      caIntensity3: { value: 0.6, min: 0.0, max: 2.0, step: 0.01, label: 'CA Intensity' },
      caEdgeWidth3: { value: 0.02, min: 0.001, max: 0.2, step: 0.001, label: 'CA Edge Width' },
      gradAmp3: { value: 3.0, min: 1.0, max: 20.0, step: 0.1, label: 'Gradient Amplify' },
      roughness3: { value: 0.0, min: 0.0, max: 1.0, step: 0.01, label: 'Roughness' },
      causticInt3: { value: 0.5, min: 0.0, max: 2.0, step: 0.01, label: 'Caustic Intensity' },
      specPower3: { value: 64, min: 1.0, max: 1024.0, step: 1.0, label: 'Specular Power' },
      specIntensity3: { value: 0.4, min: 0.0, max: 1.0, step: 0.01, label: 'Specular Intensity' },
      fresnelPower3: { value: 3.0, min: 0.5, max: 10.0, step: 0.1, label: 'Fresnel Power' },
      fresnelIntensity3: { value: 0.2, min: 0.0, max: 1.0, step: 0.01, label: 'Fresnel Intensity' },
      lighting3d3: { value: true, label: '3D Lighting' },
    }),
  });

  // ── Sync Leva → Simulation ──────────────────────────────

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;

    // Parse background color hex
    const hex = controls.backgroundColor;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const needsReinit =
      sim.config.DYE_RESOLUTION !== controls.quality ||
      sim.config.SIM_RESOLUTION !== controls.simResolution;

    sim.config.DYE_RESOLUTION = controls.quality;
    sim.config.SIM_RESOLUTION = controls.simResolution;
    sim.config.DENSITY_DISSIPATION = controls.densityDiffusion;
    sim.config.VELOCITY_DISSIPATION = controls.velocityDiffusion;
    sim.config.PRESSURE = controls.pressure;
    sim.config.CURL = controls.vorticity;
    sim.config.SPLAT_RADIUS = controls.splatRadius;
    sim.config.SHADING = controls.shading;
    sim.config.COLORFUL = controls.colorful;
    sim.config.BLOOM = controls.bloomEnabled;
    sim.config.BLOOM_INTENSITY = controls.bloomIntensity;
    sim.config.BLOOM_THRESHOLD = controls.bloomThreshold;
    sim.config.SUNRAYS = controls.sunraysEnabled;
    sim.config.SUNRAYS_WEIGHT = controls.sunraysWeight;
    sim.config.TRANSMISSION1 = controls.transmission1Enabled;
    sim.config.TRANSMISSION1_CA = controls.caSpread1;
    sim.config.TRANSMISSION1_CA_INTENSITY = controls.caIntensity1;
    sim.config.TRANSMISSION1_CA_EDGE_WIDTH = controls.caEdgeWidth1;
    sim.config.TRANSMISSION1_CA_HUE_SHIFT = controls.caHueShift1;
    sim.config.TRANSMISSION1_SPEC_POWER = controls.specPower1;
    sim.config.TRANSMISSION1_SPEC_INTENSITY = controls.specIntensity1;
    sim.config.TRANSMISSION1_FRESNEL_POWER = controls.fresnelPower1;
    sim.config.TRANSMISSION1_FRESNEL_INTENSITY = controls.fresnelIntensity1;
    sim.config.TRANSMISSION1_LIGHTING = controls.lighting3d1;
    sim.config.TRANSMISSION2 = controls.transmission2Enabled;
    sim.config.TRANSMISSION2_IOR = controls.ior2;
    sim.config.TRANSMISSION2_THICKNESS = controls.thickness2;
    sim.config.TRANSMISSION2_CA_SPREAD = controls.caSpread2;
    sim.config.TRANSMISSION2_CA_INTENSITY = controls.caIntensity2;
    sim.config.TRANSMISSION2_CA_EDGE_WIDTH = controls.caEdgeWidth2;
    sim.config.TRANSMISSION2_GRAD_AMP = controls.gradAmp2;
    sim.config.TRANSMISSION2_ROUGHNESS = controls.roughness2;
    sim.config.TRANSMISSION2_CAUSTIC_INT = controls.causticInt2;
    sim.config.TRANSMISSION2_SPEC_POWER = controls.specPower2;
    sim.config.TRANSMISSION2_SPEC_INTENSITY = controls.specIntensity2;
    sim.config.TRANSMISSION2_FRESNEL_POWER = controls.fresnelPower2;
    sim.config.TRANSMISSION2_FRESNEL_INTENSITY = controls.fresnelIntensity2;
    sim.config.TRANSMISSION2_LIGHTING = controls.lighting3d2;
    sim.config.TRANSMISSION3 = controls.transmission3Enabled;
    sim.config.TRANSMISSION3_IOR = controls.ior3;
    sim.config.TRANSMISSION3_THICKNESS = controls.thickness3;
    sim.config.TRANSMISSION3_CA_SPREAD = controls.caSpread3;
    sim.config.TRANSMISSION3_CA_INTENSITY = controls.caIntensity3;
    sim.config.TRANSMISSION3_CA_EDGE_WIDTH = controls.caEdgeWidth3;
    sim.config.TRANSMISSION3_GRAD_AMP = controls.gradAmp3;
    sim.config.TRANSMISSION3_ROUGHNESS = controls.roughness3;
    sim.config.TRANSMISSION3_CAUSTIC_INT = controls.causticInt3;
    sim.config.TRANSMISSION3_SPEC_POWER = controls.specPower3;
    sim.config.TRANSMISSION3_SPEC_INTENSITY = controls.specIntensity3;
    sim.config.TRANSMISSION3_FRESNEL_POWER = controls.fresnelPower3;
    sim.config.TRANSMISSION3_FRESNEL_INTENSITY = controls.fresnelIntensity3;
    sim.config.TRANSMISSION3_LIGHTING = controls.lighting3d3;
    sim.config.VELOCITY_SPLAT = controls.velocitySplatEnabled;
    sim.config.VELOCITY_MAX_RADIUS = controls.velocityMaxRadius;
    sim.config.VELOCITY_SENSITIVITY = controls.velocitySensitivity;
    sim.config.VELOCITY_SPEED_BOOST = controls.velocitySpeedBoost;
    sim.config.VELOCITY_THRESHOLD = controls.velocityThreshold;
    sim.config.BACK_COLOR = { r, g, b };

    sim.updateKeywords();
    if (needsReinit) sim.initFramebuffers();
  }, [controls]);

  // ── Pointer Event Handlers ──────────────────────────────

  const handleMouseDown = useCallback((e: MouseEvent) => {
    const sim = simRef.current;
    if (!sim) return;
    const posX = scaleByPixelRatio(e.offsetX);
    const posY = scaleByPixelRatio(e.offsetY);
    sim.updatePointerDownData(sim.pointers[0], -1, posX, posY);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const sim = simRef.current;
    if (!sim) return;
    const pointer = sim.pointers[0];
    if (!pointer.down) return;
    const posX = scaleByPixelRatio(e.offsetX);
    const posY = scaleByPixelRatio(e.offsetY);
    sim.updatePointerMoveData(pointer, posX, posY);
  }, []);

  const handleMouseUp = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.updatePointerUpData(sim.pointers[0]);
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const sim = simRef.current;
    if (!sim) return;
    const touches = e.targetTouches;
    while (touches.length >= sim.pointers.length) {
      sim.pointers.push({
        id: -1,
        texcoordX: 0, texcoordY: 0,
        prevTexcoordX: 0, prevTexcoordY: 0,
        deltaX: 0, deltaY: 0,
        down: false, moved: false,
        color: { r: 30, g: 0, b: 300 },
      });
    }
    for (let i = 0; i < touches.length; i++) {
      const posX = scaleByPixelRatio(touches[i].pageX);
      const posY = scaleByPixelRatio(touches[i].pageY);
      sim.updatePointerDownData(sim.pointers[i + 1], touches[i].identifier, posX, posY);
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const sim = simRef.current;
    if (!sim) return;
    const touches = e.targetTouches;
    for (let i = 0; i < touches.length; i++) {
      const pointer = sim.pointers[i + 1];
      if (!pointer || !pointer.down) continue;
      const posX = scaleByPixelRatio(touches[i].pageX);
      const posY = scaleByPixelRatio(touches[i].pageY);
      sim.updatePointerMoveData(pointer, posX, posY);
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const sim = simRef.current;
    if (!sim) return;
    const touches = e.changedTouches;
    for (let i = 0; i < touches.length; i++) {
      const pointer = sim.pointers.find(p => p.id === touches[i].identifier);
      if (pointer) sim.updatePointerUpData(pointer);
    }
  }, []);

  // ── Init & Cleanup ──────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sim = new FluidSimulation(canvas);
    simRef.current = sim;

    // Attach event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove, false);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      sim.destroy();
      simRef.current = null;
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleTouchStart, handleTouchMove, handleTouchEnd]);

  // ── Render ──────────────────────────────────────────────

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

function scaleByPixelRatio(input: number) {
  const pixelRatio = window.devicePixelRatio || 1;
  return Math.floor(input * pixelRatio);
}