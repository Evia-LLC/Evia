/**
 * The living plate's shaders (WebGL2, GLSL ES 3.00): one full-screen triangle
 * that redraws the plate with its small motions, all in display space (the
 * glow and boost layers are display-space deltas, as the room READMEs say).
 *
 * Per pixel, in order:
 *   1. parallax   depth: shift by the depth map; glass: shift the view outside only
 *   2. plants     the sampling point moves with a smooth wind field weighted by
 *                 the sway mask (0 at the pot .. 1 at the tips, feathered past
 *                 the silhouette), so leaves sway and their edges never tear
 *   3. plate      sampled there (mipmapped, so a small drawing stays smooth)
 *   4. LEDs       plate + k * glow (breathing), plus a bead travelling along
 *                 each strip (coves mask: distance along, strip id), faded out
 *                 by the strip's blurred coverage so it never shows a seam
 *   5. boosts     consult: neon/under-glow/emitter layers breathe (+-5 %); soft
 *                 glints turn slowly round the pedestal's glass rings
 *   6. windows    lit windows sharing an id go dark now and then (twinkleOff,
 *                 mirrored in envelope.ts), distant lights shimmer
 *   7. lamps      gain per lamp id (candle flicker, globe breathing) and a warm halo
 *   8. sky        clouds (dusk), haze (night) or light (day) drifting under the
 *                 sky mask; an aircraft's beacon crossing it, hidden by anything
 *                 that is not sky
 *   9. dither     half a code value of fixed noise, so slow gradients never band
 *
 * Features are compiled in with #defines, so a room pays only for what it has.
 *
 * Wraps: the GPU gets small floats, so every drift is wrapped on the CPU. The
 * noise lattices repeat every NOISE_PERIOD cells (fbm's octaves scale by
 * exactly 2, so they repeat together) and the drifts wrap at NOISE_PERIOD; the
 * twinkle's slots and the shimmer's cycles repeat on the clock's wrap. So no
 * wrap shows (test/living-envelope.test.ts checks the JavaScript mirrors).
 */
import { NOISE_PERIOD, TWINKLE_PERIOD, TWINKLE_SLOTS } from './envelope.ts';
import { PARALLAX_MAX, PARALLAX_MIN } from './scene.ts';
import type { LivingFeatures } from './scene.ts';

const f1 = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

export const VERTEX = `#version 300 es
void main() {
  // One triangle covering the viewport: (-1,-1), (3,-1), (-1,3).
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function fragmentSource(f: LivingFeatures): string {
  const defines = [
    f.plants && 'PLANTS',
    f.lamps && 'LAMPS',
    f.glow && 'GLOW',
    f.travel && 'TRAVEL',
    f.windows && 'WINDOWS',
    f.sky && 'SKY',
    f.haze && 'HAZE',
    f.boosts && 'BOOSTS',
    f.emitter && 'EMITTER',
    f.aircraft && 'AIRCRAFT',
    f.parallax === 'depth' && 'PARALLAX_DEPTH',
    f.parallax === 'glass' && 'PARALLAX_GLASS',
  ]
    .filter(Boolean)
    .map((d) => `#define ${d} 1`)
    .join('\n');
  return `#version 300 es
precision highp float;
precision highp int;
${defines}

out vec4 outColor;

uniform vec4 uMap;        // uv = (ax + fx * bx, ay - fy * by)
uniform float uT;         // live seconds (wrapped)
uniform float uRamp;      // 0 -> 1 as the room comes alive
uniform vec2 uMaskSize;   // the data masks' size, px
uniform float uAspect;    // plate width / height

uniform sampler2D uPlate;

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float hash01(uint v) { return float(pcg(v)) / 4294967296.0; }
const float NP = ${f1(NOISE_PERIOD)};  // the noise lattices repeat every NP cells
float h2(vec2 i) {
  uvec2 q = uvec2(ivec2(mod(i, NP)));
  return hash01(q.x + pcg(q.y));
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * vnoise(p);
    p = p * 2.0 + vec2(17.1, 9.3);   // exactly 2: every octave repeats with the first
    a *= 0.5;
  }
  return s / 0.9375;
}
float noise1(float x, uint seed) {
  float i = floor(x);
  float f = x - i;
  uint s = pcg(seed * 7919u + 13u);
  float a = hash01(uint(mod(i, NP)) + s);
  float b = hash01(uint(mod(i + 1.0, NP)) + s);
  float w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return (a + (b - a) * w) * 2.0 - 1.0;
}
ivec2 texel(sampler2D s, vec2 uv) {
  ivec2 size = textureSize(s, 0);
  return clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
}

#ifdef PARALLAX_DEPTH
uniform sampler2D uDepth;
uniform vec2 uDepthRange;   // metres at 0 and 1
uniform vec2 uFocusNear;    // focus depth, near depth (m)
#endif
#if defined(PARALLAX_DEPTH) || defined(PARALLAX_GLASS)
uniform vec2 uParallax;     // sampling offset (uv) for a factor of 1
#endif
#if defined(PARALLAX_GLASS) || defined(HAZE)
uniform sampler2D uGlass;
#endif

#ifdef PLANTS
uniform sampler2D uPlants;
uniform vec4 uBreeze;       // phases: slow wave, quick wave, noise position (wrapped at NP), (unused)
uniform vec2 uFlutter;      // the leaf flutter's drift (wrapped at NP)
uniform vec2 uGust;         // front (plate widths), strength
uniform vec2 uSway;         // amplitude, flutter (mask px)
#endif

#ifdef GLOW
uniform sampler2D uGlow;
uniform float uGlowLod;
#endif
uniform float uBreath;
#ifdef TRAVEL
uniform sampler2D uCoves;
uniform sampler2D uStrips;  // 256 x 1: waves, phase, amount, (unused)
#endif
#ifdef BOOSTS
uniform sampler2D uNeon;
uniform sampler2D uUnder;
uniform sampler2D uEmitBoost;
uniform vec3 uBoost;        // neon, under, emitter: multiples of each boost layer to add
#endif
#ifdef EMITTER
uniform sampler2D uEmitter;
uniform vec2 uEmit;         // the glints' turn (0..1), strength
#endif

#ifdef WINDOWS
uniform sampler2D uWindows;
uniform vec3 uTwinkle;      // chance per slot, gain, shimmer
float twinkleOff(uint id, float t, float chance) {
  const float P = ${f1(TWINKLE_PERIOD)};
  const float F = 0.45;
  float shifted = t + hash01(id * 3u + 1u) * P;
  float slot = floor(shifted / P);
  float u = shifted - slot * P;
  uint key = id * 7919u + uint(mod(slot, ${f1(TWINKLE_SLOTS)})) * 104729u;
  if (hash01(key) >= chance) return 0.0;
  float dur = 3.0 + 12.0 * hash01(key ^ 0x9e3779b9u);
  float start = F + hash01(key + 1u) * (P - dur - 3.0 * F);
  return smoothstep(start - F, start, u) * (1.0 - smoothstep(start + dur, start + dur + F, u));
}
#endif

#ifdef LAMPS
uniform sampler2D uLamps;
uniform sampler2D uLampData; // 256 x 1: gain - 1, halo rgb
#endif

#ifdef SKY
uniform sampler2D uSky;
uniform vec4 uSkyDrift;     // cloud offset xy, amount, kind (1 dusk, 2 night, 3 day)
#endif
#ifdef HAZE
uniform vec3 uHaze;         // offset xy, amount
#endif
#ifdef AIRCRAFT
uniform vec4 uPlane;        // position (uv), intensity, beacon 0..1
#endif

void main() {
  vec2 uv = vec2(uMap.x + gl_FragCoord.x * uMap.z, uMap.y - gl_FragCoord.y * uMap.w);

  // 1. parallax
#ifdef PARALLAX_DEPTH
  float z = mix(uDepthRange.x, uDepthRange.y, texture(uDepth, uv).r);
  float pf = clamp((1.0 / max(z, 0.3) - 1.0 / uFocusNear.x) / (1.0 / uFocusNear.y - 1.0 / uFocusNear.x), ${f1(PARALLAX_MIN)}, ${f1(PARALLAX_MAX)});
  uv += uParallax * pf;
#endif
#ifdef PARALLAX_GLASS
  float gw = min(texture(uGlass, uv).r, texture(uGlass, uv + uParallax).r);
  uv += uParallax * gw;
#endif

  // 2. plants
  vec2 st = uv;
#ifdef PLANTS
  float sway = texture(uPlants, uv).g;
  if (sway > 0.002) {
    float x = uv.x;
    float breeze = 0.5 * sin(6.2831853 * (uBreeze.x - x * 0.9))
                 + 0.3 * sin(6.2831853 * (uBreeze.y - x * 1.7) + 1.3)
                 + 0.2 * noise1(uBreeze.z + x * 2.0, 1u);
    float q = (uGust.x - x) / 0.3;
    float push = uGust.y * (q < 0.0 ? exp(-q * q * 4.0) : exp(-q * 1.2));
    float lean = 0.55 * breeze + 0.45 * push;
    vec2 d = vec2(lean, 0.22 * abs(lean)) * uSway.x;
    vec2 fl = vec2(vnoise(uv * vec2(38.0 * uAspect, 38.0) + vec2(uFlutter.x, 0.0)),
                   vnoise(uv * vec2(38.0 * uAspect, 38.0) + vec2(0.0, uFlutter.y) + 7.7)) - 0.5;
    d += fl * 2.0 * uSway.y * sway;
    st = uv - d * sway / uMaskSize;
  }
#endif

  // 3. the plate (a slight negative bias: trilinear filtering at barely-minified sizes would soften it
  //    next to the browser's own drawing of the same picture)
  vec3 rgb = texture(uPlate, st, -0.6).rgb;

  // 4. LEDs
#ifdef GLOW
  vec3 glow = textureLod(uGlow, st, uGlowLod).rgb;
  float k = uBreath;
#ifdef TRAVEL
  float near = clamp(textureLod(uCoves, st, 2.0).r * 3.0, 0.0, 1.0);
  if (near > 0.001) {
    vec4 c = texelFetch(uCoves, texel(uCoves, st), 0);
    int sid = int(c.b * 255.0 + 0.5);
    if (sid > 0) {
      vec4 sd = texelFetch(uStrips, ivec2(sid, 0), 0);
      float x = c.g * sd.x - sd.y;
      k += near * sd.z * pow(0.5 + 0.5 * cos(6.2831853 * x), 8.0);
    }
  }
#endif
  rgb += glow * k;
#endif

  // 5. the consult room's boosts
#ifdef BOOSTS
  float kn = uBoost.x;
#ifdef TRAVEL
  float nearB = clamp(textureLod(uCoves, st, 2.0).r * 3.0, 0.0, 1.0);
  if (nearB > 0.001) {
    vec4 cb = texelFetch(uCoves, texel(uCoves, st), 0);
    int sidB = int(cb.b * 255.0 + 0.5);
    if (sidB > 0) {
      vec4 sdB = texelFetch(uStrips, ivec2(sidB, 0), 0);
      kn += nearB * sdB.z * pow(0.5 + 0.5 * cos(6.2831853 * (cb.g * sdB.x - sdB.y)), 8.0);
    }
  }
#endif
  rgb += texture(uNeon, st).rgb * kn;
  rgb += texture(uUnder, st).rgb * uBoost.y;
  vec3 eb = texture(uEmitBoost, st).rgb;
  float ke = uBoost.z;
#ifdef EMITTER
  // The glass rings turn: three soft glints (evenly spaced, so the pedestal's light stays even) move round
  // the rim and the inlaid rings, one turn in tuning.emitterTurnS seconds. Nothing pulses here: the
  // hologram above has its own 3 s pulse.
  float emr = texture(uEmitter, st).r;
  if (emr > 0.002) {
    // The angle read exactly (no filtering across the 1 -> 0 seam of the angle channel).
    float ang = texelFetch(uEmitter, texel(uEmitter, st), 0).g;
    float glint = pow(0.5 + 0.5 * cos(6.2831853 * (ang * 3.0 - uEmit.x)), 6.0);
    ke += uEmit.y * glint * emr;
  }
#endif
  rgb += eb * ke;
#endif

  // 6. windows
#ifdef WINDOWS
  vec4 wm = texture(uWindows, st);
  if (wm.r > 0.003) {
    uint wid = uint(texelFetch(uWindows, texel(uWindows, st), 0).g * 255.0 + 0.5);
    float w = clamp(wm.r * uTwinkle.y, 0.0, 1.0);
    float off = twinkleOff(wid, uT, uTwinkle.x) * uRamp;
    vec3 facade = textureLod(uPlate, st, 3.5).rgb;
    rgb = mix(rgb, min(rgb, facade * 0.8), off * w);
    float hw = hash01(wid * 13u + 5u);
    // A whole number of cycles per clock wrap (envelope.ts shimmerCycles), so the wrap keeps its phase.
    float cyc = floor((0.7 + 1.1 * hw) * ${f1(TWINKLE_PERIOD * TWINKLE_SLOTS)} / 6.2831853 + 0.5);
    rgb *= 1.0 + uTwinkle.z * w * sin(6.2831853 * (fract(uT * (cyc / ${f1(TWINKLE_PERIOD * TWINKLE_SLOTS)})) + hw));
  }
#endif

  // 7. lamps
#ifdef LAMPS
  vec3 lm = texture(uLamps, st).rgb;
  float lw = max(lm.r, lm.b);
  if (lw > 0.002) {
    int lid = int(texelFetch(uLamps, texel(uLamps, st), 0).g * 255.0 + 0.5);
    if (lid > 0) {
      vec4 ld = texelFetch(uLampData, ivec2(lid, 0), 0);
      rgb *= 1.0 + ld.x * lw;
      rgb += ld.yzw * lm.b * lm.b;
    }
  }
#endif

  // 8. sky
#ifdef SKY
  float sky = texture(uSky, st).r;
  if (sky > 0.002) {
    if (uSkyDrift.w < 1.5) {
      // Dusk: long thin cloud bands drifting sideways, a touch darker and rosier.
      float c = fbm(vec2(st.x * 2.4 * uAspect, st.y * 11.0) + uSkyDrift.xy);
      float band = smoothstep(0.42, 0.78, c);
      rgb = mix(rgb, rgb * vec3(0.9, 0.86, 0.95) + vec3(0.018, 0.004, 0.012), band * sky * uSkyDrift.z * 10.0);
      rgb *= 1.0 + (c - 0.5) * sky * uSkyDrift.z;
    } else if (uSkyDrift.w < 2.5) {
      // Night: a faint glow of haze moving across the dark.
      float c = fbm(vec2(st.x * 3.0 * uAspect, st.y * 7.0) + uSkyDrift.xy);
      rgb += vec3(0.06, 0.05, 0.1) * smoothstep(0.35, 0.9, c) * sky * uSkyDrift.z * 6.0;
    } else {
      // Day: light through the window swells and eases as high cloud passes the sun.
      float c = fbm(vec2(st.x * 1.2 * uAspect, st.y * 1.6) + uSkyDrift.xy);
      rgb *= 1.0 + (c - 0.5) * 2.0 * sky * uSkyDrift.z;
    }
#ifdef AIRCRAFT
    if (uPlane.z > 0.0) {
      vec2 dp = (st - uPlane.xy) * uMaskSize;
      float r2 = dot(dp, dp);
      float core = exp(-r2 / 0.9);
      vec3 beacon = vec3(1.0, 0.28, 0.22) * core * uPlane.w * 0.85;
      vec3 nav = vec3(0.95, 0.93, 1.0) * exp(-r2 / 0.5) * 0.3;
      rgb += (beacon + nav) * uPlane.z * sky;
    }
#endif
  }
#endif
#ifdef HAZE
  float gl = texture(uGlass, st).r;
  if (gl > 0.002) {
    float hz = fbm(vec2(st.x * 2.2 * uAspect, st.y * 5.0) + uHaze.xy);
    rgb += vec3(0.05, 0.045, 0.085) * smoothstep(0.5, 0.95, hz) * gl * uHaze.z;
  }
#endif

  // 9. dither (fixed: a pattern that changed every frame would itself be motion)
  rgb += (hash01(uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u) - 0.5) / 255.0;
  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;
}
