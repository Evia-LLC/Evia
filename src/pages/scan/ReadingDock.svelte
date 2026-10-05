<!--
  Her words, and the ways forward, after a real reading (not in the mockup,
  which has no data behind it to act on; sample mode does not show it).

  Kept from the old result dock, restyled to the room's glass:
  - her latest line, typed out as she says it (lib/reveal.ts), or "Thinking";
  - a rejected capture's reason, when there is one;
  - What to do about it (her plan, on the Routine page), Scan again, Talk it
    through, Against the last one;
  - the progress-photo choice, shown only with approved consent (CNS-04: off
    by default; nothing is saved without it) - otherwise it says nothing was
    saved, links to the consent, and offers to discard the photo now.

  No composite "skin health" score and no confidence ring: the reading is the
  observations on the hologram and the cards.

  From main (Section 1): which analysis a face reading came from - Perfect
  Corp, or the local reading as the selected or backup analysis, with the
  reason ("using backup analysis - ...") - and, for a Perfect Corp reading,
  its mapping disclosure. Shown as a quiet status line above her words.

  While the consult tour plays (`quiet`) her words are left out, so their live
  region cannot talk over the tour; the provider line, any error, the actions
  and the photo choice (Discard included) stay where they are.
-->
<script lang="ts" module>
  /*
   * Which of her lines has been typed out already. Module-scoped because the
   * page remounts on every visit: a line animates once, on the visit it was
   * said, and renders whole after that.
   */
  let lastRevealedId: string | null = null;
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import Button from '@/ui/Button.svelte';
  import { session } from '@/state/session.svelte.ts';
  import { discardPendingCapture, saveProgressPhoto, startScanFlow } from '@/state/controller.ts';
  import { revealLine, type RevealTicker } from '@/lib/reveal.ts';
  import { approvedConsent } from '@shared/legal-content.ts';
  import { CONSENT_KEYS } from '@shared/consent-keys.ts';

  interface Props {
    class?: string;
    /**
     * Button size: the desk's slimmer mouse buttons ('sm'), or full 44 px
     * targets in the touch compositions (tablet, phone).
     */
    size?: 'sm' | 'md';
    /**
     * While the consult tour plays: her reply line (and its live region) is left out, so it cannot
     * talk over the tour; which analysis the reading came from, errors and the actions stay.
     */
    quiet?: boolean;
  }

  const { class: className = '', size = 'sm', quiet = false }: Props = $props();

  const lastWord = $derived.by(() => {
    const last = session.messages[session.messages.length - 1];
    return last?.role === 'elohim' ? last : null;
  });

  let shownChars = $state(0);
  let ticker: RevealTicker | null = null;
  $effect(() => {
    const id = lastWord?.id;
    const text = lastWord?.content ?? '';
    if (!id) return;
    if (id === lastRevealedId) {
      shownChars = text.length;
      return;
    }
    lastRevealedId = id;
    ticker?.stop();
    shownChars = 0;
    ticker = revealLine(text, (n) => (shownChars = n));
  });
  onDestroy(() => ticker?.stop());
  const shownWords = $derived(lastWord ? lastWord.content.slice(0, shownChars) : '');
  const stillTyping = $derived(lastWord ? shownChars < lastWord.content.length : false);

  let saveSelected = $state(false);
  let saveBusy = $state(false);
  let saveMessage = $state<string | null>(null);

  async function savePhoto() {
    if (!saveSelected) return;
    saveBusy = true;
    try {
      await saveProgressPhoto();
      saveMessage = 'Progress photo saved.';
      saveSelected = false;
    } catch (error) {
      saveMessage = error instanceof Error ? error.message : 'The photo could not be saved.';
    } finally {
      saveBusy = false;
    }
  }

  const scan = $derived(session.latestScan);

  const hasPlan = $derived(!!session.plan?.suggestions.length && session.scanKind === 'face');
  const canSave = $derived(session.scanKind === 'face' && session.pendingCapture?.state === 'save-available');
  const photosApproved = $derived(approvedConsent(session.user?.consents[CONSENT_KEYS.PROGRESS_PHOTOS]));
</script>

<section class="dock on-holo {className}" aria-label="What Evia says about this reading">
  {#if session.scanKind === 'face' && scan}
    <div class="dock__provider">
      <p role="status">{session.analysisNotice || (scan?.modelVersion === 'perfectcorp-v2.1' ? 'Perfect Corp analysis' : 'Local analysis')}</p>
      {#if scan?.modelVersion === 'perfectcorp-v2.1'}<p class="dock__provider-note">{scan.notes}</p>{/if}
    </div>
  {/if}
  {#if !quiet}
    <p class="dock__words" aria-live="polite">
      {#if session.thinking}
        <span class="dock__thinking">Thinking</span>
      {:else if lastWord}
        {shownWords}{#if stillTyping}<span class="dock__caret" aria-hidden="true"></span>{/if}
      {:else}
        Ask me about any part of this reading, and I will explain it.
      {/if}
    </p>
  {/if}

  {#if session.chatError}
    <p class="dock__error" role="alert">{session.chatError}</p>
  {/if}

  <div class="dock__actions">
    {#if hasPlan}
      <Button href="/routine" {size} iconEnd="arrow-right">What to do about it</Button>
    {/if}
    <Button variant={hasPlan ? 'secondary' : 'primary'} tone={hasPlan ? 'dark' : 'light'} {size} onclick={() => startScanFlow(session.scanKind)}>
      Scan again
    </Button>
    <Button variant="ghost" tone="dark" {size} href="/">Talk it through</Button>
    <Button variant="ghost" tone="dark" {size} href="/progress">Against the last one</Button>
  </div>

  {#if canSave}
    <div class="dock__save">
      {#if photosApproved}
        <label class="dock__check">
          <input type="checkbox" bind:checked={saveSelected} />
          Save this as a progress photo
        </label>
        <div class="dock__save-actions">
          <Button {size} variant="secondary" tone="dark" disabled={!saveSelected || saveBusy} onclick={savePhoto}>
            {saveBusy ? 'Saving…' : 'Save photo'}
          </Button>
          <Button {size} variant="ghost" tone="dark" onclick={discardPendingCapture}>Discard photo</Button>
        </div>
      {:else}
        <p class="dock__note">Progress-photo consent is off. Nothing has been saved.</p>
        <div class="dock__save-actions">
          <Button {size} variant="ghost" tone="dark" href="/privacy">Review progress-photo consent</Button>
          <Button {size} variant="ghost" tone="dark" onclick={discardPendingCapture}>Discard photo</Button>
        </div>
      {/if}
    </div>
  {:else if saveMessage}
    <p class="dock__note" aria-live="polite">{saveMessage}</p>
  {/if}
</section>

<style>
  .dock {
    display: grid;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 14px;
    background: rgba(8, 13, 24, 0.8);
    box-shadow:
      inset 0 0 0 1px rgba(150, 170, 210, 0.28),
      0 12px 30px rgba(0, 0, 0, 0.35);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    color: var(--holo-ink-body);
  }
  /* Which analysis this is: an eyebrow-weight line above her words. */
  .dock__provider {
    display: grid;
    gap: 2px;
  }
  .dock__provider p {
    margin: 0;
    font-size: var(--fs-meta);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.02em;
    line-height: 1.4;
    color: var(--holo-ink-muted);
  }
  .dock__provider .dock__provider-note {
    font-weight: var(--fw-regular);
    letter-spacing: 0;
  }
  .dock__words {
    margin: 0;
    max-width: 62ch;
    font-size: 15px;
    line-height: 1.5;
    color: #e2eaf8;
  }
  .dock__thinking {
    font-size: var(--fs-micro);
    font-weight: var(--fw-semibold);
    letter-spacing: var(--tr-caps);
    text-transform: uppercase;
    color: var(--holo-ink-muted);
  }
  .dock__caret {
    display: inline-block;
    width: 1px;
    height: 0.95em;
    margin-left: 3px;
    vertical-align: -0.15em;
    background: var(--holo-cyan);
    animation: caret-blink 1.06s steps(1, end) infinite;
  }
  .dock__error {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    color: #f4c3cc;
  }
  .dock__actions,
  .dock__save-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }
  .dock__save {
    display: grid;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid rgba(160, 180, 220, 0.16);
  }
  .dock__check {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-size: 14px;
    color: #dfe7f7;
  }
  .dock__check input {
    width: 18px;
    height: 18px;
    accent-color: var(--holo-rose);
  }
  .dock__note {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    color: var(--holo-ink-body);
  }
  @keyframes caret-blink {
    50% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dock__caret {
      animation: none;
    }
  }
</style>
