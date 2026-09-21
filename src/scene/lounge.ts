/** A furnished warm lounge, built in room coordinates rather than on an image plate. */
import * as THREE from 'three';
import { LIGHTING } from '@/character/palette.ts';
import type { EnvironmentLights, ElohimEnvironment } from './environment.ts';
import { clamp } from '@/lib/math.ts';
import { RoomGeometry } from './room-geometry.ts';

export class LoungeEnvironment implements ElohimEnvironment {
  readonly group = new THREE.Group();
  readonly lights: EnvironmentLights;
  readonly background = new THREE.Color(0x100c10);
  private room = new RoomGeometry();
  private presence = 1;
  private baseIntensities: readonly [number, number, number];
  private motes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private disposed = false;

  constructor(opts: { particles?: boolean; ground?: boolean } = {}) {
    const cfg = LIGHTING.lounge;
    const key = new THREE.DirectionalLight(cfg.key.color, cfg.key.intensity);
    key.position.set(...cfg.key.position);
    key.target.position.set(0, 1.4, -2.4);
    const rim = new THREE.DirectionalLight(0xaba2d2, 1.15);
    rim.position.set(-2.5, 2.6, -2.0);
    rim.target.position.set(1.3, 1.1, -4.5);
    const ambient = new THREE.AmbientLight(0xb5a3a1, .65);
    this.lights = { key, rim, ambient };
    this.baseIntensities = [cfg.key.intensity, 1.15, .65];
    this.group.name = 'LoungeEnvironment';
    this.group.add(key, key.target, rim, rim.target, ambient, this.room.group);
    this.buildRoom();
    // The architecture always includes its floor. `ground` now controls only
    // the optional character contact patch; a cropped sprite needs no patch.
    if (opts.ground !== false) {
      const shadow = this.room.light('Character contact', 0xffffff, .54);
      this.room.floorPatch(shadow, [0, .009, 0], [.43, .28], 0x000000, 1);
    }
    this.room.finish('Warm lounge');
    if (opts.particles !== false) this.buildMotes();
    this.setPresence(1);
  }

  private buildRoom(): void {
    const r = this.room;
    const plaster = r.surface('Warm plaster', 0x312c30, .9);
    const wood = r.surface('Smoked walnut', 0x3f2d28, .48);
    const dark = r.surface('Cabinet recess and joints', 0x100e15, .7);
    const bronze = r.surface('Brushed champagne', 0xb59768, .34, .48);
    const floor = r.surface('Polished dark stone', 0x3b3034, .19, .23, .035);
    const stone = r.surface('Stone veins', 0x54404a, .4);
    const linen = r.surface('Ivory upholstery', 0xbfb2a2, .92);
    const pillow = r.surface('Mauve velvet', 0x786775, .94);
    const curtain = r.surface('Pleated warm linen', 0xbd9770, .92, 0, .25);
    const glass = r.surface('Smoked glass products', 0x4c4549, .19, .22);
    const ceramic = r.surface('Porcelain products', 0xcac1af, .4);
    const leaves = r.surface('Plant foliage', 0x283933, .84);
    const amber = r.light('Warm architectural lighting', 0xffd4a0);
    const lilac = r.light('Lavender cabinet accent', 0x9a82cf);
    const window = r.light('Warm daylight glazing', 0xd5b68d);
    const reflections = r.light('Soft floor light', 0xffffff, .48, true);
    const shadow = r.light('Furniture contact shading', 0xffffff, .56);
    r.translucent(curtain, .84);
    r.grain(floor, 16, .011); r.grain(wood, 8, .009); r.grain(linen, 14, .004);
    r.marble(floor, 0x3e3438, 0x9b8e86);

    // A complete open-front interior: all six planes have thickness and depth.
    r.box(floor, [6.0, .14, 9.4], [0, -.085, -2.0]);
    r.box(plaster, [5.85, 3.38, .18], [0, 1.68, -6.32]);
    r.box(wood, [.18, 3.4, 8.7], [2.94, 1.7, -2.0]);
    r.box(dark, [6.1, .16, 9.0], [0, 3.43, -2.05]);
    r.box(wood, [.18, 3.4, 1.1], [-2.95, 1.7, -5.83]);
    // Full-height left window wall and the real pleated curtains in front.
    r.box(window, [.04, 3.13, 6.65], [-2.91, 1.65, -2.43]);
    for (let i = 0; i < 8; i++) {
      const z = .62 - i * .89;
      r.box(bronze, [.09, 3.23, .027], [-2.81, 1.64, z]);
      r.box(dark, [.045, .05, .8], [-2.81, .63, z - .41]);
    }
    r.box(wood, [.23, .16, 7.2], [-2.79, 3.29, -2.45]);
    r.box(amber, [.035, .025, 7.1], [-2.655, 3.20, -2.45]);
    r.curtain(curtain, -2.63, -5.97, .79, 3.14);
    // The hem, mullions and individual folds read in parallax as the camera moves.
    for (const z of [-5.8, -.0, .9]) r.box(wood, [.22, 3.35, .20], [-2.60, 1.68, z]);

    // Walnut wall paneling and thin champagne inlays on the sofa wall.
    for (let i = 0; i < 12; i++) {
      const z = -5.87 + i * .60;
      r.box(wood, [.035, 2.9, .57], [2.83, 1.75, z], .005, [0, 0, 0], .74 + (i % 3) * .08);
      if (i % 3 === 0) r.box(bronze, [.02, 2.8, .012], [2.797, 1.8, z - .287]);
    }
    for (const x of [-2.8, 2.78]) r.box(bronze, [.018, .045, 8], [x, .11, -2.15]);
    r.box(dark, [5.6, .09, .10], [0, .085, -6.19]);

    // Rear display cabinet: recessed cubbies, slab shelves, doors and bottles.
    r.box(wood, [3.87, 3.15, .48], [-.19, 1.62, -5.96], .025);
    r.box(dark, [3.58, 2.47, .065], [-.19, 1.90, -5.685]);
    r.box(wood, [3.60, .60, .38], [-.19, .39, -5.70], .016);
    for (let i = 0; i < 6; i++) {
      r.box(wood, [.571, .50, .045], [-1.66 + i * .592, .39, -5.474], .008, [0, 0, 0], .83 + (i % 2) * .15);
      r.box(bronze, [.15, .009, .018], [-1.66 + i * .592, .57, -5.442], .003);
    }
    for (let col = 0; col <= 4; col++) {
      const x = -1.96 + col * .885;
      r.box(bronze, [.018, 2.48, .31], [x, 1.9, -5.5]);
    }
    const shelves = [.71, 1.29, 1.89, 2.51];
    for (let row = 0; row < shelves.length; row++) {
      const y = shelves[row];
      r.box(wood, [3.56, .045, .43], [-.19, y, -5.52], .008);
      for (let col = 0; col < 4; col++) {
        const x = -1.52 + col * .887;
        r.box((row + col) % 5 === 0 ? lilac : amber, [.80, .017, .018], [x, y + .029, -5.303]);
        r.box(wood, [.83, .49, .025], [x, y + .28, -5.64], .003, [0, 0, 0], .55 + row * .08);
        r.recessShade(shadow, .83, .48, [x, y + .28, -5.617]);
        for (let item = 0; item < 3; item++) {
          const h = .16 + .065 * ((row * 3 + col + item) % 3), px = x - .23 + item * .19;
          r.bottle((col + item) % 3 === 0 ? ceramic : glass, bronze, ceramic, [px, y + .027, -5.42], h, .038 + (item % 2) * .009, row + col + item);
        }
      }
    }
    r.box(amber, [3.56, .019, .022], [-.19, 3.125, -5.40]);
    // A structural pier beside the cabinet, with a subtle violet foot light.
    r.box(wood, [.27, 3.3, .35], [-2.24, 1.65, -5.54], .018);
    r.box(lilac, [.27, .018, .36], [-2.24, .11, -5.52]);

    // An upholstered sectional occupies the right side, leaving the centre open.
    r.box(dark, [1.18, .17, 2.75], [2.02, .16, -4.0], .07);
    r.box(linen, [1.18, .33, 2.75], [2.02, .39, -4.0], .14);
    r.box(linen, [.30, .65, 2.85], [2.60, .71, -4.0], .13);
    r.box(linen, [1.08, .18, .86], [1.93, .62, -4.91], .085);
    r.box(linen, [1.08, .18, .86], [1.93, .62, -4.00], .085);
    r.box(linen, [1.08, .18, .86], [1.93, .62, -3.09], .085);
    r.box(linen, [1.08, .51, .28], [2.02, .63, -2.55], .12);
    r.box(linen, [1.12, .48, .29], [2.00, .62, -5.47], .12);
    r.box(linen, [1.24, .45, 1.02], [1.02, .41, -4.95], .15);
    for (let i = 0; i < 4; i++) {
      r.box(i % 2 ? pillow : linen, [.22, .53, .56], [2.29, .91, -5.08 + i * .70], .085, [0, -.12, -.20], .90 + i * .025);
    }
    // Thin welt seams give the cushions a tailored edge without extra materials.
    for (const z of [-4.47, -3.56, -2.66]) r.box(pillow, [1.02, .009, .009], [1.91, .642, z]);
    r.floorPatch(shadow, [1.75, .008, -4.05], [1.15, 1.7], 0x000000, 1);
    r.recessShade(shadow, 2.62, .49, [2.432, .76, -4.0], [0, -Math.PI / 2, 0], .70);

    // Foreground side table, a small tray and a full, real-leaf arrangement.
    r.cylinder(bronze, .39, .034, [1.78, .65, -2.20], .39, [0, 0, 0], 32);
    r.cylinder(dark, .28, .60, [1.78, .32, -2.20], .32, [0, 0, 0], 24);
    r.box(wood, [.28, .018, .20], [1.63, .681, -2.07], .008);
    r.cylinder(glass, .047, .075, [1.64, .727, -2.06], .05);
    r.plant(glass, wood, leaves, [1.93, .68, -2.32], .68);
    r.floorPatch(shadow, [1.78, .008, -2.2], [.48, .40], 0x000000, .8);
    // Inset artwork is geometry: a bronze frame and restrained raised linework.
    r.box(dark, [.055, 1.23, .89], [2.76, 2.04, -3.57], .03);
    r.box(pillow, [.03, 1.12, .78], [2.718, 2.04, -3.57], .02);
    for (let i = 0; i < 7; i++) r.curve(bronze, [[2.69, 1.63 + i * .04, -3.87], [2.69, 1.75 + i * .06, -3.57], [2.69, 2.30 + i * .024, -3.28]], .003, 12, 4);

    // Recessed ceiling tray follows the warm reference's rectangular silhouette.
    r.box(wood, [5.45, .18, 7.6], [0, 3.30, -2.38]);
    r.box(dark, [4.52, .05, 6.52], [0, 3.183, -2.42], .12);
    r.frame(bronze, 4.58, 6.59, .22, .035, [0, 3.166, -2.42], [Math.PI / 2, 0, 0]);
    r.frame(amber, 4.44, 6.46, .19, .016, [0, 3.14, -2.42], [Math.PI / 2, 0, 0]);
    for (const x of [-2.47, 2.47]) for (const z of [-5.45, -3.45, -1.45, .55]) {
      r.cylinder(bronze, .055, .024, [x, 3.195, z], .055, [0, 0, 0], 12);
      r.cylinder(amber, .038, .005, [x, 3.178, z], .038, [0, 0, 0], 12);
    }

    // Polished stone seams, veins, and inexpensive soft reflected window light.
    for (let x = -2.7; x < 3; x += .9) r.box(dark, [.006, .003, 8.8], [x, -.012, -2]);
    for (let z = -6; z < 2.5; z += 1.3) r.box(dark, [5.7, .003, .006], [0, -.011, z]);
    for (let i = 0; i < 13; i++) r.box(stone, [.005, .002, .65 + (i % 3) * .24], [-2.3 + (i * .73) % 4.7, -.009, -5.8 + (i * .89) % 7.6], 0, [0, -.8 + i * .17, 0], .20);
    for (let i = 0; i < 7; i++) r.floorPatch(reflections, [-1.87, -.005, -5.4 + i * .84], [.74, .25], 0xdfaa72, .62);
    r.floorPatch(reflections, [-.2, -.004, -5.24], [1.9, .34], 0xc49278, .24);
    r.reflectionStrip(reflections, -1.50, -1.55, .78, 6.0, 0xf3ca9e, .48);
    r.reflectionStrip(reflections, -.96, -1.87, .31, 5.7, 0xd0a887, .38);
  }

  private buildMotes(): void {
    const positions = new Float32Array(54 * 3);
    for (let i = 0; i < 54; i++) {
      positions[i * 3] = -2.4 + (i * .173) % 4.3;
      positions[i * 3 + 1] = .4 + (i * .217) % 2.5;
      positions[i * 3 + 2] = -5.2 + (i * .371) % 4;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xf4cb9b, size: .009, transparent: true, opacity: .2, blending: THREE.AdditiveBlending, depthWrite: false });
    this.motes = new THREE.Points(geo, material); this.motes.name = 'Window dust'; this.group.add(this.motes);
  }

  update(dt: number, elapsed: number): void {
    if (this.presence < .01 || !this.motes) return;
    const attr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < attr.count; i++) {
      attr.setY(i, .3 + ((attr.getY(i) - .3 + dt * (.006 + (i % 5) * .002)) % 2.65));
    }
    attr.needsUpdate = true;
    this.motes.material.opacity = this.presence * (.18 + .015 * Math.sin(elapsed * .4));
  }

  setPresence(value: number): void {
    this.presence = clamp(value); this.group.visible = this.presence > .001;
    this.room.setPresence(this.presence);
    if (this.motes) this.motes.material.opacity = .2 * this.presence;
    this.lights.key.intensity = this.baseIntensities[0] * this.presence;
    this.lights.rim.intensity = this.baseIntensities[1] * this.presence;
    this.lights.ambient.intensity = this.baseIntensities[2] * this.presence;
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.room.dispose(); this.motes?.geometry.dispose(); this.motes?.material.dispose();
    this.lights.key.dispose(); this.lights.rim.dispose(); this.lights.ambient.dispose();
    this.motes = null; this.group.clear(); this.group.removeFromParent();
  }
}
