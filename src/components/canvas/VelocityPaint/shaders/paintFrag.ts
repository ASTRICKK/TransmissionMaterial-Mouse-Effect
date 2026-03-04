const PAINT_FRAG_BODY = `precision highp float;
precision highp sampler2D;

uniform sampler2D t_blurredPaint;
uniform sampler2D t_prevFrame;
uniform vec2 v_texelSize;
uniform vec2 v_scrollDelta;
uniform vec4 p_segFrom;
uniform vec4 p_segTo;
uniform float p_spread;
uniform vec4 p_decay;
uniform vec2 p_motionVec;

#ifdef USE_NOISE
uniform float n_scale;
uniform float n_strength;
#endif

in vec2 vUv;
out vec4 fragColor;

#ifdef USE_NOISE
// PCG-style integer hash — two independent axes
vec2 pcgGrad(ivec2 cell) {
    uvec2 s = uvec2(cell);
    s = s * 1664525u + 1013904223u;
    s.x += s.y * 1664525u;
    s.y += s.x * 1664525u;
    s ^= s >> 16u;
    return vec2(s & 0x7FFFFFFFu) * (2.0 / float(0x7FFFFFFF)) - 1.0;
}

// Simplex 2D noise — returns: .x = value  .yz = (dn/dx, dn/dy)
vec3 paintNoise(vec2 p) {
    const float F2 = 0.36602540378;  // (sqrt(3) - 1) / 2  — skew
    const float G2 = 0.21132486540;  // (3 - sqrt(3)) / 6  — unskew

    // Skew to simplex cell
    vec2  s  = floor(p + dot(p, vec2(F2)));
    vec2  x0 = p - s + dot(s, vec2(G2));

    // Simplex triangle: which half?
    vec2  e  = step(x0.yx, x0.xy);
    vec2  i1 = e - e.yx * e;       // offset to middle vertex
    vec2  x1 = x0 - i1 + G2;
    vec2  x2 = x0 - 1.0 + 2.0 * G2;

    // Gradients at three simplex vertices
    vec2 g0 = pcgGrad(ivec2(s));
    vec2 g1 = pcgGrad(ivec2(s + i1));
    vec2 g2 = pcgGrad(ivec2(s + 1.0));

    // Radial falloff weights (0.5 - r^2, clamped)
    vec3 w  = max(0.5 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
    vec3 w2 = w * w;
    vec3 w3 = w2 * w;
    vec3 w4 = w2 * w2;

    // Noise value = sum of weighted gradient projections
    vec3 gd = vec3(dot(g0, x0), dot(g1, x1), dot(g2, x2));
    float n = dot(w4, gd) * 70.0;

    // Analytic derivatives
    vec2 dn = -8.0 * 70.0 * (w3.x * gd.x * x0 + w3.y * gd.y * x1 + w3.z * gd.z * x2)
              + 70.0 * (w4.x * g0 + w4.y * g1 + w4.z * g2);

    return vec3(n, dn);
}
#endif

void main() {
    const vec2 kVelCenter = vec2(0.5);

    // Closest point on brush stroke segment
    vec2  segAB   = p_segTo.xy - p_segFrom.xy;
    vec2  toFrag  = gl_FragCoord.xy - p_segFrom.xy;
    float segLen2 = max(dot(segAB, segAB), 1e-6);
    float segT    = clamp(dot(toFrag, segAB) / segLen2, 0.0, 1.0);
    vec2  sr      = mix(p_segFrom.zw, p_segTo.zw, segT);

    const float kBrushAA = 0.5;
    float brushDist = length(toFrag - segAB * segT);
    float brush     = 1.0 - smoothstep(-kBrushAA, sr.x, brushDist);

    // Self-advection: negative feedback from blurred flow field
    vec4 lowSample = texture(t_blurredPaint, vUv - v_scrollDelta);
    vec2 flowField = lowSample.xy - kVelCenter;
    vec2 pushVec   = flowField * (-p_spread);

    #ifdef USE_NOISE
    vec2  nP   = gl_FragCoord.xy * n_scale;
    vec3  nVal = paintNoise(nP);
    vec2  swirl = vec2(nVal.z, -nVal.y);

    #ifdef USE_NOISE_2OCT
    const mat2 kOctRot = mat2(1.6, 1.2, -1.2, 1.6);
    swirl = pcgGrad(ivec2(kOctRot * nP + nVal.yz * 0.15));
    #endif

    float curlMask = smoothstep(0.35, 0.02, length(lowSample.xy - 0.5));
    pushVec += swirl * (dot(lowSample.zw, vec2(1.0)) * n_strength * curlMask);
    #endif

    vec4 frag = texture(t_prevFrame, vUv - v_scrollDelta + pushVec * v_texelSize);
    vec2 vel  = frag.xy - kVelCenter;

    // Velocity: direct decay + splat injection (single MAD per component)
    vel = vel * p_decay.xy + p_motionVec * brush;

    // Weight: decay towards target with minimum-magnitude floor
    float brushW = sr.y * brush;
    vec2 wTarget = frag.zw * p_decay.zw + vec2(brushW);
    vec2 wDelta  = wTarget - frag.zw;
    const float kWeightFloor = 1.0 / 255.0;
    wDelta = mix(sign(wDelta) * kWeightFloor, wDelta, step(kWeightFloor, abs(wDelta)));
    frag.zw += wDelta;

    fragColor = clamp(vec4(vel + kVelCenter, frag.zw), vec4(0.0), vec4(1.0));
}
`;

export const PAINT_FRAG         = `#version 300 es\n`                                       + PAINT_FRAG_BODY;
export const PAINT_FRAG_NOISE   = `#version 300 es\n#define USE_NOISE\n`                    + PAINT_FRAG_BODY;
export const PAINT_FRAG_NOISE_2 = `#version 300 es\n#define USE_NOISE\n#define USE_NOISE_2OCT\n` + PAINT_FRAG_BODY;
