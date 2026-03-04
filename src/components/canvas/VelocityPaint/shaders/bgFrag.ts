export const BG_FRAG = `#version 300 es
precision highp float;

uniform vec3 u_centerColor;
uniform vec3 u_edgeColor;
uniform float u_aspect;
uniform float u_time;

in vec2 vUv;
out vec4 fragColor;

float filmGrain(vec3 p) {
    // Three-axis fold hash — vec3 scale + .zxy cross-mix
    p = fract(p * vec3(0.1179, 0.1323, 0.0917));
    p += dot(p, p.zxy + 39.47);
    return fract((p.y + p.z) * p.x);
}

void main() {
    vec2 q = vUv - 0.5;
    q.x *= u_aspect;
    float r = smoothstep(0.2, 1.2, length(q));
    vec3 color = mix(u_centerColor, u_edgeColor, 0.925 + 0.075 * r);
    color += (filmGrain(vec3(gl_FragCoord.xy, u_time)) - 0.5) / 255.0;
    fragColor = vec4(color, 1.0);
}
`;
