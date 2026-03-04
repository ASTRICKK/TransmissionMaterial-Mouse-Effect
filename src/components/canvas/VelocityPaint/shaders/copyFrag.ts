export const COPY_FRAG = `#version 300 es
precision mediump float;
precision mediump sampler2D;

in vec2 vUv;
out vec4 fragColor;
uniform sampler2D t_input;

void main() {
    fragColor = texture(t_input, vUv);
}
`;
