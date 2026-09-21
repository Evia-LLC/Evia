/**
 * Floating holographic readouts — the analysis, in the room, around her.
 *
 * The readouts used to live in a DOM panel pinned to the right of the screen.
 * That solved a real problem (projected labels landing on top of the chat) and
 * created a worse one: the analysis became a television on the wall. Nothing
 * about it said the room was doing the analysing, and Elohim was standing next
 * to a screen rather than inside her own instrument.
 *
 * These are the middle path. Each card is a single quad carrying a canvas
 * texture, placed in world space around her: real depth, real parallax, and it
 * moves when the camera moves, because it is actually there. Text stays sharp
 * because a 512px canvas drawn once is sharper than the card is ever rendered.
 *
 * A translucent ground preserves readable text; separate additive light rails
 * and fine interference lines give the panels their holographic character.
 */
import * as THREE from 'three';

export interface CardTone {
  /** Base glow. */
  hue: string;
  /** Accent for the value and the arc. */
  accent: string;
}

/*
 * Keyed to the palette's semantics, spelled as CSS because canvas wants CSS:
 * neutral is the projection cyan (PALETTE.neutral), good is the DOM's sage
 * (PALETTE.good), bad is its clay (PALETTE.bad). A reading means the same
 * thing on a card in the room as it does in the interface below it.
 */
export const TONE_NEUTRAL: CardTone = { hue: 'rgba(127,212,255,', accent: '#7fd4ff' };
export const TONE_GOOD: CardTone = { hue: 'rgba(166,201,183,', accent: '#a6c9b7' };
export const TONE_BAD: CardTone = { hue: 'rgba(216,165,149,', accent: '#d8a595' };

/** Pixels per world metre. High enough that a card never resolves its texels. */
const RESOLUTION = 1200;

/*
 * Canvas text does not reflow.
 *
 * Every card is set in Manrope at weight 500, and a card drawn before the face
 * arrives is drawn in the fallback and stays that way — on a cold session the
 * whole rack shipped in Segoe. Each card remembers its last draw; when the
 * face lands, every live card repaints once. `fonts.ready` is the backstop for
 * browsers where `load` resolves empty because the @font-face has not
 * registered yet.
 */
let holoFontReady = typeof document === 'undefined' || !document.fonts;
const awaitingFont = new Set<HoloCard>();
if (!holoFontReady) {
  const arrived = () => {
    if (holoFontReady) return;
    holoFontReady = true;
    for (const card of awaitingFont) card.repaint();
    awaitingFont.clear();
  };
  document.fonts
    .load('500 16px Manrope')
    .then((faces) => {
      if (faces.length > 0) arrived();
    })
    .catch(() => {});
  document.fonts.ready.then(arrived).catch(() => {});
}

export class HoloCard {
  readonly mesh: THREE.Mesh;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshBasicMaterial;
  private frame: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  /** 0..1 arrival, driven by the boot cascade. */
  private reveal = 0;
  private revealTarget = 0;

  /** The last draw, kept so a late-arriving font can replay it. */
  private redraw: (() => void) | null = null;

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * RESOLUTION);
    this.canvas.height = Math.round(height * RESOLUTION);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      /*
       * Normal blending, not additive.
       *
       * Additive light *only adds*: it cannot put anything dark on screen, so
       * a card over a lit wall could never be more than the wall plus a glow.
       * These carry their own dark ground now, which needs a blend mode that
       * can actually darken. The glow comes from the bright ink on top.
       */
      blending: THREE.NormalBlending,
      depthWrite: false,
      // An overlay, like the rest of the holographic layer: it is light in the
      // room, not a surface in it, so geometry must never occlude it.
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material);
    this.mesh.frustumCulled = false;
    // Separate light rails sit behind the readable glass. Their real depth is
    // visible during camera moves; text stays on one stable, sharp surface.
    const rails: number[] = [];
    const x = width * 0.495, y = height * 0.45;
    const cut = Math.min(width, height) * 0.13;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const cx = sx * x, cy = sy * y;
      rails.push(cx - sx * cut, cy, -0.008, cx, cy, -0.008);
      rails.push(cx, cy, -0.008, cx, cy - sy * cut, -0.008);
      rails.push(cx, cy, -0.008, cx + sx * 0.003, cy + sy * 0.003, -0.021);
    }
    const frameGeometry = new THREE.BufferGeometry();
    frameGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rails, 3));
    this.frame = new THREE.LineSegments(frameGeometry, new THREE.LineBasicMaterial({
      color: 0x8caeff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.frame.frustumCulled = false;
    this.mesh.add(this.frame);
  }

  /**
   * Draws a metric as a strip: one line, read left to right.
   *
   * The previous card was a small poster — label, big numeral, a sentence and a
   * dial, six times over. Six posters is not a readout, it is wallpaper: every
   * item shouted equally, so nothing was the finding and the eye had nowhere to
   * start. A strip carries the same four facts in a quarter of the area, which
   * is what buys the headline above it the room to actually be a headline.
   */
  drawMetric(
    label: string,
    value: number,
    movement: string,
    tone: CardTone,
    fraction: number,
    /** A band to print instead of the number — see `drawHeadline`. */
    display?: { value: string; unit: string },
  ): void {
    this.rememberDraw(() => this.drawMetric(label, value, movement, tone, fraction, display));
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = h * 0.09;
    this.plate(tone, w, h, pad, h * 0.24);

    // A rule down the leading edge in the tone colour. At strip size this reads
    // as status faster than colouring the text does.
    ctx.fillStyle = tone.accent;
    ctx.fillRect(pad, pad + h * 0.1, Math.max(2, h * 0.045), h - pad * 2 - h * 0.2);

    ctx.textBaseline = 'alphabetic';

    /*
     * Right-hand block first, then whatever room is left goes to the label.
     *
     * Drawn the other way round, "Breakout signs" ran straight under its own
     * number — the widest label in the set against the one layout that had no
     * idea how wide anything was. The number is the reading; it gets the space
     * it needs, and the label lives on what remains.
     */
    ctx.textAlign = 'right';
    const rightEdge = w - pad - h * 0.22;

    // Movement, kept to a token — "+9", "−8", "steady" — because at this size a
    // sentence is a smear.
    const token = movement.replace(' since last', '').replace('holding steady', 'steady');
    ctx.fillStyle = token === 'steady' || token === 'first reading'
      ? tone.hue + '0.45)'
      : tone.accent;
    ctx.font = `500 ${Math.round(h * 0.2)}px Manrope, system-ui, sans-serif`;
    ctx.fillText(token, rightEdge, h * 0.6);
    const tokenWidth = ctx.measureText(token).width;

    // Value.
    ctx.fillStyle = '#f2eeff';
    ctx.shadowColor = tone.accent;
    ctx.shadowBlur = h * 0.16;
/*
     * A word where the number was.
     *
     * Smaller when it is a word: "Moderate" wants to be read, where a figure
     * wants to be glanced at. One face for both — the monospace numerals were
     * the only thing on these cards not set in the interface's own type, and
     * a second family on a strip this small read as a second instrument.
     * Fitted, because "Off scale" is twice the width of "62" and a strip is
     * not wide.
     */
    ctx.font = display
      ? `500 ${Math.round(h * 0.24)}px Manrope, system-ui, sans-serif`
      : `500 ${Math.round(h * 0.34)}px Manrope, system-ui, sans-serif`;
    const numeral = display ? display.value : String(Math.round(value));
    const numeralRight = rightEdge - tokenWidth - h * 0.16;
    ctx.fillText(numeral, numeralRight, h * 0.62);
    ctx.shadowBlur = 0;
    const numeralWidth = ctx.measureText(numeral).width;

    // Label, in the space that is actually left.
    ctx.textAlign = 'left';
    ctx.fillStyle = tone.hue + '0.82)';
    ctx.font = `500 ${Math.round(h * 0.235)}px Manrope, system-ui, sans-serif`;
    ctx.letterSpacing = `${Math.max(1, Math.round(h * 0.03))}px`;
    const labelX = pad + h * 0.28;
    /*
     * Shrink before cutting.
     *
     * A band is wider than a two-digit number, so the room left for the label
     * shrank the moment findings replaced scores — and "TONE E…" names nothing.
     * The type gives way first; the word only loses letters if even the floor
     * cannot hold it.
     */
    this.fitText(
      label.toUpperCase(),
      labelX,
      h * 0.6,
      numeralRight - numeralWidth - h * 0.16 - labelX,
      (px) => `500 ${px}px Manrope, system-ui, sans-serif`,
      h * 0.235,
      h * 0.15,
    );
    ctx.letterSpacing = '0px';

    // The value again, as a length. A hairline, not a dial — a dial at strip
    // scale is a smudge, and six smudges is the wallpaper problem again.
    this.bar(tone, pad + h * 0.28, h * 0.75, w - pad * 2 - h * 0.5, Math.max(2, h * 0.05), fraction);

    this.texture.needsUpdate = true;
  }

  /**
   * The headline: the one reading the rest of the column is context for.
   *
   * Which metric this is comes from the same selection that orders the strips,
   * so the biggest thing on screen is the thing most worth saying — not simply
   * whichever metric happens to be first in the type.
   */
  drawHeadline(
    eyebrow: string,
    label: string,
    value: number,
    movement: string,
    note: string,
    tone: CardTone,
    fraction: number,
    /**
     * What to print instead of "N /100".
     *
     * Some readings are not scores. An abdominal profile is a proportion —
     * torso depth at the belly over depth at the chest — and rendering it as
     * "7 /100" under a progress bar turns a measurement into a grade, in the
     * one part of the app most likely to be read as a judgement about a body.
     * Given a display, the card prints the measurement in its own units.
     */
    display?: { value: string; unit: string },
  ): void {
    this.rememberDraw(() =>
      this.drawHeadline(eyebrow, label, value, movement, note, tone, fraction, display),
    );
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = h * 0.07;
    this.plate(tone, w, h, pad, pad * 0.55);
    this.brackets(tone, w, h, pad);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const x = pad + h * 0.13;

    // Eyebrow — says why this one is at the top. Tracked at 14% of the size,
    // the wide-but-readable ceiling; the old spacing was nearly triple that
    // and the word fell apart into letters.
    ctx.fillStyle = tone.hue + '0.62)';
    ctx.font = `500 ${Math.round(h * 0.072)}px Manrope, system-ui, sans-serif`;
    ctx.letterSpacing = `${Math.max(1, Math.round(h * 0.072 * 0.14))}px`;
    this.ellipsize(eyebrow.toUpperCase(), x, pad + h * 0.16, w - pad * 2 - h * 0.26);
    ctx.letterSpacing = '0px';

    /*
     * The pill is optional.
     *
     * An empty movement means there is nothing to say about change — the
     * all-clear card, for instance — and drawing an empty capsule there costs
     * the title a third of its width for no information. Skipping it gives
     * "All clear" the room to actually say "All clear".
     */
    const hasPill = movement.trim().length > 0;

    // Movement, as a pill, up on the title's line.
    //
    // It began beside the numeral, where "/100" and "+9 since last" competed
    // for the same strip of card and lost — a status and a denominator are
    // different kinds of thing and should never have been on one line.
    ctx.font = `500 ${Math.round(h * 0.1)}px Manrope, system-ui, sans-serif`;
    // The token, not the sentence — "+9", not "+9 since last". The note under
    // the bar already says when, and a pill wide enough to repeat it ate the
    // title beside it down to "Hydr…".
    /*
     * Tokens, not sentences.
     *
     * The pill is measured before the title and takes what it needs, so every
     * extra word here comes straight out of the label beside it. "first
     * reading" is what cut "Abdominal profile" down to "A…".
     */
    const pillText = movement
      .replace(' since last', '')
      .replace('holding steady', 'steady')
      .replace('first reading', 'first');
    const pillW = ctx.measureText(pillText).width + h * 0.24;
    const pillH = h * 0.17;
    const pillX = w - pad - h * 0.13 - pillW;
    const pillY = pad + h * 0.32 - pillH * 0.76;
    if (hasPill) {
      ctx.fillStyle = tone.hue + '0.22)';
      this.roundRect(pillX, pillY, pillW, pillH, pillH * 0.5);
      ctx.fill();
      ctx.strokeStyle = tone.hue + '0.5)';
      ctx.lineWidth = Math.max(1.5, h * 0.008);
      this.roundRect(pillX, pillY, pillW, pillH, pillH * 0.5);
      ctx.stroke();
      ctx.fillStyle = tone.accent;
      ctx.textAlign = 'center';
      ctx.fillText(pillText, pillX + pillW / 2, pillY + pillH * 0.68);
      ctx.textAlign = 'left';
    }

    // Title, in whatever the pill left.
    ctx.fillStyle = '#f4f1ff';
    const titleRight = hasPill ? pillX - h * 0.1 : w - pad - h * 0.13;
    this.fitText(
      label,
      x,
      pad + h * 0.32,
      titleRight - x,
      (px) => `500 ${px}px Manrope, system-ui, sans-serif`,
      h * 0.135,
      h * 0.076,
    );

    // Value, and the scale it is on. Without the denominator a number floating
    // on a hologram is a number the viewer has to be told how to read.
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = tone.accent;
    ctx.shadowBlur = h * 0.13;
    ctx.font = display
      ? `500 ${Math.round(h * 0.2)}px Manrope, system-ui, sans-serif`
      : `500 ${Math.round(h * 0.3)}px Manrope, system-ui, sans-serif`;
    const numeral = display ? display.value : String(Math.round(value));
    ctx.fillText(numeral, x, h * 0.66);
    ctx.shadowBlur = 0;
    const numeralWidth = ctx.measureText(numeral).width;

    ctx.fillStyle = tone.hue + '0.4)';
    ctx.font = `500 ${Math.round(h * 0.1)}px Manrope, system-ui, sans-serif`;
    ctx.fillText(display ? display.unit : '/100', x + numeralWidth + h * 0.04, h * 0.66);

    // A proportion has no "full", so it gets a position tick rather than a bar
    // that fills — a bar reads as progress toward something, and there is
    // nothing here to progress toward.
    this.bar(tone, x, h * 0.78, w - pad * 2 - h * 0.26, Math.max(3, h * 0.026), display ? 0 : fraction);

    // One line of plain language under the bar. The number says how much; this
    // says what it is — and it is the only sentence in the whole column.
    ctx.fillStyle = tone.hue + '0.55)';
    this.fitText(
      note,
      x,
      h * 0.9,
      w - pad * 2 - h * 0.26,
      (px) => `400 ${px}px Manrope, system-ui, sans-serif`,
      h * 0.088,
      h * 0.052,
    );

    this.texture.needsUpdate = true;
  }

  /**
   * Empties the card.
   *
   * Needed because the rack is built once and the number of findings varies:
   * a card left undrawn keeps whatever the previous scan put on it, which is
   * the worst possible thing for a display whose entire claim is that it shows
   * this scan.
   */
  blank(): void {
    // A blanked card stays blank: a font arriving later must not resurrect
    // the reading that was just cleared.
    this.redraw = null;
    awaitingFont.delete(this);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  /** Records the draw so `repaint` can replay it. See `holoFontReady`. */
  private rememberDraw(redraw: () => void): void {
    this.redraw = redraw;
    if (!holoFontReady) awaitingFont.add(this);
  }

  /** Replays the last draw. Called once, when Manrope finishes loading. */
  repaint(): void {
    this.redraw?.();
  }

  /** A value drawn as a length: dim track, bright fill. */
  private bar(
    tone: CardTone,
    x: number,
    y: number,
    width: number,
    thickness: number,
    fraction: number,
  ): void {
    const { ctx } = this;
    ctx.fillStyle = tone.hue + '0.14)';
    this.roundRect(x, y, width, thickness, thickness / 2);
    ctx.fill();
    const filled = Math.max(thickness, width * Math.min(1, Math.max(0, fraction)));
    ctx.fillStyle = tone.accent;
    ctx.shadowColor = tone.accent;
    ctx.shadowBlur = thickness * 2.5;
    this.roundRect(x, y, filled, thickness, thickness / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /**
   * The leading routine step, on the headline card.
   *
   * Rewritten after seeing it with a real plan. The old layout put the title at
   * a fixed baseline and wrapped it downwards without limit, so a title of more
   * than two lines — which is most of them, once the titles are written by the
   * planner rather than by me — ran straight through the actives and the
   * because-line underneath. Anything that wraps has to own the space it can
   * wrap into, and stop when it runs out.
   */
  drawStep(step: string, title: string, actives: string, why: string, tone: CardTone): void {
    this.rememberDraw(() => this.drawStep(step, title, actives, why, tone));
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = h * 0.07;
    this.plate(tone, w, h, pad, pad * 0.55);
    this.brackets(tone, w, h, pad);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Inset from the plate by a fraction of the *height*, which on a card this
    // wide was taking 63px off each side of a 360px canvas and costing the
    // title a word.
    const x = pad + h * 0.075;
    const maxWidth = w - pad * 2 - h * 0.15;

    // Step name. Champagne — the interface's own emphasis voice — because the
    // routine is a different kind of thing from the readings and should not
    // be mistaken for one at a glance.
    ctx.fillStyle = '#cfbba0';
    ctx.font = `500 ${Math.round(h * 0.078)}px Manrope, system-ui, sans-serif`;
    ctx.letterSpacing = `${Math.max(1, Math.round(h * 0.078 * 0.14))}px`;
    this.ellipsize(`step 1 · ${step}`.toUpperCase(), x, pad + h * 0.14, maxWidth);
    ctx.letterSpacing = '0px';

    // Title. Two lines, hard limit.
    ctx.fillStyle = '#f4f1ff';
    ctx.font = `500 ${Math.round(h * 0.115)}px Manrope, system-ui, sans-serif`;
    this.wrap(title, x, h * 0.38, maxWidth, h * 0.148, 2);

    // What is actually in it. Never a brand — the planner refuses to name one
    // and this only renders what it produced.
    ctx.fillStyle = tone.accent;
    ctx.font = `500 ${Math.round(h * 0.093)}px Manrope, system-ui, sans-serif`;
    this.ellipsize(actives, x, h * 0.72, maxWidth);

    // Why it is being suggested. The one question a recommendation must answer.
    ctx.fillStyle = tone.hue + '0.55)';
    ctx.font = `400 ${Math.round(h * 0.082)}px Manrope, system-ui, sans-serif`;
    this.ellipsize(why, x, h * 0.86, maxWidth);

    this.texture.needsUpdate = true;
  }

  /**
   * A routine step at strip size.
   *
   * Same negotiation as the metric strips, for the same reason: the actives are
   * a variable-length list and the title is a variable-length sentence, and
   * drawing either at a fixed position guarantees they meet in the middle. The
   * actives get a fixed share of the width, the title gets what is left, and
   * both are cut to fit rather than allowed to overlap.
   */
  drawStepStrip(index: number, step: string, title: string, actives: string, tone: CardTone): void {
    this.rememberDraw(() => this.drawStepStrip(index, step, title, actives, tone));
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = h * 0.09;
    this.plate(tone, w, h, pad, h * 0.24);

    ctx.textBaseline = 'alphabetic';

    // The order matters in a routine, so the order is the first thing drawn.
    ctx.textAlign = 'left';
    ctx.fillStyle = '#cfbba0';
    ctx.font = `500 ${Math.round(h * 0.28)}px Manrope, system-ui, sans-serif`;
    ctx.fillText(String(index + 1), pad + h * 0.2, h * 0.58);

    /*
     * Two stacked rows, both the full width.
     *
     * The first attempt put the actives to the right of the title, which is how
     * the metric strips work — but a metric's right-hand block is a two-digit
     * number and an active is "hyaluronic acid · panthenol". Sharing a row
     * between two variable-length strings left the title about seventeen
     * characters, and every real plan title is longer than that: they all came
     * out as "A humectant s…". Stacking them gives each the whole strip.
     */
    const textX = pad + h * 0.66;
    const textWidth = w - pad - h * 0.22 - textX;

    // Step and actives on one dim line. The ingredients have to be here — the
    // planner never names a product, so this is the only thing that says what
    // the step actually is.
    ctx.textAlign = 'left';
    ctx.fillStyle = tone.hue + '0.6)';
    ctx.font = `500 ${Math.round(h * 0.135)}px Manrope, system-ui, sans-serif`;
    ctx.letterSpacing = `${Math.max(1, Math.round(h * 0.018))}px`;
    this.ellipsize(`${step} · ${actives}`.toUpperCase(), textX, h * 0.36, textWidth);
    ctx.letterSpacing = '0px';

    ctx.fillStyle = '#eef0ff';
    ctx.font = `500 ${Math.round(h * 0.2)}px Manrope, system-ui, sans-serif`;
    this.ellipsize(title, textX, h * 0.7, textWidth);

    this.texture.needsUpdate = true;
  }

  /**
   * A callout on the contour model: where on the face, and what was measured
   * there. Two lines and a rule — it is a label, not a panel.
   */
  drawCallout(where: string, what: string, value: number | null): void {
    this.rememberDraw(() => this.drawCallout(where, what, value));
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    /*
     * A dark wash behind the words.
     *
     * These were drawn straight onto whatever was behind them, which was fine
     * against a black room and useless against a photograph: the corridor's own
     * wall lights run horizontally through exactly this band of the frame and
     * the labels sat inside them, unreadable. A soft gradient — dark under the
     * text, gone by the right edge — gives them contrast without putting a
     * rectangle in mid-air.
     */
    const shade = ctx.createLinearGradient(0, 0, w, 0);
    shade.addColorStop(0, 'rgba(3,5,12,0.72)');
    shade.addColorStop(0.62, 'rgba(3,5,12,0.58)');
    shade.addColorStop(1, 'rgba(3,5,12,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);

    // Erase the wash's top and bottom edges. A gradient that is hard on two
    // sides is a rectangle, and a rectangle floating in a room is a sticker.
    const feather = ctx.createLinearGradient(0, 0, 0, h);
    feather.addColorStop(0, 'rgba(0,0,0,1)');
    feather.addColorStop(0.28, 'rgba(0,0,0,0)');
    feather.addColorStop(0.72, 'rgba(0,0,0,0)');
    feather.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = feather;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // The reading, hard right and large. On a zone map the number is the
    // finding; the zone name is only the address it was found at.
    let numberLeft = w;
    if (value !== null) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = TONE_NEUTRAL.accent;
      ctx.shadowBlur = h * 0.18;
      ctx.font = `500 ${Math.round(h * 0.42)}px Manrope, system-ui, sans-serif`;
      const numeral = String(Math.round(value));
      ctx.fillText(numeral, w * 0.95, h * 0.66);
      ctx.shadowBlur = 0;
      numberLeft = w * 0.95 - ctx.measureText(numeral).width - h * 0.18;
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#f2ecff';
    ctx.font = `500 ${Math.round(h * 0.3)}px Manrope, system-ui, sans-serif`;
    this.ellipsize(where, w * 0.09, h * 0.42, numberLeft - w * 0.09);

    ctx.fillStyle = TONE_NEUTRAL.accent;
    ctx.font = `500 ${Math.round(h * 0.24)}px Manrope, system-ui, sans-serif`;
    this.ellipsize(what, w * 0.09, h * 0.76, numberLeft - w * 0.09);

    // A rule under the label, running back towards the leader line.
    ctx.strokeStyle = TONE_NEUTRAL.hue + '0.45)';
    ctx.lineWidth = Math.max(2, h * 0.03);
    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * 0.9);
    ctx.lineTo(w * 0.94, h * 0.9);
    ctx.stroke();

    this.texture.needsUpdate = true;
  }

  /**
   * The ground a card is drawn on: dark plate, tinted wash, hairline border.
   *
   * Split out from the corner brackets, which now belong to the headline alone.
   * Brackets on all six read as six instruments rather than one.
   */
  private plate(tone: CardTone, w: number, h: number, pad: number, r: number): void {
    const { ctx } = this;

    /*
     * A dark plate under the card, then the tinted wash over it.
     *
     * The wash alone was enough while the room was near-black. Against a
     * rendered interior — lit shelving, a bright wall — an additive card has
     * nothing to sit on and the numbers wash straight out. The dark backing is
     * drawn first so the card carries its own contrast wherever it floats, and
     * additive blending turns it into a *dimming* rather than a black
     * rectangle, so it still reads as projected light.
     */
    ctx.fillStyle = 'rgba(7,9,25,0.76)';
    this.roundRect(pad, pad, w - pad * 2, h - pad * 2, r);
    ctx.fill();

    const wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, tone.hue + '0.20)');
    wash.addColorStop(0.32, 'rgba(95,81,173,0.08)');
    wash.addColorStop(1, tone.hue + '0.035)');
    ctx.fillStyle = wash;
    this.roundRect(pad, pad, w - pad * 2, h - pad * 2, r);
    ctx.fill();

    ctx.strokeStyle = tone.hue + '0.50)';
    ctx.lineWidth = Math.max(2, h * 0.012);
    this.roundRect(pad, pad, w - pad * 2, h - pad * 2, r);
    ctx.stroke();
    // Fine upper reflection and a restrained interference pattern belong to
    // the plate, beneath the ink, so the words retain their full contrast.
    ctx.save();
    this.roundRect(pad, pad, w - pad * 2, h - pad * 2, r);
    ctx.clip();
    ctx.strokeStyle = 'rgba(190,219,255,0.035)';
    ctx.lineWidth = 1;
    for (let y = pad + 4; y < h - pad; y += 5) {
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }
    const glint = ctx.createLinearGradient(pad, 0, w - pad, 0);
    glint.addColorStop(0, 'rgba(175,220,255,0)');
    glint.addColorStop(0.3, 'rgba(203,230,255,0.65)');
    glint.addColorStop(1, 'rgba(155,171,255,0)');
    ctx.fillStyle = glint;
    ctx.fillRect(pad + r, pad, w - pad * 2 - r * 2, Math.max(1, h * 0.006));
    ctx.restore();

  }

  /** Corner brackets — the cue that says instrument, not poster. */
  private brackets(tone: CardTone, w: number, h: number, pad: number): void {
    const { ctx } = this;
    ctx.strokeStyle = tone.accent;
    ctx.lineWidth = Math.max(3, h * 0.02);
    const b = Math.min(w, h) * 0.11;
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const x = sx > 0 ? pad : w - pad;
      const y = sy > 0 ? pad : h - pad;
      ctx.beginPath();
      ctx.moveTo(x + sx * b, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * b);
      ctx.stroke();
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Draws one line, cut to fit.
   *
   * The note is generated from metric labels, so its length is not knowable
   * when the card is sized — and canvas `fillText` does not clip, it just keeps
   * drawing past the edge of the texture and out of the card.
   */
  /**
   * Draws text at the largest size that fits, ellipsising only as a last resort.
   *
   * Ellipsising a *label* destroys it — "Abdominal profile" became "A…", which
   * names nothing. The card is fixed-size and the labels grew when the body
   * metrics arrived, so the type gives way before the words do: shrink within a
   * floor first, and cut only if even the floor cannot hold it.
   *
   * `font` carries everything but the pixel size, which this substitutes.
   */
  private fitText(
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    font: (px: number) => string,
    basePx: number,
    minPx: number,
  ): void {
    const { ctx } = this;
    let px = basePx;
    ctx.font = font(Math.round(px));
    while (px > minPx && ctx.measureText(text).width > maxWidth) {
      px -= 1;
      ctx.font = font(Math.round(px));
    }
    this.ellipsize(text, x, y, maxWidth);
  }

  private ellipsize(text: string, x: number, y: number, maxWidth: number): void {
    const { ctx } = this;
    if (ctx.measureText(text).width <= maxWidth) {
      ctx.fillText(text, x, y);
      return;
    }
    let cut = text;
    while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) {
      cut = cut.slice(0, -1);
    }
    ctx.fillText(cut.trimEnd() + '…', x, y);
  }

  /**
   * Wraps to at most `maxLines`, cutting the last one to fit.
   *
   * The limit is the whole point. Without it the text decides how tall the
   * block is, and a card is a fixed size — so whatever was under the block got
   * written over by it.
   */
  private wrap(
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines = 99,
  ): void {
    const { ctx } = this;
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      const last = i === maxLines - 1 && lines.length > maxLines;
      const cursor = y + i * lineHeight;
      if (last) this.ellipsize(`${lines[i]} ${lines[maxLines]}`, x, cursor, maxWidth);
      else ctx.fillText(lines[i], x, cursor);
    }
  }

  setReveal(target: number): void {
    this.revealTarget = Math.min(1, Math.max(0, target));
  }

  /**
   * Places the card and turns it to face the viewer.
   *
   * Billboarded about Y only. Fully facing the camera makes a floating panel
   * read as a sprite pasted on the lens; keeping it upright and only turning it
   * horizontally keeps it in the room.
   */
  place(position: THREE.Vector3, faceTowards: THREE.Vector3): void {
    this.mesh.position.copy(position);
    this.mesh.rotation.set(0, Math.atan2(faceTowards.x - position.x, faceTowards.z - position.z), 0);
  }

  update(dt: number, elapsed: number, presence: number, index = 0, glitch = 0): void {
    const rate = this.revealTarget > this.reveal ? 4.2 : 6;
    this.reveal += (this.revealTarget - this.reveal) * Math.min(1, rate * dt);

    // A slow independent drift per card, so a bank of them never reads as one
    // rigid object bolted together.
    const bob = Math.sin(elapsed * 0.55 + index * 1.7) * 0.006;
    this.mesh.position.y += bob - (this.lastBob ?? 0);
    this.lastBob = bob;

    // Nearly steady. These are the text she reads from — a panel breathing
    // seven percent made every card feel about to fail, and made the real
    // glitches invisible. The instability arrives through `glitch` instead,
    // the rig's shared corruption, so the panels dip only when everything
    // else corrupts with them.
    const flicker = 0.985 + Math.sin(elapsed * 5.3 + index) * 0.015 - glitch * 0.1;
    this.material.opacity = this.reveal * presence * flicker;
    this.mesh.visible = this.material.opacity > 0.01;
    this.frame.material.opacity = this.material.opacity * 0.52;
    this.frame.renderOrder = this.mesh.renderOrder;
  }

  private lastBob: number | null = null;

  dispose(): void {
    awaitingFont.delete(this);
    this.frame.geometry.dispose();
    this.frame.material.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
