/**
 * The one icon set.
 *
 * Hand-drawn in the lucide idiom the mockups use: a 24-unit grid, a 1.6
 * stroke, round caps and joins, outline by default. Each glyph is the inner
 * markup of an <svg viewBox="0 0 24 24">, drawn by `Icon.svelte`; the handful
 * that the mockups show solid (play, pause, stop, the chat bubbles on the
 * CTA) are marked `solid` and fill with the current colour instead.
 *
 * Kept as data rather than one component per glyph so the set can be listed
 * (the preview page does) and so a page never ships an icon the set lacks.
 */

interface Glyph {
  /** Inner SVG markup, drawn with stroke="currentColor". */
  d: string;
  /** Drawn filled (fill="currentColor", no stroke) unless the caller says otherwise. */
  solid?: boolean;
}

const g = (d: string, solid = false): Glyph => ({ d, solid });

export const GLYPHS = {
  // Navigation (sidebar order).
  house: g(
    '<path d="M15 21v-7.5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1V21"/><path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  ),
  camera: g(
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.2"/><path d="M18.2 9.8h.01"/>',
  ),
  'clipboard-list': g(
    '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8.5 12h7"/><path d="M8.5 16h7"/>',
  ),
  'bar-chart': g(
    '<rect x="3.5" y="13" width="4.2" height="7.5" rx="1.3"/><rect x="9.9" y="8.5" width="4.2" height="12" rx="1.3"/><rect x="16.3" y="3.5" width="4.2" height="17" rx="1.3"/>',
  ),
  'shopping-bag': g('<rect x="3.8" y="8" width="16.4" height="13" rx="2.6"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/>'),
  'book-open': g(
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  ),
  settings: g(
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  ),

  // Header and chrome.
  bell: g(
    '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>',
  ),
  user: g('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  menu: g('<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>'),
  more: g('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', true),
  grid: g(
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/>',
  ),
  search: g('<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>'),
  x: g('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  sliders: g(
    '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  ),

  // Direction.
  'chevron-left': g('<path d="m15 18-6-6 6-6"/>'),
  'chevron-right': g('<path d="m9 18 6-6-6-6"/>'),
  'chevron-down': g('<path d="m6 9 6 6 6-6"/>'),
  'chevron-up': g('<path d="m18 15-6-6-6 6"/>'),
  'arrow-right': g('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
  'arrow-up-right': g('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>'),
  'external-link': g(
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  ),
  expand: g(
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  ),

  // Media.
  play: g('<path d="M7 4.6v14.8a1.2 1.2 0 0 0 1.8 1.03l12.2-7.4a1.2 1.2 0 0 0 0-2.06L8.8 3.57A1.2 1.2 0 0 0 7 4.6z"/>', true),
  pause: g('<rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/>', true),
  /** Stopping her mid-line (solid, like play and pause). */
  stop: g('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>', true),

  // Voice (the conversation's microphone and her voice switch).
  mic: g('<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v4"/>'),
  'voice-on': g(
    '<path d="M4 9.5h3l4.5-4v13L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.4 6.2a8.2 8.2 0 0 1 0 11.6"/>',
  ),
  'voice-off': g(
    '<path d="M4 9.5h3l4.5-4v13L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>',
  ),

  // Time of day and dates.
  sun: g(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  ),
  moon: g('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  calendar: g(
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M12 18.2c-1.6-1-2.4-1.9-2.4-2.9a1.2 1.2 0 0 1 2.4-.4 1.2 1.2 0 0 1 2.4.4c0 1-.8 1.9-2.4 2.9z"/>',
  ),

  // State.
  check: g('<path d="M20 6 9 17l-5-5"/>'),
  'circle-check': g('<circle cx="12" cy="12" r="9.5"/><path d="m8.5 12.2 2.4 2.4 4.8-5"/>'),
  lock: g('<rect x="4" y="11" width="16" height="10.5" rx="2.2"/><path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11"/>'),
  info: g('<circle cx="12" cy="12" r="9.5"/><path d="M12 16.5v-5"/><path d="M12 7.8h.01"/>'),
  plus: g('<path d="M5 12h14"/><path d="M12 5v14"/>'),

  // Content.
  heart: g(
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  ),
  star: g(
    '<path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.91l5.16-.75a2.12 2.12 0 0 0 1.6-1.16z"/>',
  ),
  sparkle: g(
    '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  ),
  droplet: g(
    '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  ),
  shield: g(
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  ),
  lightbulb: g(
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  ),
  'message-circle': g('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
  /** The CTA's double speech bubble (drawn solid on the Home button). */
  messages: g(
    '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  ),

  // Ordering.
  grip: g(
    '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  ),
  reorder: g('<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>'),
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];
