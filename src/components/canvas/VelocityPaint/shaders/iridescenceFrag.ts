export const IRIDESCENCE_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D t_scene;
uniform sampler2D t_velPaint;
uniform vec2 v_paintTexel;
uniform float p_stepScale;
uniform float p_filmThickness;
uniform float p_iridIntensity;
uniform float p_fresnelPower;
uniform float p_edgeShade;
uniform float p_flowFreq;
uniform float p_weightFreq;
uniform float p_bgOpacity;
uniform float p_time;
uniform float p_viscosity;
uniform float p_saturation;

in vec2 vUv;
out vec4 fragColor;

// R2 quasi-random sequence
vec2 r2Jitter(vec2 seed) {
    const vec2 alpha = vec2(0.7548776662466927, 0.5698402909980532);
    return fract(seed * alpha);
}

// ── Oil-film thin-film interference ─────────────────────
// Oil films are thicker than soap, producing broader, more
// saturated color bands. The refractive index of oil (~1.5)
// creates stronger reflections and deeper, richer hues.
//
// Key visual differences from soap:
//   - Deeper, darker tones (purple, teal, midnight blue)
//   - Broader color bands (fewer, wider stripes)
//   - More saturated, less pastel
//   - Metallic/glossy quality
vec3 oilFilmColor(float opd) {
    const float PI2 = 6.28318530;

    // Oil refractive index ~1.5 (vs soap ~1.33)
    // This increases optical path difference, shifting colors
    float n_oil = 1.50;
    float effectiveOPD = opd * n_oil;

    // Broader wavelength sampling for oil's thicker film
    // Emphasize the deep purple-teal-blue range
    float phaseR  = PI2 * effectiveOPD / 0.700;  // Deep red
    float phaseO  = PI2 * effectiveOPD / 0.620;  // Orange-amber
    float phaseG  = PI2 * effectiveOPD / 0.540;  // Green
    float phaseT  = PI2 * effectiveOPD / 0.500;  // Teal
    float phaseB  = PI2 * effectiveOPD / 0.460;  // Blue
    float phaseV  = PI2 * effectiveOPD / 0.410;  // Violet
    float phaseDV = PI2 * effectiveOPD / 0.380;  // Deep violet

    // Squared sine reflectance
    float rR  = pow(sin(phaseR),  2.0);
    float rO  = pow(sin(phaseO),  2.0);
    float rG  = pow(sin(phaseG),  2.0);
    float rT  = pow(sin(phaseT),  2.0);
    float rB  = pow(sin(phaseB),  2.0);
    float rV  = pow(sin(phaseV),  2.0);
    float rDV = pow(sin(phaseDV), 2.0);

    // Map to RGB with oil-specific weighting:
    // - Red channel: deep red + some violet (for magenta/purple)
    // - Green channel: green + teal (for the teal-green oil sheen)
    // - Blue channel: blue + violet + deep violet (dominant in oil)
    vec3 color = vec3(
        rR * 0.30 + rO * 0.15 + rV * 0.35 + rDV * 0.20,
        rG * 0.30 + rT * 0.40 + rO * 0.15 + rR * 0.15,
        rB * 0.30 + rV * 0.25 + rDV * 0.25 + rT * 0.20
    );

    // Oil produces more saturated, deeper colors
    // Boost contrast and push toward darker tones
    color = pow(color, vec3(0.75));

    // Zero-sum for additive compositing
    float avg = dot(color, vec3(0.33333));
    return color - avg;
}

// ── Viscous flow distortion — oil moves slowly, thickly ──
vec2 viscousWarp(vec2 uv, float t, float viscosity) {
    // Slow, heavy undulations like oil pooling
    float slowT = t * 0.08 * (1.0 - viscosity * 0.5);
    float wave1 = sin(uv.y * 4.0 + slowT) * cos(uv.x * 3.0 - slowT * 0.7);
    float wave2 = cos(uv.x * 5.0 + slowT * 1.3) * sin(uv.y * 2.5 - slowT * 0.5);
    return vec2(wave1, wave2) * 0.002 * viscosity;
}

void main() {
    vec2 jitter = r2Jitter(gl_FragCoord.xy);

    vec4  velTex   = texture(t_velPaint, vUv);
    float paintMix = dot(velTex.zw, vec2(0.5));
    vec2  flowDir  = velTex.xy * (-2.0 * paintMix) + (paintMix * (1023.0 / 1024.0));

    // ── Directional blur along flow field ──
    // Oil has heavier flow → slightly wider blur
    vec2 stepVec  = flowDir * p_stepScale * v_paintTexel;
    vec2 sampleUV = vUv + jitter * stepVec;

    // Add viscous oil-surface warp
    vec2 warp = viscousWarp(vUv, p_time, p_viscosity);
    sampleUV += warp * paintMix;

    vec4 result = vec4(0.0);
    for (int i = 0; i < 8; i++) {
        result += texture(t_scene, sampleUV);
        sampleUV += stepVec;
    }
    result *= 0.125;

    // ── Oil-film iridescence ────────────────────────────
    float flowDot  = dot(flowDir, vec2(1.0, 0.7071));
    vec2  absFlow  = abs(flowDir);
    float flowPeak = max(absFlow.x, absFlow.y);

    // OPD: oil uses lower frequencies for broader color bands
    float opd1 = flowDot  * p_filmThickness * p_flowFreq;
    float opd2 = paintMix * p_filmThickness * p_weightFreq;

    // Very slow time-based drift — oil barely moves
    float timeDrift = sin(p_time * 0.06 + vUv.x * 2.0) * 0.05
                    + cos(p_time * 0.04 + vUv.y * 1.8) * 0.04;

    float opd = opd1 + opd2 + timeDrift;

    // Triple-layer interference: oil films have multiple internal reflections
    vec3 shift1 = oilFilmColor(opd);
    vec3 shift2 = oilFilmColor(opd * 1.414 + 0.2);   // √2 offset — second reflection
    vec3 shift3 = oilFilmColor(opd * 2.0   + 0.5);   // Double — third reflection

    // Blend layers: primary dominant, secondary and tertiary add complexity
    vec3 shift = shift1 * 0.55 + shift2 * 0.30 + shift3 * 0.15;

    // Boost saturation for oil's richer colors
    float shiftLen = length(shift);
    if (shiftLen > 0.001) {
        shift = shift / shiftLen * pow(shiftLen, 1.0 / max(p_saturation, 0.1));
    }

    // Fresnel-like ramp: oil has stronger Fresnel due to higher refractive index
    float fresnelProxy = pow(flowPeak, 1.0 / p_fresnelPower);

    // Paint-density ramp
    float chromaRamp = 1.0 - smoothstep(-0.9, 0.4, paintMix);

    float mask = chromaRamp * fresnelProxy;

    // Apply iridescent color modulation
    result.rgb += shift * (mask * p_iridIntensity * p_edgeShade);

    // Oil has a subtle dark glossy sheen — darken slightly at edges
    float glossDarken = pow(1.0 - fresnelProxy * 0.3, 2.0) * chromaRamp * 0.08;
    result.rgb -= vec3(glossDarken) * p_edgeShade * 0.3;

    // Subtle glossy specular — more diffuse than soap bubble
    float specular = pow(fresnelProxy, 6.0) * chromaRamp * 0.08;
    result.rgb += vec3(specular) * p_iridIntensity * 0.2;

    // Transparency
    float paintPresence = clamp(mask * 3.0, 0.0, 1.0);
    fragColor = vec4(result.rgb, mix(p_bgOpacity, 1.0, paintPresence));
}
`;
