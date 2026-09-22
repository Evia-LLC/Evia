/**
 * Evia's look, in one place.
 *
 * Kept separate from the rig so the palette can be retuned — or driven by a
 * future customisation screen — without touching a line of geometry.
 */
export const PALETTE = {
  skin: 0x8d5a3d,
  skinShadow: 0x6f4530,
  hair: 0x1d1418,
  hairSheen: 0x33232c,
  lips: 0x8c4640,
  eyeWhite: 0xf2ece8,
  iris: 0x3a2418,
  pupil: 0x0d0808,
  brow: 0x1d1418,

  casualTop: 0x2f3f57,
  casualTrim: 0x486787,
  // Darker than a lab coat, on purpose.
  //
  // The clinical room is lit by one soft source and is otherwise near-black, so
  // a near-white garment became the brightest thing in frame — brighter than
  // the light itself — and she read as a cut-out pasted over the room rather
  // than a person standing in it. A consultant in a dark room wears something
  // the room can light; the highlights come from the scrim, not from the cloth.
  clinicalCoat: 0x4b5a6e,
  clinicalTrim: 0x7fd4ff,

  loungeFloor: 0x14161f,
  loungeWall: 0x0e1018,
  loungeAccent: 0xd8a06a,

  clinicalFloor: 0x080a11,
  clinicalWall: 0x05070c,
  /**
   * One projection hue: cyan. Owner's call.
   *
   * The violet experiment gave the room its own brand, and the room is not the
   * brand — the interface is, and the interface is restrained champagne on
   * dark. Two accent systems in one frame argue. So everything projected
   * speaks this one cyan, champagne is the emphasis voice, and the semantic
   * tones below are the DOM's own sage and clay, so a reading never changes
   * meaning when it moves between a card in the room and a panel on the page.
   */
  holo: 0x7fd4ff,
  /** The same cyan under its older name; call sites outside the rig still use it. */
  holoCyan: 0x7fd4ff,
  holoWarm: 0xffc98a,
  holoAlert: 0xff8f7a,

  /** Semantic tones, matched to the DOM. Good news is sage, bad news is clay. */
  good: 0xa6c9b7,
  bad: 0xd8a595,
  neutral: 0x7fd4ff,
  champagne: 0xcfbba0,
} as const;

/** Light rigs per environment. Two lights plus ambient — the budget allows no more. */
export const LIGHTING = {
  lounge: {
    // Aimed at her face, not at the floor: a directional light targets the
    // origin by default, which pitched the key steeply downward and left the
    // face reading almost black.
    key: { color: 0xffd9b0, intensity: 2.6, position: [1.5, 2.2, 2.4] as const },
    rim: { color: 0x7f9ae0, intensity: 1.35, position: [-2.0, 1.7, -1.2] as const },
    ambient: { color: 0x4a4560, intensity: 1.9 },
  },
  /**
   * Dimmer than it wants to be.
   *
   * The clinic is a good room and it was winning. At a close framing the
   * background is context, not subject — so the ambient comes down hard and the
   * rim carries the edges, leaving her and the holograms as the only things in
   * frame with real luminance.
   */
  /**
   * Lit from above.
   *
   * The key was at head height and slightly in front, which lights a face flatly
   * and says nothing about the room. The reference is lit from overhead — a
   * bright top edge on the hair and the shoulders, cheekbones catching, the
   * underside falling away. That single change does more for how she sits in the
   * space than any amount of fill.
   */
  /**
   * Matched to the backdrop plate, not chosen in isolation.
   *
   * This is what made her read as a cutout. The plate is lit by teal glass
   * shelving down its left side and violet wall coves down its right, and she
   * was lit by a bright neutral key from the *right* — a person and a room
   * disagreeing about where the light in the room is. No amount of detail
   * survives that.
   *
   * So: the key is teal and comes from the left, at the height of the shelving.
   * The rim is violet and comes from the right, where the coves are. Both are
   * dimmer than before, because in the plate nothing is brightly lit — the
   * whole picture is dark, and she has to be dark in it.
   */
  clinical: {
    key: { color: 0x9fe6e0, intensity: 1.5, position: [-2.6, 2.6, 1.8] as const },
    rim: { color: 0x9b8cf0, intensity: 1.15, position: [2.4, 2.0, -0.8] as const },
    ambient: { color: 0x121a26, intensity: 0.6 },
  },
} as const;
