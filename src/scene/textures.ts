/**
 * Procedurally generated textures.
 *
 * The room needs real surfaces — panel joints, brushed metal, a floor with a
 * sheen — and there are three ways to get them: ship image files, model and
 * bake in Blender, or draw them at runtime. This is the third.
 *
 * It is not a compromise. A 512² canvas costs a few milliseconds to draw once,
 * adds nothing to the download, has no asset pipeline to keep in sync, and can
 * be retuned by changing a number rather than by re-exporting. The whole point
 * of the brief's "procedural art for the MVP" is that the *look* can improve
 * without an art pipeline existing yet, and a texture is art.
 *
 * Everything here is cached by its options, because the same wall texture is
 * asked for by several surfaces and a canvas draw per surface is waste.
 */
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  return [el, ctx];
}

function finish(
  el: HTMLCanvasElement,
  opts: { repeat?: [number, number]; srgb?: boolean } = {},
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(el);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) texture.repeat.set(opts.repeat[0], opts.repeat[1]);
  // Colour maps are authored in sRGB; data maps (roughness, masks) are not, and
  // tagging those as colour would gamma-shift the values.
  texture.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  // The floor is seen at a very shallow angle, which is exactly the case
  // trilinear filtering handles worst.
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Deterministic value noise, so a reload gives the same room. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface PanelOptions {
  size?: number;
  /** Base surface colour. */
  base: string;
  /** The recessed line between panels. */
  seam: string;
  /** A lighter line along the top/left of each panel — the bevel catch. */
  bevel?: string;
  /** Panels across and down within one tile. */
  cells?: [number, number];
  /** 0..1. Fine surface grain. */
  grain?: number;
  /** 0..1. Horizontal brushed streaks. */
  brushed?: number;
  /** Per-panel brightness variation, 0..1. */
  variance?: number;
  seed?: number;
}

/**
 * A panelled architectural surface.
 *
 * The seam is what does the work. A flat colour reads as a backdrop at any
 * resolution; a surface divided into panels reads as *built*, because it tells
 * the eye how big it is.
 */
export function panelTexture(opts: PanelOptions): THREE.CanvasTexture {
  const key = 'panel:' + JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit) return hit;

  const size = opts.size ?? 512;
  const [cols, rows] = opts.cells ?? [4, 4];
  const grain = opts.grain ?? 0.05;
  const brushed = opts.brushed ?? 0;
  const variance = opts.variance ?? 0.05;
  const random = rng(opts.seed ?? 1337);

  const [el, ctx] = canvas(size);
  ctx.fillStyle = opts.base;
  ctx.fillRect(0, 0, size, size);

  const cw = size / cols;
  const ch = size / rows;

  // Panel-to-panel variation. Real cladding is never one colour.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const shift = (random() - 0.5) * 2 * variance;
      ctx.fillStyle = shift >= 0 ? `rgba(255,255,255,${shift})` : `rgba(0,0,0,${-shift})`;
      ctx.fillRect(x * cw, y * ch, cw, ch);
    }
  }

  if (brushed > 0) {
    // Horizontal streaks: the anisotropic scatter of a brushed finish.
    for (let i = 0; i < size * 1.5; i++) {
      const y = random() * size;
      const w = size * (0.1 + random() * 0.9);
      const a = random() * brushed * 0.12;
      ctx.fillStyle = random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      ctx.fillRect(random() * size - w * 0.5, y, w, 1);
    }
  }

  // Seams, with a bevel catch on the upper edge so panels read as recessed
  // rather than as drawn-on lines.
  ctx.lineWidth = Math.max(1, size / 340);
  for (let x = 0; x <= cols; x++) {
    const px = Math.round(x * cw) + 0.5;
    if (opts.bevel) {
      ctx.strokeStyle = opts.bevel;
      ctx.beginPath();
      ctx.moveTo(px + ctx.lineWidth, 0);
      ctx.lineTo(px + ctx.lineWidth, size);
      ctx.stroke();
    }
    ctx.strokeStyle = opts.seam;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, size);
    ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    const py = Math.round(y * ch) + 0.5;
    if (opts.bevel) {
      ctx.strokeStyle = opts.bevel;
      ctx.beginPath();
      ctx.moveTo(0, py + ctx.lineWidth);
      ctx.lineTo(size, py + ctx.lineWidth);
      ctx.stroke();
    }
    ctx.strokeStyle = opts.seam;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(size, py);
    ctx.stroke();
  }

  if (grain > 0) {
    const image = ctx.getImageData(0, 0, size, size);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (random() - 0.5) * 255 * grain;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
    ctx.putImageData(image, 0, 0);
  }

  const texture = finish(el, { repeat: [1, 1] });
  cache.set(key, texture);
  return texture;
}

/**
 * A soft-edged luminous band, for light coves and strips.
 *
 * Drawn as a gradient rather than as a hard quad because the give-away of a
 * fake light is a hard edge: real light has no boundary, it just runs out.
 */
export function glowTexture(
  axis: 'x' | 'y' = 'y',
  core = 0.5,
  seed = 7,
): THREE.CanvasTexture {
  const key = `glow:${axis}:${core}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 128;
  const [el, ctx] = canvas(size);
  const gradient =
    axis === 'y'
      ? ctx.createLinearGradient(0, 0, 0, size)
      : ctx.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(Math.max(0.01, 0.5 - core * 0.5), 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,1)');
  gradient.addColorStop(Math.min(0.99, 0.5 + core * 0.5), 'rgba(255,255,255,0.85)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = finish(el, { srgb: false });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, texture);
  return texture;
}

/**
 * The emissive profile of a light slot, soft on all four edges.
 *
 * One texture serves every cove in the room — horizontal channels, vertical
 * slots and the soft bloom quads that sit over them — because the quads map it
 * with stretched UVs rather than tiled ones. A 3 m long, 140 mm tall channel
 * therefore fades over 1.5 m at its ends and over 70 mm at its edges, from the
 * same image. That matters more than it sounds: sharing the map is what keeps
 * the whole emissive layer to one draw call.
 *
 * The profile has no flat core. A plateau would put a visible boundary where it
 * meets the falloff, and a boundary is exactly the thing that makes drawn light
 * look drawn.
 */
export function slotTexture(power = 1.35): THREE.CanvasTexture {
  const key = `slot:${power}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 128;
  const [el, ctx] = canvas(size);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Distance to the nearest edge on each axis, normalised so the centre of
      // the tile is 1 and both edges are 0.
      const ax = Math.min(x, size - 1 - x) / (size * 0.5);
      const ay = Math.min(y, size - 1 - y) / (size * 0.5);
      const sx = ax * ax * (3 - 2 * ax);
      const sy = ay * ay * (3 - 2 * ay);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.pow(sx * sy, power) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = finish(el, { srgb: false });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, texture);
  return texture;
}

/**
 * The surface of a large backlit panel.
 *
 * A luminous wall drawn as a pure mathematical gradient looks like a gradient —
 * the eye reads the absence of any structure as a rendering artefact rather
 * than as a material. This is mostly white, with a very faint vertical fibre
 * and a slow horizontal drift over it, so the panel reads as a lit scrim with
 * something behind it. Tileable, because all of the falloff is done in vertex
 * colours where it can follow the geometry.
 */
export function scrimTexture(seed = 41): THREE.CanvasTexture {
  const key = `scrim:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const [el, ctx] = canvas(size);
  const random = rng(seed);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Vertical fibre. Drawn full height so the tile still wraps.
  for (let i = 0; i < size * 2; i++) {
    const x = random() * size;
    const a = random() * 0.022;
    ctx.fillStyle = random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(x, 0, 1, size);
  }

  // A few broad, very low-contrast bands: the unevenness of a real diffuser.
  for (let i = 0; i < 5; i++) {
    const y = random() * size;
    const h = size * (0.1 + random() * 0.3);
    const gradient = ctx.createLinearGradient(0, y, 0, y + h);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.5, `rgba(0,0,0,${0.012 + random() * 0.02})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, size, h);
  }

  const texture = finish(el, { repeat: [1, 1] });
  cache.set(key, texture);
  return texture;
}

/**
 * A radial pool, for the light falling under her and for soft contact shadow.
 */
export function radialTexture(falloff = 2.2, seed = 3): THREE.CanvasTexture {
  const key = `radial:${falloff}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const [el, ctx] = canvas(size);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(1, Math.hypot(x - half, y - half) / half);
      const v = Math.pow(1 - d, falloff);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = finish(el, { srgb: false });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, texture);
  return texture;
}

/** Frees every cached texture. Called when the last environment using them goes. */
export function disposeTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}

/**
 * A corridor wall with its lighting baked in.
 *
 * The first attempt at this room drew the light strips as separate thin quads
 * over near-black walls. That produced bright lines floating in a void: a strip
 * with no falloff is a drawn line, and a wall with no light on it is not a
 * surface at all. What makes a dark corridor read as a *room* is seeing the
 * light land — the glow spreading across the panel above and below each strip,
 * the surface emerging out of the dark near the light and disappearing away
 * from it.
 *
 * So the strip and its spill are the same image. One unlit textured quad per
 * wall carries the panelling, the strips, the bloom and the falloff together,
 * which is both far better looking and cheaper than the geometry it replaces.
 */
export function corridorWallTexture(opts: {
  /** Band centres as a fraction of height, 0 at the floor. */
  bands: number[];
  base?: string;
  glow?: string;
  core?: string;
  size?: number;
  seed?: number;
}): THREE.CanvasTexture {
  const key = 'corridor:' + JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit) return hit;

  const size = opts.size ?? 1024;
  const base = opts.base ?? '#0b0f18';
  const glow = opts.glow ?? '138,110,220';
  const core = opts.core ?? '#9a86e0';
  const random = rng(opts.seed ?? 91);

  const [el, ctx] = canvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // A general lift across the whole wall. Pure black between the bands is not
  // darkness, it is absence — the surface stops existing and the bands float in
  // a void. This is the difference between a dark room and no room.
  const ambient = ctx.createLinearGradient(0, 0, 0, size);
  ambient.addColorStop(0, `rgba(${glow},0.05)`);
  ambient.addColorStop(0.5, `rgba(${glow},0.1)`);
  ambient.addColorStop(1, `rgba(${glow},0.04)`);
  ctx.fillStyle = ambient;
  ctx.fillRect(0, 0, size, size);

  // Panel joints, so the wall has scale before any light touches it.
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 9; i++) {
    const x = Math.round((i / 9) * size) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  for (const band of opts.bands) {
    const y = size * (1 - band);

    // The spill: a wide soft gradient either side of the strip. This is the
    // part that was missing, and it is the part that makes it a room.
    const spread = size * 0.085;
    const wash = ctx.createLinearGradient(0, y - spread, 0, y + spread);
    wash.addColorStop(0, `rgba(${glow},0)`);
    wash.addColorStop(0.35, `rgba(${glow},0.09)`);
    wash.addColorStop(0.5, `rgba(${glow},0.24)`);
    wash.addColorStop(0.65, `rgba(${glow},0.09)`);
    wash.addColorStop(1, `rgba(${glow},0)`);
    ctx.fillStyle = wash;
    ctx.fillRect(0, y - spread, size, spread * 2);

    // The strip itself: a narrow bright core inside the spill.
    // Thin, and only moderately bright. At full white this read as a filament
    // burning through the wall; a cove is a *lit surface*, and the spill around
    // it is what should carry the eye.
    const coreHeight = size * 0.0045;
    const hot = ctx.createLinearGradient(0, y - coreHeight * 2.5, 0, y + coreHeight * 2.5);
    hot.addColorStop(0, `rgba(${glow},0)`);
    hot.addColorStop(0.5, core);
    hot.addColorStop(1, `rgba(${glow},0)`);
    ctx.fillStyle = hot;
    ctx.fillRect(0, y - coreHeight * 2.5, size, coreHeight * 5);
  }

  // Grain, so the large flat gradients do not band on an 8-bit panel.
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (random() - 0.5) * 9;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);

  const texture = finish(el);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, texture);
  return texture;
}

/**
 * The end wall: backlit shelving, drawn rather than modelled.
 *
 * At the far end of a foggy corridor a shelf of bottles resolves to a warm
 * rectangle with some vertical structure in it, so that is what this draws.
 * Modelling it would cost geometry to deliver the same handful of pixels.
 */
export function shelvingTexture(size = 1024, seed = 33): THREE.CanvasTexture {
  const key = `shelving:${size}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const random = rng(seed);
  const [el, ctx] = canvas(size);
  ctx.fillStyle = '#080b12';
  ctx.fillRect(0, 0, size, size);

  const bays = [
    { x: 0.06, w: 0.3 },
    { x: 0.64, w: 0.3 },
  ];
  const shelves = 5;

  for (const bay of bays) {
    const bx = bay.x * size;
    const bw = bay.w * size;

    // The recess the shelving sits in, lit from within.
    const recess = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    recess.addColorStop(0, 'rgba(120,100,190,0.05)');
    recess.addColorStop(0.5, 'rgba(140,120,210,0.16)');
    recess.addColorStop(1, 'rgba(120,100,190,0.05)');
    ctx.fillStyle = recess;
    ctx.fillRect(bx, size * 0.16, bw, size * 0.68);

    for (let s = 0; s < shelves; s++) {
      const y = size * (0.2 + s * 0.13);
      // The lit underside of each shelf.
      const lip = ctx.createLinearGradient(0, y, 0, y + size * 0.05);
      lip.addColorStop(0, 'rgba(215,200,255,0.5)');
      lip.addColorStop(1, 'rgba(140,120,210,0)');
      ctx.fillStyle = lip;
      ctx.fillRect(bx, y, bw, size * 0.05);

      // Bottles: vertical marks of varying width and brightness, standing on
      // the shelf. Silhouettes, because that is all they would ever be.
      let cursor = bx + bw * 0.06;
      while (cursor < bx + bw * 0.94) {
        const w = bw * (0.03 + random() * 0.05);
        const h = size * (0.045 + random() * 0.04);
        ctx.fillStyle = `rgba(${190 + random() * 50},${180 + random() * 50},235,${0.18 + random() * 0.3})`;
        ctx.fillRect(cursor, y - h + size * 0.008, w, h);
        cursor += w + bw * 0.025;
      }
    }
  }

  const texture = finish(el);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, texture);
  return texture;
}
