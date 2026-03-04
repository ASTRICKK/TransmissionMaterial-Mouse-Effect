export const DISTORT_FRAG = `#version 300 es
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
    const vec2 alpha = vec2(0.7548776662466927, 0.5698402909980532);
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
