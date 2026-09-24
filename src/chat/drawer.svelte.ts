/**
 * Whether the conversation is open, and whether she has said something that
 * has not been seen yet.
 *
 * The conversation lives in one drawer (ChatDrawer.svelte, mounted once by
 * the Shell), so Home's "Talk to Evia", the sidebar's Talk card and anything
 * else can open it without owning it. Opening from outside Home goes through
 * `requestTalk` in shell/talk.svelte.ts, which walks home first; the drawer
 * takes that request itself.
 *
 * "Unseen" is her newest line arriving while the drawer is closed - her
 * arrival greeting, typically, which her voice may already be saying. It is
 * judged against the moment this visit started, so a transcript loaded from
 * the server does not count as new.
 *
 * What the conversation shows is `shownMessages()`: everything, except in
 * sample mode, where an account's stored transcript stays out of the designed
 * sample (see transcript.ts).
 */
import type { ChatMessage } from '@shared/types.ts';
import { session } from '@/state/session.svelte.ts';
import { sample } from '@/sample/mode.svelte.ts';
import { visibleMessages } from './transcript.ts';

export const chat = $state({
  open: false,
  /** The id of her newest line when the drawer was last open (or at load). */
  seenId: null as string | null,
});

/** When this visit began; lines older than this are history, not news. */
const visitStart = Date.now() - 5_000;

/*
 * When sample mode came on: the start of the visit if it was on at boot
 * (?sample=1, or remembered), the moment it was switched on otherwise
 * (Settings). Watched from here because the drawer is mounted once and lives
 * as long as the app does.
 */
const scope = $state({ sampleSince: visitStart });
let sampleWas = sample.on;
$effect.root(() => {
  $effect(() => {
    const on = sample.on;
    if (on && !sampleWas) scope.sampleSince = Date.now() - 1_000;
    sampleWas = on;
  });
});

/** The lines the conversation shows (all of them, outside sample mode). */
export function shownMessages(): readonly ChatMessage[] {
  return visibleMessages(session.messages, {
    sampleOn: sample.on,
    guest: session.guest,
    sampleSince: scope.sampleSince,
  });
}

/** Where focus goes back to when the drawer closes. */
let opener: HTMLElement | null = null;

/*
 * Where focus goes when the opener has gone: the sidebar's Talk card walks
 * home and is not drawn there, so its button no longer exists when the
 * drawer closes. Home registers its own "Talk to Evia" button for that.
 */
let home: HTMLElement | null = null;

export function setChatHome(el: HTMLElement | null): void {
  home = el;
}

export function openChat(from?: HTMLElement | null): void {
  if (chat.open) return;
  opener = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  chat.open = true;
}

export function closeChat(): void {
  if (!chat.open) return;
  chat.open = false;
  const target = opener;
  opener = null;
  // After the close has been drawn, so focus does not land in the drawer; to
  // the first candidate that can actually take it (the opener can still be
  // in the page but hidden, or on its way out).
  queueMicrotask(() => {
    for (const el of [target, home, document.getElementById('main')]) {
      if (!el?.isConnected || el.getClientRects().length === 0 || el.closest('[inert]')) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
  });
}

/** Marks everything she has said so far as seen (called while the drawer is open). */
export function markSeen(): void {
  const shown = shownMessages();
  const last = shown[shown.length - 1];
  chat.seenId = last?.id ?? null;
}

/** She has said something since the drawer was last open, during this visit. */
export function hasUnseen(): boolean {
  if (chat.open) return false;
  const shown = shownMessages();
  const last = shown[shown.length - 1];
  if (!last || last.role !== 'elohim' || last.id === chat.seenId) return false;
  const at = Date.parse(last.createdAt);
  return Number.isFinite(at) && at >= visitStart;
}
