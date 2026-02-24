/*
  GLSL Shaders ported from PavelDoGreat/WebGL-Fluid-Simulation
  MIT License - Copyright (c) 2017 Pavel Dobryakov
*/

export const baseVertexShaderSource = `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`;

export const blurVertexShaderSource = `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`;

export const blurShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
        sum += texture2D(uTexture, vL) * 0.35294117;
        sum += texture2D(uTexture, vR) * 0.35294117;
        gl_FragColor = sum;
    }
`;

export const copyShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`;

export const clearShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
    }
`;

export const colorShaderSource = `
    precision mediump float;

    uniform vec4 color;

    void main () {
        gl_FragColor = color;
    }
`;

export const checkerboardShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float aspectRatio;

    #define SCALE 25.0

    void main () {
        vec2 uv = floor(vUv * SCALE * vec2(aspectRatio, 1.0));
        float v = mod(uv.x + uv.y, 2.0);
        v = v * 0.1 + 0.8;
        gl_FragColor = vec4(vec3(v), 1.0);
    }
`;

export const displayShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform sampler2D uSunrays;
    uniform sampler2D uDithering;
    uniform vec2 ditherScale;
    uniform vec2 texelSize;

    // TransmissionMaterial1 (soap bubble) uniforms
    uniform float uChromaticAberration;
    uniform float uLighting;
    uniform float uCaIntensity;
    uniform float uCaEdgeWidth;
    uniform float uCaHueShift;
    uniform float uSpecPower3;
    uniform float uSpecIntensity3;
    uniform float uFresnelPower3;
    uniform float uFresnelIntensity3;

    // TransmissionMaterial2 (refraction caustics) uniforms
    uniform float uIor2;
    uniform float uThickness2;
    uniform float uCaSpread2;
    uniform float uCaIntensity2;
    uniform float uCaEdgeWidth2;
    uniform float uGradAmp2;
    uniform float uRoughness2;
    uniform float uCausticInt2;
    uniform float uSpecPower2;
    uniform float uSpecIntensity2;
    uniform float uFresnelPower2;
    uniform float uFresnelIntensity2;

    uniform vec3 uBackColor;

    vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0));
        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
    }

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;

    #ifdef TRANSMISSION1
        // ── TransmissionMaterial1 — Soap Bubble Effect ──
        // Center: transparent background. Edges: chromatic thin-film interference.
        // White specular highlights + fresnel edge glow.

        float density = length(c);
        float densL = length(texture2D(uTexture, vL).rgb);
        float densR = length(texture2D(uTexture, vR).rgb);
        float densT = length(texture2D(uTexture, vT).rgb);
        float densB = length(texture2D(uTexture, vB).rgb);

        vec2 vTL = vUv + vec2(-texelSize.x, texelSize.y);
        vec2 vTR = vUv + vec2(texelSize.x, texelSize.y);
        vec2 vBL = vUv + vec2(-texelSize.x, -texelSize.y);
        vec2 vBR = vUv + vec2(texelSize.x, -texelSize.y);
        float densTL = length(texture2D(uTexture, vTL).rgb);
        float densTR = length(texture2D(uTexture, vTR).rgb);
        float densBL = length(texture2D(uTexture, vBL).rgb);
        float densBR = length(texture2D(uTexture, vBR).rgb);

        // Sobel gradient for edge detection
        float dx = ((densR - densL) * 2.0 + (densTR - densTL) + (densBR - densBL)) * 0.25;
        float dy = ((densT - densB) * 2.0 + (densTR - densBR) + (densTL - densBL)) * 0.25;
        float gradientMag = length(vec2(dx, dy));

        // Surface normal for lighting
        vec3 normal = normalize(vec3(dx * 100.0, dy * 100.0, 1.0));

        // ── Edge mask — soap bubble colors only appear at edges ──
        float edgeMask = smoothstep(0.002, uCaEdgeWidth, gradientMag);

        // ── Background — center is transparent ──
        c = uBackColor;

        // ── Chromatic Aberration — thin-film interference at edges ──
        // Phase based on density + gradient position → rainbow shift
        float phase = density * 15.0 + gradientMag * 40.0 + uCaHueShift;

        // Tangent-based UV offset for chromatic separation
        vec2 gradDir = gradientMag > 0.001 ? normalize(vec2(dx, dy)) : vec2(0.0);
        vec2 tangent = vec2(-gradDir.y, gradDir.x);
        float caStr = uChromaticAberration * 60.0;

        // Sample at offset UVs for R/G/B separation
        vec2 rUV = clamp(vUv + (tangent * caStr + gradDir * caStr * 0.8) * texelSize * gradientMag, 0.0, 1.0);
        vec2 gUV = clamp(vUv + gradDir * caStr * 0.3 * texelSize * gradientMag, 0.0, 1.0);
        vec2 bUV = clamp(vUv + (-tangent * caStr + gradDir * caStr * 0.6) * texelSize * gradientMag, 0.0, 1.0);

        float rVal = length(texture2D(uTexture, rUV).rgb);
        float gVal = length(texture2D(uTexture, gUV).rgb);
        float bVal = length(texture2D(uTexture, bUV).rgb);

        // Thin-film interference colors
        vec3 thinFilm = vec3(
            sin(phase) * 0.5 + 0.5,
            sin(phase + 2.094) * 0.5 + 0.5,
            sin(phase + 4.189) * 0.5 + 0.5
        );

        // Chromatic dispersion from UV offsets
        vec3 rawChromatic = vec3(
            abs(rVal - gVal) + abs(rVal - density) * 0.4,
            abs(gVal - rVal) * 0.5 + abs(gVal - bVal) * 0.5,
            abs(bVal - gVal) + abs(bVal - density) * 0.4
        );
        float chromMax = max(rawChromatic.r, max(rawChromatic.g, rawChromatic.b));
        vec3 chromaticColor = chromMax > 0.001 ? rawChromatic / chromMax * min(chromMax, 1.0) : vec3(0.0);

        // Mix thin-film + chromatic dispersion, apply at edges only
        vec3 caColor = mix(chromaticColor, thinFilm * chromaticColor + thinFilm * 0.3, 0.6);
        caColor *= edgeMask * uCaIntensity;

        // ── Adaptive blend — works on both dark AND light backgrounds ──
        float bgLum = dot(uBackColor, vec3(0.299, 0.587, 0.114));
        float darkFactor = 1.0 - bgLum; // 1 on dark bg, 0 on light bg

        // Dark bg: full additive. Light bg: softer pastel tint (no white glow)
        vec3 caFull = caColor;
        vec3 caSoft = caColor * 0.35;
        c += mix(caFull, caSoft, bgLum);

        // ── Fresnel — only on dark backgrounds ──
        float fresnelEdge = pow(edgeMask, uFresnelPower3);
        c += vec3(0.8, 0.85, 1.0) * fresnelEdge * uFresnelIntensity3 * darkFactor;

        // ── Specular — only on dark backgrounds ──
        vec3 keyLight = normalize(vec3(0.5, 0.7, 1.0));
        float keySpec = pow(max(dot(normal, keyLight), 0.0), uSpecPower3) * uSpecIntensity3;
        vec3 fillLight = normalize(vec3(-0.6, 0.3, 1.0));
        float fillSpec = pow(max(dot(normal, fillLight), 0.0), uSpecPower3 * 0.5) * uSpecIntensity3 * 0.4;
        vec3 rimLight = normalize(vec3(0.0, -0.5, 1.0));
        float rimSpec = pow(max(dot(normal, rimLight), 0.0), uSpecPower3 * 0.3) * uSpecIntensity3 * 0.2;

        float presenceMask = smoothstep(0.0, 0.02, density);
        float totalSpec = (keySpec + fillSpec + rimSpec) * presenceMask;
        c += vec3(1.0, 0.98, 0.95) * totalSpec * darkFactor;

        // ── Shadow/AO from curvature ──
        if (uLighting > 0.5) {
          float laplacian = (densL + densR + densT + densB) - 4.0 * density;
          float shadow = clamp(laplacian * 3.0, -0.08, 0.0);
          float causticFocus = clamp(-laplacian * 5.0, 0.0, 0.12);
          c += shadow;
          c += vec3(0.9, 0.95, 1.0) * causticFocus * presenceMask;

          float directional = dot(normal.xy, vec2(0.4, 0.6)) * 0.03 * presenceMask;
          c += directional;
        }

        gl_FragColor = vec4(c, 1.0);

    #elif defined(TRANSMISSION2)
        // ── TransmissionMaterial2 — Refraction Caustics + True Chromatic Aberration ──
        // IOR-based Snell's law refraction with wavelength-dependent RGB separation.
        // Inspired by lusion.co — glass/water medium with prismatic light bending.

        float density = length(c);
        float densL = length(texture2D(uTexture, vL).rgb);
        float densR = length(texture2D(uTexture, vR).rgb);
        float densT = length(texture2D(uTexture, vT).rgb);
        float densB = length(texture2D(uTexture, vB).rgb);

        // Sobel gradient for surface normal
        vec2 vTL = vUv + vec2(-texelSize.x, texelSize.y);
        vec2 vTR = vUv + vec2(texelSize.x, texelSize.y);
        vec2 vBL = vUv + vec2(-texelSize.x, -texelSize.y);
        vec2 vBR = vUv + vec2(texelSize.x, -texelSize.y);
        float densTL = length(texture2D(uTexture, vTL).rgb);
        float densTR = length(texture2D(uTexture, vTR).rgb);
        float densBL = length(texture2D(uTexture, vBL).rgb);
        float densBR = length(texture2D(uTexture, vBR).rgb);

        float dx = ((densR - densL) * 2.0 + (densTR - densTL) + (densBR - densBL)) * 0.25;
        float dy = ((densT - densB) * 2.0 + (densTR - densBR) + (densTL - densBL)) * 0.25;

        // 1-texel gradient for specular/fresnel/caustics (fine detail)
        float gradientMag = length(vec2(dx, dy));

        // ── Wide-distance gradient for refraction/CA ──
        // Smooth "head" edges change density over 30-50 pixels
        // 1-texel Sobel sees ~0.01 gradient (tiny!) → no CA
        // Wide sampling (gradAmp texels apart) sees the FULL transition → big gradient → CA visible
        float gs = uGradAmp2;
        float wDensL = length(texture2D(uTexture, vUv - vec2(texelSize.x * gs, 0.0)).rgb);
        float wDensR = length(texture2D(uTexture, vUv + vec2(texelSize.x * gs, 0.0)).rgb);
        float wDensT = length(texture2D(uTexture, vUv + vec2(0.0, texelSize.y * gs)).rgb);
        float wDensB = length(texture2D(uTexture, vUv - vec2(0.0, texelSize.y * gs)).rgb);
        float wdx = (wDensR - wDensL) * 0.5;
        float wdy = (wDensT - wDensB) * 0.5;
        float wGradMag = length(vec2(wdx, wdy));

        // Refraction normal from wide gradient (detects smooth edges)
        vec3 normal = normalize(vec3(wdx, wdy, 0.01));

        // ── IOR-based refraction (Snell's law) ──
        float refrFactor = (1.0 / uIor2 - 1.0);
        // Effective thickness uses wide gradient → strong at smooth edges too
        float effThickness = (density + wGradMag * gs) * uThickness2;
        vec2 refrOffset = normal.xy * refrFactor * effThickness;

        // ── True Chromatic Aberration — additive dispersion ──
        // Additive: R goes deeper INSIDE, B stays near/crosses OUTSIDE the edge
        // This ensures R and B sample different density regions → visible color at edges
        float caSpread = uCaSpread2;
        vec2 caOffset = normal.xy * caSpread * effThickness;
        vec2 rOffset = refrOffset - caOffset;  // Red: refraction + extra inward (deeper)
        vec2 gOffset = refrOffset;              // Green: base refraction (center)
        vec2 bOffset = refrOffset + caOffset;  // Blue: refraction - pushback (closer to edge/outside)

        // ── Sample density at each CA-offset position (pure, no bg mixing) ──
        vec3 refracted = vec3(0.0);
        float blur = uRoughness2 * 3.0;

        if (blur < 0.01) {
            // Sharp refraction
            vec2 rUV = clamp(vUv + rOffset, 0.0, 1.0);
            vec2 gUV = clamp(vUv + gOffset, 0.0, 1.0);
            vec2 bUV = clamp(vUv + bOffset, 0.0, 1.0);
            refracted.r = length(texture2D(uTexture, rUV).rgb);
            refracted.g = length(texture2D(uTexture, gUV).rgb);
            refracted.b = length(texture2D(uTexture, bUV).rgb);
        } else {
            // Blurred refraction (rough glass)
            for (float i = -1.0; i <= 1.0; i += 1.0) {
                for (float j = -1.0; j <= 1.0; j += 1.0) {
                    vec2 blurOff = vec2(i, j) * texelSize * blur;
                    vec2 rUV = clamp(vUv + rOffset + blurOff, 0.0, 1.0);
                    vec2 gUV = clamp(vUv + gOffset + blurOff, 0.0, 1.0);
                    vec2 bUV = clamp(vUv + bOffset + blurOff, 0.0, 1.0);
                    refracted.r += length(texture2D(uTexture, rUV).rgb);
                    refracted.g += length(texture2D(uTexture, gUV).rgb);
                    refracted.b += length(texture2D(uTexture, bUV).rgb);
                }
            }
            refracted /= 9.0;
        }

        // ── Normal-Based Prismatic Dispersion ──
        // IOR CA only shows at sharp transitions. This ensures color at ALL edges:
        // The surface normal ANGLE determines the color (like light through a prism)
        // Different edge directions → different prismatic colors
        float normalAngle = atan(wdy, wdx);
        float prismPhase = normalAngle + density * 3.0;
        vec3 prismColor = vec3(
            sin(prismPhase) * 0.5 + 0.5,
            sin(prismPhase + 2.094) * 0.5 + 0.5,
            sin(prismPhase + 4.189) * 0.5 + 0.5
        );

        // Apply prismatic tint where edges exist (wide gradient > 0)
        float edgePresence = smoothstep(0.0, 0.03, wGradMag);
        float prismStrength = edgePresence * caSpread * uCaIntensity2;
        refracted = mix(refracted, refracted * prismColor * 2.0, prismStrength);

        // ── Adaptive background blending ──
        // refracted = vec3(rDensity, gDensity, bDensity) — pure CA-separated density
        float bgLum = dot(uBackColor, vec3(0.299, 0.587, 0.114));
        float darkFactor = smoothstep(0.3, 0.7, 1.0 - bgLum);
        float presenceMask = smoothstep(0.0, uCaEdgeWidth2, density);

        // Dark bg: fluid density IS colored light → additive
        vec3 darkResult = uBackColor + refracted * uCaIntensity2;

        // Light bg: fluid creates colored ABSORPTION (glass tinting)
        // High density in R channel → R absorbed more → bg darkens in R → cyan tint on that side
        // High density in B channel → B absorbed more → bg darkens in B → yellow/red tint
        // This creates clear R/B fringing on white backgrounds
        vec3 lightResult = uBackColor * (vec3(1.0) - refracted * uCaIntensity2);

        c = mix(lightResult, darkResult, darkFactor);

        // ── Caustics — light focusing from curvature ──
        float laplacian = (densL + densR + densT + densB) - 4.0 * density;
        float caustic = clamp(-laplacian * 8.0, 0.0, 1.0) * uCausticInt2 * presenceMask;
        // Prismatic caustic — warm on dark bg, subtle on light bg
        c += vec3(caustic * 1.1, caustic * 0.9, caustic * 0.7) * 0.3 * mix(0.3, 1.0, darkFactor);

        // ── Fresnel — edges catch more light ──
        float edgeFactor = smoothstep(0.0, 0.06, gradientMag);
        float fresnel = pow(edgeFactor, uFresnelPower2) * uFresnelIntensity2 * presenceMask;
        c += vec3(0.85, 0.9, 1.0) * fresnel * mix(0.2, 1.0, darkFactor);

        // ── Specular highlights — glass reflections ──
        vec3 lightNormal = normalize(vec3(dx * 80.0, dy * 80.0, 1.0));
        vec3 keyLight = normalize(vec3(0.5, 0.7, 1.0));
        float keySpec = pow(max(dot(lightNormal, keyLight), 0.0), uSpecPower2) * uSpecIntensity2;
        vec3 fillLight = normalize(vec3(-0.6, 0.3, 1.0));
        float fillSpec = pow(max(dot(lightNormal, fillLight), 0.0), uSpecPower2 * 0.5) * uSpecIntensity2 * 0.4;
        vec3 rimLight = normalize(vec3(0.0, -0.5, 1.0));
        float rimSpec = pow(max(dot(lightNormal, rimLight), 0.0), uSpecPower2 * 0.3) * uSpecIntensity2 * 0.2;
        float totalSpec = (keySpec + fillSpec + rimSpec) * presenceMask;
        c += vec3(1.0, 0.98, 0.95) * totalSpec * mix(0.15, 1.0, darkFactor);

        // ── Shadow/AO from curvature ──
        if (uLighting > 0.5) {
          float shadow = clamp(laplacian * 3.0, -0.08, 0.0);
          c += shadow;
          float directional = dot(lightNormal.xy, vec2(0.4, 0.6)) * 0.04 * presenceMask;
          c += directional;
        }

        gl_FragColor = vec4(c, 1.0);
    #else
        // ── Default Mode ──
    #ifdef SHADING
        vec3 lc = texture2D(uTexture, vL).rgb;
        vec3 rc = texture2D(uTexture, vR).rgb;
        vec3 tc = texture2D(uTexture, vT).rgb;
        vec3 bc = texture2D(uTexture, vB).rgb;

        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);

        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);

        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
    #endif

    #ifdef BLOOM
        vec3 bloom = texture2D(uBloom, vUv).rgb;
    #endif

    #ifdef SUNRAYS
        float sunrays = texture2D(uSunrays, vUv).r;
        c *= sunrays;
    #ifdef BLOOM
        bloom *= sunrays;
    #endif
    #endif

    #ifdef BLOOM
        float noise = texture2D(uDithering, vUv * ditherScale).r;
        noise = noise * 2.0 - 1.0;
        bloom += noise / 255.0;
        bloom = linearToGamma(bloom);
        c += bloom;
    #endif

        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
    #endif
    }
`;

export const bloomPrefilterShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 0.0);
    }
`;

export const bloomBlurShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum;
    }
`;

export const bloomFinalShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform float intensity;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum * intensity;
    }
`;

export const sunraysMaskShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        vec4 c = texture2D(uTexture, vUv);
        float br = max(c.r, max(c.g, c.b));
        c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
        gl_FragColor = c;
    }
`;

export const sunraysShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float weight;

    #define ITERATIONS 16

    void main () {
        float Density = 0.3;
        float Decay = 0.95;
        float Exposure = 0.7;

        vec2 coord = vUv;
        vec2 dir = vUv - 0.5;

        dir *= 1.0 / float(ITERATIONS) * Density;
        float illuminationDecay = 1.0;

        float color = texture2D(uTexture, vUv).a;

        for (int i = 0; i < ITERATIONS; i++)
        {
            coord -= dir;
            float col = texture2D(uTexture, coord).a;
            color += col * illuminationDecay * weight;
            illuminationDecay *= Decay;
        }

        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
    }
`;

export const splatShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`;

export const advectionShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;

    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;

        vec2 iuv = floor(st);
        vec2 fuv = fract(st);

        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
    #ifdef MANUAL_FILTERING
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
        vec4 result = bilerp(uSource, coord, dyeTexelSize);
    #else
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = texture2D(uSource, coord);
    #endif
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
    }
`;

export const divergenceShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;

        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }

        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`;

export const curlShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`;

export const vorticityShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;

        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;

        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;

export const pressureShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`;

export const gradientSubtractShaderSource = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;
