export const OIL_FRAG = `#version 300 es
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
uniform float p_darkness;

in vec2 vUv;
out vec4 fragColor;

// R2 quasi-random sequence
vec2 r2Jitter(vec2 seed) {
    const vec2 alpha = vec2(0.7548776662466927, 0.5698402909980532);
    return fract(seed * alpha);
}

// ── Oil-slick color mapping ─────────────────────────────
// Real oil films on dark surfaces produce very specific colors:
//   - Dominant: deep violet/purple, dark magenta
//   - Secondary: dark teal/cyan, steel blue
//   - Tertiary: muted olive/dark amber, faint green
//   - Overall: extremely dark, wet, glossy
//
// Unlike bright iridescence, oil slick colors are MUTED and DEEP,
// appearing almost black except at certain viewing angles.
vec3 oilSlickColor(float opd) {
    const float PI2 = 6.28318530;

    // Oil refractive index n ≈ 1.48
    float effectiveOPD = opd * 1.48;

    // Broad wavelength bands — emphasis on purple/teal zone
    float phR  = PI2 * effectiveOPD / 0.680;
    float phO  = PI2 * effectiveOPD / 0.600;
    float phG  = PI2 * effectiveOPD / 0.530;
    float phT  = PI2 * effectiveOPD / 0.490;
    float phB  = PI2 * effectiveOPD / 0.450;
    float phV  = PI2 * effectiveOPD / 0.400;

    float rR = sin(phR); rR *= rR;
    float rO = sin(phO); rO *= rO;
    float rG = sin(phG); rG *= rG;
    float rT = sin(phT); rT *= rT;
    float rB = sin(phB); rB *= rB;
    float rV = sin(phV); rV *= rV;

    // Oil-specific RGB mapping:
    // Heavy violet/magenta in red channel (rV dominates)
    // Dark teal in green channel (rT dominates, suppressed)
    // Deep purple-blue in blue channel (rB + rV dominate)
    vec3 color = vec3(
        rV * 0.50 + rR * 0.15 + rO * 0.10 + rB * 0.25,
        rT * 0.45 + rG * 0.25 + rO * 0.10 + rV * 0.20,
        rB * 0.35 + rV * 0.35 + rT * 0.20 + rG * 0.10
    );

    // Crush toward darkness — oil is very dark, colors barely peek through
    color = color * color;  // Squared = darker, more contrast
    color = pow(color, vec3(0.65));

    // Zero-sum chromatic shift
    float avg = dot(color, vec3(0.33333));
    return color - avg;
}

// ── Viscous pooling warp ─────────────────────────────────
// Oil pools and drags slowly — thick, heavy distortion
vec2 oilPoolWarp(vec2 uv, float t, float viscosity) {
    float slowT = t * 0.05;
    // Low-frequency, heavy undulation
    float pool1 = sin(uv.y * 2.5 + slowT * 0.6) * cos(uv.x * 1.8 - slowT * 0.4);
    float pool2 = cos(uv.x * 3.0 + slowT * 0.8) * sin(uv.y * 2.0 - slowT * 0.3);
    // High-frequency ripple (very subtle)
    float ripple = sin(uv.x * 12.0 + uv.y * 8.0 + slowT * 2.0) * 0.15;
    return vec2(pool1 + ripple, pool2) * 0.003 * viscosity;
}

void main() {
    vec2 jitter = r2Jitter(gl_FragCoord.xy);

    vec4  velTex   = texture(t_velPaint, vUv);
    float paintMix = dot(velTex.zw, vec2(0.5));
    vec2  flowDir  = velTex.xy * (-2.0 * paintMix) + (paintMix * (1023.0 / 1024.0));

    // ── Directional blur — heavier for oil ──
    vec2 stepVec  = flowDir * p_stepScale * v_paintTexel;
    vec2 sampleUV = vUv + jitter * stepVec;

    // Viscous pooling distortion
    vec2 warp = oilPoolWarp(vUv, p_time, p_viscosity);
    sampleUV += warp * paintMix;

    vec4 result = vec4(0.0);
    for (int i = 0; i < 8; i++) {
        result += texture(t_scene, sampleUV);
        sampleUV += stepVec;
    }
    result *= 0.125;

    // ── Oil-slick iridescence ────────────────────────────
    float flowDot  = dot(flowDir, vec2(1.0, 0.7071));
    vec2  absFlow  = abs(flowDir);
    float flowPeak = max(absFlow.x, absFlow.y);

    // OPD with low frequencies for broad, dark color bands
    float opd1 = flowDot  * p_filmThickness * p_flowFreq;
    float opd2 = paintMix * p_filmThickness * p_weightFreq;

    // Very slow drift — oil is nearly still
    float timeDrift = sin(p_time * 0.04 + vUv.x * 1.5) * 0.04
                    + cos(p_time * 0.03 + vUv.y * 1.2) * 0.03;

    float opd = opd1 + opd2 + timeDrift;

    // Multi-layer interference — oil has many internal bounce paths
    vec3 shift1 = oilSlickColor(opd);
    vec3 shift2 = oilSlickColor(opd * 1.35 + 0.15);
    vec3 shift3 = oilSlickColor(opd * 1.85 + 0.4);
    vec3 shift4 = oilSlickColor(opd * 2.4  + 0.7);

    // 4-layer blend: each bounce adds subtlety, not brightness
    vec3 shift = shift1 * 0.40 + shift2 * 0.30 + shift3 * 0.20 + shift4 * 0.10;

    // Fresnel: oil has strong Fresnel at grazing angles
    float fresnelProxy = pow(flowPeak, 1.0 / p_fresnelPower);

    // Paint-density ramp — peaks at edges/thin areas
    float chromaRamp = 1.0 - smoothstep(-0.9, 0.35, paintMix);

    float mask = chromaRamp * fresnelProxy;

    // Apply chromatic modulation — very dark-based
    result.rgb += shift * (mask * p_iridIntensity * p_edgeShade);

    // ── Wet glossy darkening ─────────────────────────────
    // Oil absorbs light — darken painted areas toward near-black
    float wetDarken = mask * p_darkness * 0.15;
    result.rgb *= (1.0 - wetDarken);

    // Dark glossy edge sheen — oil is darkest at the edges
    float edgeDark = pow(1.0 - fresnelProxy * 0.4, 3.0) * chromaRamp * 0.12;
    result.rgb -= vec3(edgeDark) * p_edgeShade * 0.4;

    // Very subtle specular pinprick — oil reflects light sharply
    float specular = pow(fresnelProxy, 8.0) * chromaRamp * 0.05;
    result.rgb += vec3(specular) * p_iridIntensity * 0.15;

    // Transparency
    float paintPresence = clamp(mask * 3.0, 0.0, 1.0);
    fragColor = vec4(result.rgb, mix(p_bgOpacity, 1.0, paintPresence));
}
`;
