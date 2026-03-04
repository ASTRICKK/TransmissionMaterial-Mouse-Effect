export const SHIMMER_FRAG = `#version 300 es
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
uniform float u_time;

in vec2 vUv;
out vec4 fragColor;

// R2 quasi-random sequence
vec2 r2Jitter(vec2 seed) {
    const vec2 alpha = vec2(0.7548776662466927, 0.5698402909980532);
    return fract(seed * alpha);
}

// ── Thin-film interference ──────────────────────────────
// Maps optical path difference → visible color via wave interference.
// "thickness" controls the film's optical depth (like soap bubble thickness).
vec3 thinFilmColor(float cosTheta, float thickness) {
    // Optical path difference (OPD) for a thin film with n ≈ 1.33 (water/soap)
    // OPD = 2 * n * d * cos(theta_refracted)
    // We simplify: use cosTheta as proxy for viewing angle
    float opd = thickness * cosTheta;

    // Spectral interference: each RGB channel = different wavelength
    // R ≈ 650nm, G ≈ 530nm, B ≈ 460nm — normalized to [0,1] range
    const vec3 wavelengths = vec3(0.650, 0.530, 0.460);

    // Phase difference per channel: delta = 2*PI * OPD / lambda
    vec3 phase = 6.28318530 * opd / wavelengths;

    // Reflectance ∝ sin²(delta/2) — constructive/destructive interference
    vec3 s = sin(phase * 0.5);
    return s * s;
}

// ── Flow-field gradient → pseudo-normal ─────────────────
// Computes a surface normal from the velocity paint field,
// treating the flow magnitude as a height map.
vec3 flowNormal(vec2 uv, vec2 texel) {
    float l = dot(texture(t_velPaint, uv - vec2(texel.x, 0.0)).zw, vec2(0.5));
    float r = dot(texture(t_velPaint, uv + vec2(texel.x, 0.0)).zw, vec2(0.5));
    float d = dot(texture(t_velPaint, uv - vec2(0.0, texel.y)).zw, vec2(0.5));
    float u = dot(texture(t_velPaint, uv + vec2(0.0, texel.y)).zw, vec2(0.5));

    // Sobel-like gradient
    vec2 grad = vec2(r - l, u - d) * 8.0;

    return normalize(vec3(-grad, 1.0));
}


void main() {
    vec2 jitter = r2Jitter(gl_FragCoord.xy);

    vec4  velTex   = texture(t_velPaint, vUv);
    float paintMix = dot(velTex.zw, vec2(0.5));
    vec2  flowDir  = velTex.xy * (-2.0 * paintMix) + (paintMix * (1023.0 / 1024.0));

    // Directional blur along flow field (same as refract)
    vec2 stepVec  = flowDir * p_stepScale * v_paintTexel;
    vec2 sampleUV = vUv + jitter * stepVec;
    vec4 result   = vec4(0.0);
    for (int i = 0; i < 8; i++) {
        result += texture(t_scene, sampleUV);
        sampleUV += stepVec;
    }
    result *= 0.125;

    // ── Iridescence (thin-film interference) ────────────
    vec3  N        = flowNormal(vUv, v_paintTexel);
    // View direction: fixed top-down, but modulated by flow
    vec3  V        = normalize(vec3(flowDir * 0.5, 1.0));
    float cosTheta = max(dot(N, V), 0.0);

    // Fresnel term — stronger iridescence at grazing angles
    float fresnel = pow(1.0 - cosTheta, p_fresnelPower);

    // Thin-film color based on flow magnitude as "thickness"
    float flowMag   = length(flowDir);
    float thickness = p_filmThickness * (0.3 + flowMag * 2.0);

    // Add time-based shimmer — very subtle shifting
    thickness += sin(u_time * 0.5 + dot(vUv, vec2(7.0, 13.0))) * 0.05;

    vec3 iridescentColor = thinFilmColor(cosTheta, thickness);

    // Mix iridescence into the result
    // Intensity ramp: strongest at edges/movement, fades with paint density
    float edgeRamp = 1.0 - smoothstep(-0.9, 0.4, paintMix);
    float absFlow  = max(abs(flowDir.x), abs(flowDir.y));
    float iriMask  = edgeRamp * absFlow * fresnel;

    result.rgb += iridescentColor * (iriMask * p_iridIntensity * p_edgeShade);

    // Subtle specular highlight on the "surface"
    vec3  H       = normalize(V + vec3(0.0, 0.0, 1.0));
    float spec    = pow(max(dot(N, H), 0.0), 32.0);
    result.rgb   += vec3(spec * iriMask * 0.3);

    fragColor = result;
}
`;
