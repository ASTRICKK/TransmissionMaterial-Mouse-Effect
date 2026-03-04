export const BLUR_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D t_input;
uniform vec2 v_texelSize;
uniform vec2 v_blurDir;

in vec2 vUv;
out vec4 fragColor;

void main() {
    vec4 accum = vec4(0.0);
    vec2 s1 = v_blurDir * v_texelSize * 1.3846153846;
    vec2 s2 = v_blurDir * v_texelSize * 3.2307692308;
    accum += texture(t_input, vUv)      * 0.2270270270;
    accum += texture(t_input, vUv + s1) * 0.3162162162;
    accum += texture(t_input, vUv - s1) * 0.3162162162;
    accum += texture(t_input, vUv + s2) * 0.0702702703;
    accum += texture(t_input, vUv - s2) * 0.0702702703;
    fragColor = accum;
}
`;
