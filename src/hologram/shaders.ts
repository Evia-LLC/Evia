/**
 * GLSL for the hologram's parts.
 *
 * Colours are written as sRGB values straight from the spec (specs/scan.md
 * 3.2) and output without conversion, so they composite over the page the way
 * the mockup's colours do. The canvas is premultiplied: a part that should
 * cover what is behind it (the face, the orb) writes coverage into alpha, and
 * a part that is pure light (dots, rim, rings, glow) adds its colour with an
 * alpha equal to its brightest channel. That keeps every pixel a valid
 * premultiplied value (browsers drop colour whose alpha is zero), and over the
 * dark window it composites like additive light.
 */

/** Uniforms every part can share (one object, so a change reaches them all). */
export const COMMON = /* glsl */ `
uniform float uTime;
uniform float uPxScale;   // device px per reference px
uniform float uPresence;  // 0..1 face build-in
uniform float uMotion;    // 0 under reduced motion
// Light as a valid premultiplied pixel: the browser drops colour on zero-alpha pixels,
// so light carries alpha equal to its brightest channel (added up by the blend state).
vec4 light(vec3 c) { return vec4(c, max(c.r, max(c.g, c.b))); }
`;

export const FACE_VERT = /* glsl */ `
${COMMON}
attribute float aEdge;
attribute float aEye;
attribute float aMouth;
attribute float aCavity;
varying vec3 vN;
varying vec3 vWorld;
varying vec2 vUv;
varying float vEdge;
varying float vEye;
varying float vMouth;
varying float vCavity;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  vEdge = aEdge;
  vEye = aEye;
  vMouth = aMouth;
  vCavity = aCavity;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FACE_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uZones;
uniform sampler2D uFeatures;
uniform float uZoneMix;
uniform float uActiveMix;
uniform float uBreath;
uniform float uScanY;
uniform float uScanOn;
uniform float uTopY;      // world y of the face's top edge
uniform float uFaceH;
uniform vec2 uFaceC;      // world x, y of the face's bounding-box centre
uniform float uFaceW;
varying vec3 vN;
varying vec3 vWorld;
varying vec2 vUv;
varying float vEdge;
varying float vEye;
varying float vMouth;
varying float vCavity;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec3 L = normalize(vec3(-0.35, 0.55, 0.78));
  vec4 feat = texture2D(uFeatures, vUv);

  // Skin: a warm mauve, softly lit (forehead about #a48792, nose about #907a87),
  // with a light wrap so surfaces facing down (under the nose, the jaw) stay mauve
  // instead of dropping to navy.
  float wrap = clamp((dot(N, L) + 0.45) / 1.45, 0.0, 1.0);
  vec3 shade = vec3(0.45, 0.35, 0.42);
  vec3 skin = vec3(0.86, 0.70, 0.74);
  vec3 col = mix(shade, skin, pow(wrap, 1.2));
  col *= 1.0 - 0.28 * vCavity;
  col = mix(col, vec3(0.66, 0.42, 0.52) * (0.6 + 0.5 * wrap), feat.r * 0.7);
  col = mix(col, vec3(0.26, 0.20, 0.27), feat.g * 0.6);
  col = mix(col, vec3(0.20, 0.16, 0.22), clamp(vEye * 1.6, 0.0, 1.0) * 0.85);
  col = mix(col, vec3(0.22, 0.13, 0.19), clamp(vMouth * 1.6, 0.0, 1.0));
  // Blue-violet overlay (multiply #8fa6e8, lightly) and a small screen lift.
  col = mix(col, col * vec3(0.56, 0.65, 0.91), 0.16);
  col = 1.0 - (1.0 - col) * (1.0 - 0.12 * vec3(0.62, 0.70, 0.95));
  vec3 H = normalize(L + V);
  col += pow(max(dot(N, H), 0.0), 36.0) * 0.18 * vec3(0.95, 0.9, 1.0);

  // Zones tint the skin toward their hue and add a little light of their own,
  // breathing; the active one is stronger. The texture holds hue x amount.
  vec3 zt = texture2D(uZones, vUv).rgb;
  float amt = max(zt.r, max(zt.g, zt.b));
  vec3 hue = zt / max(amt, 1e-3);
  float act = feat.b * uActiveMix;
  float k = amt * uZoneMix * (0.75 + 0.25 * uBreath) * (1.0 + 0.5 * act);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, hue * (0.22 + 0.95 * lum), clamp(k * 0.75, 0.0, 0.85));
  // Outlines are painted pale (all three channels high): light them as thin pale lines.
  float line = smoothstep(0.8, 0.95, min(hue.r, min(hue.g, hue.b))) * k;
  vec3 zoneLight = hue * k * 0.1 + vec3(0.9, 0.86, 1.0) * line * 0.45;

  // Fresnel rim: #8eb0f2 halo into a #dcffff core.
  float fr = pow(1.0 - ndv, 2.0);
  vec3 rim = mix(vec3(0.42, 0.58, 0.95), vec3(0.80, 0.95, 1.0), fr * fr);
  // Strongest on the silhouette; inner slopes (the nose) keep only a trace of it.
  vec3 emit = rim * fr * 0.9 * mix(1.0, 0.35, smoothstep(0.5, 1.0, vEdge));

  // Scan band: a soft band with a brighter (but not razor-thin) core, sweeping down.
  float dy = vWorld.y - uScanY;
  emit += uScanOn * (exp(-dy * dy / 90.0) * 0.07 + exp(-dy * dy / 5.0) * 0.12) * vec3(0.78, 0.92, 1.0);

  // Coverage: about 0.95 facing, 0.75 at grazing angles; fades out on the silhouette
  // and, over the upper face, along a dome that follows the outline: the forehead
  // dissolves into the lattice over its last tenth or so instead of stopping at a
  // flat hairline cut, so the face floats free rather than sitting in a hood.
  // Zone light is added on top (it is light, not skin) and survives more of the top fade.
  vec2 e = vec2((vWorld.x - uFaceC.x) / (uFaceW * 0.5), (vWorld.y - uFaceC.y) / (uFaceH * 0.5));
  float upper = smoothstep(0.2, 0.6, e.y);
  float top = (1.0 - upper * smoothstep(0.8, 1.02, length(e))) * (1.0 - smoothstep(uTopY - uFaceH * 0.03, uTopY, vWorld.y));
  float topNarrow = 1.0 - smoothstep(uTopY - uFaceH * 0.04, uTopY, vWorld.y);
  float edge = smoothstep(0.0, 0.3, vEdge);
  float alpha = mix(0.78, 0.95, ndv) * edge * top * uPresence;
  vec3 glow = emit * top * top + zoneLight * topNarrow;
  vec3 rgb = col * alpha + glow * edge * uPresence;
  gl_FragColor = vec4(rgb, max(alpha, max(rgb.r, max(rgb.g, rgb.b))));
}
`;

export const DOTS_VERT = /* glsl */ `
${COMMON}
uniform sampler2D uZones;
uniform sampler2D uFeatures;
uniform float uZoneMix;
uniform float uActiveMix;
uniform float uBreath;
uniform float uScanY;
uniform float uScanOn;
uniform float uTopY;
uniform float uFaceH;
attribute vec3 aNormal;
attribute vec2 aUv;
attribute float aEdge;
attribute float aSeed;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec4 wp = modelMatrix * vec4(position + aNormal * 0.8, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * aNormal);
  float ndv = clamp(dot(n, normalize(cameraPosition - wp.xyz)), 0.0, 1.0);
  vec3 z = texture2D(uZones, aUv).rgb;
  float zmax = max(z.r, max(z.g, z.b));
  float zone = clamp(zmax * 1.6, 0.0, 1.0) * uZoneMix;
  float act = texture2D(uFeatures, aUv).b * uActiveMix;
  float tw = step(aSeed, 0.1) * uMotion;
  float twinkle = 1.0 - tw * (0.55 + 0.45 * sin(uTime * (3.9 + aSeed * 38.0) + aSeed * 60.0));
  float dy = wp.y - uScanY;
  float band = uScanOn * exp(-dy * dy / 100.0);
  float top = mix(1.0 - smoothstep(uTopY - uFaceH * 0.12, uTopY, wp.y), 1.0 - smoothstep(uTopY - uFaceH * 0.04, uTopY, wp.y), zone);
  float lit = clamp(dot(n, normalize(vec3(-0.35, 0.55, 0.78))) * 0.9 + 0.2, 0.0, 1.0);
  // 30-45% outside zones, about 80% inside them.
  float a = mix(0.3 + 0.15 * lit, 0.8, zone) * mix(1.0, 0.8 + 0.2 * uBreath, zone);
  a = (a + act * 0.15) * twinkle + band * 0.45;
  a *= smoothstep(0.02, 0.4, aEdge) * smoothstep(0.02, 0.3, ndv) * mix(0.15, 1.0, top) * uPresence;
  vAlpha = a;
  // Inside a zone the dots take a pale version of its hue.
  vec3 dotCol = vec3(0.965, 0.910, 0.988);
  vec3 hue = z / max(zmax, 1e-3);
  vTint = mix(dotCol, mix(hue, vec3(1.0), 0.4), zone * 0.8);
  float size = (mix(1.15, 1.6, zone) + band * 0.5 + act * 0.25) * (0.8 + 0.45 * fract(aSeed * 17.31));
  gl_PointSize = max(1.0, size * uPxScale * 2.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** A soft round sprite, shared by every point-based part. */
export const POINT_FRAG = /* glsl */ `
${COMMON}
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(p, p) * 4.5);
  if (a * vAlpha < 0.004) discard;
  gl_FragColor = light(vTint * vAlpha * a);
}
`;

/** The silhouette rim: a ribbon along the face outline, hot core and outer halo. */
export const RIM_VERT = /* glsl */ `
${COMMON}
attribute float aSide;
attribute float aWeight;
varying float vSide;
varying float vWeight;
void main() {
  vSide = aSide;
  vWeight = aWeight;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RIM_FRAG = /* glsl */ `
${COMMON}
uniform float uGlow;
varying float vSide;
varying float vWeight;
void main() {
  float s = vSide;
  float core = exp(-s * s / 1.6);
  float halo = s > 0.0 ? exp(-s / 7.0) : exp(s / 3.0);
  vec3 col = vec3(0.45, 0.62, 0.97) * halo * 0.6 + vec3(0.80, 0.96, 1.0) * core * 0.34;
  gl_FragColor = light(col * vWeight * uGlow * uPresence);
}
`;

/** Generic points (envelope particles, zone nodes, ring specks) with per-point size and alpha. */
export const SPARK_VERT = /* glsl */ `
${COMMON}
uniform float uFade;
uniform float uDrift;     // reference px a particle rises before it wraps
attribute float aSize;
attribute float aAlpha;
attribute float aSeed;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vTint;
void main() {
  float cyc = fract(aSeed * 7.13 + uTime * 0.018 * uMotion);
  vec3 p = position + vec3(0.0, (cyc - 0.5) * uDrift, 0.0);
  float wrap = uDrift > 0.0 ? sin(3.14159 * cyc) : 1.0;
  float shimmer = 1.0 - uMotion * 0.4 * (0.5 + 0.5 * sin(uTime * (1.1 + aSeed * 2.3) + aSeed * 40.0));
  vAlpha = aAlpha * wrap * shimmer * uFade;
  vTint = aColor;
  gl_PointSize = max(1.0, aSize * uPxScale * 2.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

/** Thin additive lines with per-vertex alpha (the constellation wires). */
export const LINE_VERT = /* glsl */ `
${COMMON}
attribute float aAlpha;
attribute float aSeed;
varying float vAlpha;
void main() {
  float shimmer = 0.6 + 0.4 * (1.0 - uMotion) + uMotion * 0.4 * sin(uTime * (0.7 + aSeed) + aSeed * 30.0);
  vAlpha = aAlpha * shimmer;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const LINE_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uColor;
uniform float uFade;
varying float vAlpha;
void main() {
  gl_FragColor = light(uColor * vAlpha * uFade);
}
`;

/** A quad in the reference plane; frag shaders get reference-px coordinates relative to its centre. */
export const QUAD_VERT = /* glsl */ `
${COMMON}
uniform vec2 uHalf;       // half size of the quad in reference px
varying vec2 vP;
void main() {
  vP = (uv * 2.0 - 1.0) * uHalf;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** An emitter ring: an ellipse with a hot core, a glow, rotating dashes and radial ticks. */
export const RING_FRAG = /* glsl */ `
${COMMON}
uniform vec2 uR;          // radii (reference px)
uniform float uCore;      // core width
uniform float uGlowW;     // glow width
uniform float uGain;
uniform float uTicks;     // 0 or 1
uniform float uSpin;      // turns per second (signed)
varying vec2 vP;
void main() {
  vec2 q = vP / uR;
  float lq = length(q);
  vec2 g = q / (uR * max(lq, 1e-4));
  float d = (lq - 1.0) / max(length(g), 1e-4);   // signed distance, reference px
  float ang = atan(q.y, q.x) / 6.28318 + uTime * uSpin * uMotion;
  float dash = 0.75 + 0.25 * step(0.5, fract(ang * 36.0));
  float core = exp(-d * d / (uCore * uCore)) * dash * 0.8;
  float glow = exp(-abs(d) / uGlowW) * 0.5;
  float tick = uTicks * step(0.93, fract(ang * 60.0)) * smoothstep(3.0, 4.0, d) * (1.0 - smoothstep(8.0, 9.0, d)) * 0.6;
  float pulse = 0.85 + 0.15 * uMotion * sin(uTime * 2.094);
  vec3 col = vec3(0.506, 0.663, 0.918) * glow + vec3(0.776, 0.925, 1.0) * (core + tick);
  gl_FragColor = light(col * uGain * pulse);
}
`;

/** Soft elliptical glow (halo behind the head, light pooled on the base). */
export const GLOW_FRAG = /* glsl */ `
${COMMON}
uniform vec2 uHalf;
uniform vec3 uColor;
uniform float uGain;
uniform float uFade;
varying vec2 vP;
void main() {
  vec2 q = vP / uHalf;
  float d = dot(q, q);
  float a = exp(-d * 3.2) * (1.0 - smoothstep(0.7, 1.0, d));
  gl_FragColor = light(uColor * a * uGain * uFade);
}
`;

/** The small glass orb: translucent sphere, rim light, meridians, highlight and warm glints. */
export const ORB_FRAG = /* glsl */ `
${COMMON}
uniform float uR;
varying vec2 vP;
void main() {
  vec2 p = vP / uR;
  float r2 = dot(p, p);
  float outer = exp(-max(sqrt(r2) - 1.0, 0.0) * 9.0) * 0.35;
  if (r2 > 1.0) {
    gl_FragColor = light(vec3(0.51, 0.66, 0.92) * outer * (1.0 - smoothstep(1.0, 1.5, r2)));
    return;
  }
  vec3 n = vec3(p.x, p.y, sqrt(1.0 - r2));
  float fres = pow(1.0 - n.z, 2.0);
  float lon = atan(n.x, n.z) + uTime * 0.785 * uMotion;
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float mer = smoothstep(0.08, 0.0, abs(sin(lon * 3.0))) * 0.28;
  float par = (smoothstep(0.05, 0.0, abs(lat - 0.4)) + smoothstep(0.05, 0.0, abs(lat + 0.4))) * 0.4;
  float hi = exp(-dot(p - vec2(-0.3, 0.45), p - vec2(-0.3, 0.45)) * 18.0);
  float glint = exp(-dot(p - vec2(0.2, -0.3), p - vec2(0.2, -0.3)) * 9.0);
  float poles = exp(-dot(p - vec2(0.0, 0.93), p - vec2(0.0, 0.93)) * 300.0) + exp(-dot(p - vec2(0.0, -0.93), p - vec2(0.0, -0.93)) * 300.0);
  vec3 base = vec3(0.518, 0.557, 0.694);
  float alpha = 0.32 + 0.3 * fres;
  vec3 emit = vec3(0.71, 0.78, 0.92) * (fres * 0.9 + mer + par) + vec3(0.95, 0.97, 1.0) * (hi * 0.8 + poles)
    + vec3(0.88, 0.63, 0.48) * glint * 0.75;
  vec3 rgb = base * alpha * 0.6 + emit * 0.8;
  gl_FragColor = vec4(rgb, max(alpha, max(rgb.r, max(rgb.g, rgb.b))));
}
`;

/**
 * The neck volume: a translucent blue column under the jaw that flares into a
 * skirt at the base ring. Shaded like a see-through cylinder (thin in the
 * middle, denser toward its edges, with a light line on each edge), with a
 * faint dot grid that closes up toward the edges, fine threads in the skirt
 * and two scan columns.
 */
export const NECK_FRAG = /* glsl */ `
${COMMON}
uniform vec2 uHalf;       // half width at the base, half height
uniform float uTopHalfW;  // half width under the jaw
uniform vec2 uColumns;    // x of the two scan columns (reference px from centre)
varying vec2 vP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float t = (vP.y + uHalf.y) / (2.0 * uHalf.y);          // 0 at the base, 1 under the jaw
  float flare = pow(clamp(1.0 - t / 0.5, 0.0, 1.0), 2.2);
  float hw = mix(uTopHalfW, uHalf.x, flare);
  float u = abs(vP.x) / hw;                                // 0 on the axis, 1 on the edge
  if (u > 1.1) discard;
  float body = 1.0 - smoothstep(0.97, 1.03, u);
  float vert = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.84, 1.0, t));

  vec3 fill = vec3(0.282, 0.404, 0.635) * (0.38 + 0.42 * pow(min(u, 1.0), 3.0)) * body;
  float edgeLine = exp(-pow((u - 0.985) * hw / 1.3, 2.0)) * (0.5 - 0.3 * flare);
  // Dot grid on the cylinder: columns by arc length, so they close up toward the edges.
  vec2 g = vec2(asin(min(u, 0.999)) * hw * sign(vP.x), vP.y) / 6.0;
  vec2 f = fract(g) - 0.5;
  float dotA = exp(-dot(f, f) * 60.0) * (0.25 + 0.5 * hash(floor(g))) * body * (1.0 - flare * 0.6);
  // Threads in the skirt.
  float cx = floor(vP.x / 4.0);
  float thread = smoothstep(0.22, 0.0, abs(fract(vP.x / 4.0) - 0.5)) * hash(vec2(cx, 3.1)) * flare * 0.5 * body;
  vec3 col = fill + vec3(0.655, 0.796, 0.976) * (edgeLine + dotA * 0.55 + thread * 0.35);
  float pulse = 0.85 + 0.15 * uMotion * sin(uTime * 1.7);
  for (int i = 0; i < 2; i++) {
    float sx = i == 0 ? uColumns.x : uColumns.y;
    float dx = vP.x - sx;
    float line = exp(-dx * dx / 0.35);
    float node = step(fract(vP.y / 9.0), 0.16) * exp(-dx * dx / 2.0);
    col += vec3(0.776, 0.925, 1.0) * (line * 0.4 + node * 0.45) * pulse * smoothstep(0.05, 0.3, t);
  }
  gl_FragColor = light(col * vert * uPresence);
}
`;

/** The head shell: a faint blue volume with a light rim, rising out of the face's upper edge. */
export const SHELL_VERT = /* glsl */ `
${COMMON}
attribute float aS;
attribute float aSide;
varying vec3 vN;
varying vec3 vWorld;
varying float vS;
varying float vSide;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vS = aS;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SHELL_FRAG = /* glsl */ `
${COMMON}
varying vec3 vN;
varying vec3 vWorld;
varying float vS;
varying float vSide;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(N, V));
  float body = smoothstep(0.0, 0.05, vS) * vSide;
  // Pure light, and hardly any: no fill at all, only a hairline on the outline
  // that fades out toward the crown and is broken into soft lengths, so it reads
  // as the edge of a hologram (with the particles and arcs) rather than a cap
  // over the head. A short breath of the skin's light rises off the forehead.
  float g = 1.0 - ndv;
  float edge = pow(g, 12.0);
  float fade = 1.0 - 0.75 * smoothstep(0.2, 0.95, vS);
  float breaks = 0.35 + 0.65 * smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(vWorld.x * 0.09 + vWorld.y * 0.05 + 1.3 * sin(vWorld.y * 0.03)));
  vec3 fill = vec3(0.0);
  vec3 rim = mix(vec3(0.42, 0.58, 0.95), vec3(0.80, 0.95, 1.0), edge) * edge * 0.3 * fade * breaks;
  vec3 scatter = vec3(0.52, 0.44, 0.58) * exp(-vS * 18.0) * 0.08;
  gl_FragColor = light((fill + rim + scatter) * body * uPresence);
}
`;
