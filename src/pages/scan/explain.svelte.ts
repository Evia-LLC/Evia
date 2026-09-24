/**
 * Detailed or Gen-Z: which register the Scan page's cards speak in, and her
 * explanation style.
 *
 * The toggle switches the cards' copy on the page at once (client-side copy
 * tables in src/view/scan.ts), and makes the choice the user's explanation
 * style - the preference her chat and spoken explanations read - through the
 * controller. The page never writes the preference itself:
 *
 * - When the controller has a quiet `setExplanationStyle` (requested from the
 *   lead), that is used.
 * - Until then, it asks her, through the controller's own chat path, the way
 *   the old Scan page's "detailed" / "Gen-Z" links did: "Give me the Gen-Z
 *   version." The server recognises the request and stores it as the
 *   account's explanation style (server/ai/orchestrator.ts, step 6), and her
 *   reply - in the new register - lands in the reading dock. A choice settles
 *   for a moment before it is sent, and the same choice is never sent twice,
 *   so flicking the toggle back and forth does not fill the conversation.
 *
 * Guests have nothing stored (and the local engine keeps no preference), and
 * sample mode never writes anything anywhere: for both the toggle switches
 * the cards only.
 */
import type { ExplanationStyle } from '@shared/types.ts';
import * as controller from '@/state/controller.ts';
import { sample } from '@/sample/mode.svelte.ts';
import { session } from '@/state/session.svelte.ts';
import type { ExplainStyle } from '@/view/scan.ts';

/** The controller seam, looked up at call time so the page wires itself up once it exists. */
type SetStyle = (style: ExplanationStyle) => Promise<void> | void;

function controllerSetter(): SetStyle | null {
  const fn: unknown = Reflect.get(controller, 'setExplanationStyle');
  return typeof fn === 'function' ? (fn as SetStyle) : null;
}

/** What she is asked, when there is no quiet setter (the server's set_preference intent). */
export const ASK_FOR_STYLE: Record<ExplainStyle, string> = {
  detailed: 'Give me the detailed version.',
  genz: 'Give me the Gen-Z version.',
};

/** How long a choice settles before it is sent. */
const SETTLE_MS = 700;

/** The register a stored preference maps to on the cards. */
export function styleFromPreference(pref: ExplanationStyle | undefined): ExplainStyle {
  return pref === 'genz' ? 'genz' : 'detailed';
}

export const explain = $state<{ style: ExplainStyle }>({
  style: styleFromPreference(session.user?.preferences.explanationStyle),
});

/**
 * What this visit's account asked for through the chat path. The stored
 * preference on the client only refreshes on the next sign-in, so this is what
 * the page trusts meanwhile. Module memory only, keyed to the account.
 */
let asked: { user: string; style: ExplainStyle } | null = null;
let settle: ReturnType<typeof setTimeout> | null = null;

/** Re-reads the user's style (on arrival; sample mode starts on the mockup's "Detailed"). */
export function syncExplainStyle(): void {
  if (sample.on) {
    explain.style = 'detailed';
    return;
  }
  const id = session.user?.id;
  explain.style = asked && asked.user === id ? asked.style : styleFromPreference(session.user?.preferences.explanationStyle);
}

/** The toggle was moved. */
export function chooseExplainStyle(style: ExplainStyle): void {
  explain.style = style;
  if (sample.on) return;
  const user = session.user;
  if (!user || session.guest) return;

  const set = controllerSetter();
  if (set) {
    void Promise.resolve(set(style)).catch(() => {});
    return;
  }

  if (settle) clearTimeout(settle);
  settle = setTimeout(() => {
    settle = null;
    // Still the same account, still not in sample mode, and still this choice.
    if (sample.on || session.guest || session.user?.id !== user.id || explain.style !== style) return;
    // Nothing to ask when this is already the account's style ("adaptive" still asks for "detailed").
    const stored: ExplanationStyle = asked && asked.user === user.id ? asked.style : user.preferences.explanationStyle;
    if (stored === style) return;
    asked = { user: user.id, style };
    void controller.sendMessage(ASK_FOR_STYLE[style]);
  }, SETTLE_MS);
}
