/**
 * SAMPLE DATA for the Scan page (the ref4 consult-room mockup), shown only with
 * sample mode on and its "Sample data" badge up.
 *
 * Every string and number here is copied from the mockup as measured in
 * specs/scan.md (sections 2.1-2.8 and 7). None of it is a reading of anyone:
 * several items are things a camera cannot measure at all (the percentages,
 * "Barrier support", "Loss of elasticity" and the rest listed in
 * design/counsel/scan.md), which is exactly why they only ever appear here,
 * under the badge. Real mode builds its view from the live analysis instead
 * (src/view/scan.ts) and never falls back to these values.
 *
 * The Gen-Z card copy is not in the mockup (it only shows "Detailed"
 * selected); it is written here so the toggle has something to switch to in
 * the preview, and it is on the counsel list with the rest.
 *
 * The hologram's face in sample mode is the sample mesh
 * (scan-face-mesh.json), traced from the mockup's own hologram, not a person.
 * The zone thumbnails are neutral skin-texture tiles (no faces, BUILD-PLAN
 * decision 3), drawn by the page from `art`.
 */
import type { ScanView } from '@/view/scan.ts';

export const SAMPLE_SCAN: ScanView = {
  mode: 'sample',
  phase: 'consultation',
  status: {
    title: 'Clinical analysis activated',
    eyebrow: '3D SKIN MAPPING · AI ANALYSIS · PERSONALIZED INSIGHTS',
    // The mockup's dot glows steadily here: there is no pipeline running in a
    // preview, so it does not pulse (the pulse means "the real analysis is live").
    live: false,
  },
  mesh: 'sample',
  // Zone tones and strengths as the hologram builder tuned them against ref4.
  highlights: [
    { region: 'forehead', tone: 'pink', strength: 0.85 },
    { region: 'periorbitalLeft', tone: 'lavender', strength: 0.6 },
    { region: 'cheekLeft', tone: 'pink', strength: 0.8 },
    { region: 'cheekRight', tone: 'pink', strength: 0.55 },
    { region: 'periorbitalRight', tone: 'periwinkle', strength: 0.8 },
    { region: 'chin', tone: 'lavender', strength: 0.7 },
  ],
  activeSlot: null,
  callouts: [
    {
      slot: 'forehead',
      heading: 'FOREHEAD',
      lines: ['Uneven texture', 'Early congestion', 'Slight dehydration'],
      anchor: 'forehead',
      thumb: { kind: 'sample', art: 'forehead' },
      metrics: [],
    },
    {
      slot: 'tzone',
      heading: 'PORES',
      lines: ['Visible pores', 'Oil activity (T-zone)', 'Texture irregularity'],
      // The mockup's PORES leader lands on the left under-eye crescent (758,283).
      anchor: 'periorbitalLeft',
      thumb: { kind: 'sample', art: 'pores' },
      metrics: [],
    },
    {
      slot: 'cheeks',
      heading: 'CHEEKS',
      lines: ['Mild redness', 'Barrier sensitivity', 'Uneven tone'],
      anchor: 'cheekLeft',
      thumb: { kind: 'sample', art: 'cheeks' },
      metrics: [],
    },
    {
      slot: 'underEyes',
      heading: 'UNDER-EYES',
      lines: ['Mild dark circles', 'Dehydration lines', 'Loss of elasticity'],
      anchor: 'periorbitalRight',
      thumb: { kind: 'sample', art: 'underEyes' },
      metrics: [],
    },
    {
      slot: 'chin',
      heading: 'CHIN',
      lines: ['Congestion', 'Texture irregularity', 'Post-blemish marks'],
      anchor: 'chin',
      thumb: { kind: 'sample', art: 'chin' },
      metrics: [],
    },
  ],
  concerns: {
    rows: [
      { id: 'dehydration', label: 'Dehydration', glyph: 'droplet', tone: 'blue', severity: 'High', metric: null },
      { id: 'texture', label: 'Texture Irregularity', glyph: 'texture', tone: 'steel', severity: 'Moderate', metric: null },
      { id: 'redness', label: 'Redness / Sensitivity', glyph: 'redness', tone: 'rose', severity: 'Moderate', metric: null },
      { id: 'pores', label: 'Visible Pores', glyph: 'pores', tone: 'periwinkle', severity: 'Moderate', metric: null },
      { id: 'barrier', label: 'Barrier Weakness', glyph: 'barrier', tone: 'lavender', severity: 'Mild', metric: null },
    ],
    empty: null,
  },
  cards: [
    {
      id: 'hydration',
      title: 'HYDRATION',
      glyph: 'droplet',
      value: '62%',
      valueKind: 'percent',
      // Every mockup gauge is drawn half full whatever its number: decoration.
      arc: 0.5,
      status: 'Below optimal levels',
      copy: {
        detailed: 'Skin shows signs of dehydration, especially in under-eye area.',
        genz: 'Your skin is lowkey thirsty, especially under the eyes.',
      },
      metric: null,
    },
    {
      id: 'texture',
      title: 'TEXTURE',
      glyph: 'texture',
      value: '68%',
      valueKind: 'percent',
      arc: 0.5,
      status: 'Mild irregularity',
      copy: {
        detailed: 'Uneven texture detected across cheeks and chin.',
        genz: 'A little bumpy across the cheeks and chin.',
      },
      metric: null,
    },
    {
      id: 'barrier',
      title: 'BARRIER SUPPORT',
      glyph: 'shield',
      value: '54%',
      valueKind: 'percent',
      arc: 0.5,
      status: 'Needs care',
      copy: {
        detailed: 'Signs of a weakened skin barrier and increased sensitivity.',
        genz: 'Your barrier needs some TLC right now.',
      },
      metric: null,
    },
  ],
  capturedAt: null,
};
