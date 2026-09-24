<!--
  The entry screen: the lounge behind a dark rose-brown glass card.

  This is the only screen a stranger ever sees, so it is the room they will
  be in (the Home plate, or its CSS stand-in until the render lands), with no
  character in it (BUILD-PLAN decision 3): the empty chair side of the room
  stays in view to the right of the card on a desktop, and above it on a
  phone, where the card rises over the room as a sheet.

  Nothing on this screen is decorative. There is no third-party sign-in, no
  password reset, no counts and no logos, because none of that exists on the
  server - the only two calls that exist are `signIn` and `register` (brief
  section 33). The demo and local-engine notes are honesty disclosures and sit
  *above* the form deliberately: below the fold on a phone is the same thing
  as hidden. The demo credentials are on the button that fills them, so the
  disclosure and the shortcut are one object.

  The ways in: sign in, create an account, look around as a guest (nothing
  saved), or preview every screen with the design's sample data (the same
  guest visit, with the "Sample data" badge on screen throughout). The legal
  links go to the placeholder drafts, which signing in does not accept.
-->
<script lang="ts">
  import { cubicOut, expoOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { register, signIn, enterGuestMode, enterSamplePreview } from '@/state/controller.ts';
  import { session } from '@/state/session.svelte.ts';
  import { link } from '@/router/router.svelte.ts';
  import Room from '@/stage/Room.svelte';
  import Logo from '@/shell/Logo.svelte';
  import AiDisclosure from '@/shell/AiDisclosure.svelte';
  import SegmentedTabs from '@/ui/SegmentedTabs.svelte';
  import Icon from '@/ui/Icon.svelte';

  let mode = $state<'login' | 'register'>('login');
  let email = $state('');
  let password = $state('');
  let displayName = $state('');
  let showPassword = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  /**
   * Set the moment auth succeeds. The gate is about to be removed and its
   * dissolve takes half a second, during which it is still a full-screen layer
   * over an interface that is already live underneath it.
   */
  let leaving = $state(false);

  const cta = $derived(busy ? 'One moment' : mode === 'login' ? 'Sign in' : 'Create account');
  const closed = $derived(!session.serverReachable || !session.databaseAvailable);
  const hasNotes = $derived(session.demoMode || !session.modelAvailable);

  const MODES = [
    { id: 'login', label: 'Sign in' },
    { id: 'register', label: 'Create account' },
  ];

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      if (mode === 'login') await signIn(email, password);
      else await register(email, password, displayName);
      leaving = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'That did not work.';
    } finally {
      busy = false;
    }
  }

  function useDemo() {
    email = 'demo@elohim.local';
    password = 'demo1234';
    mode = 'login';
  }

  function setMode(next: string) {
    // A stale "wrong password" hanging over a form you have just retitled reads
    // as an error about the new form.
    error = null;
    mode = next === 'register' ? 'register' : 'login';
  }

  function onPassword(event: Event) {
    password = (event.currentTarget as HTMLInputElement).value;
  }

  /**
   * Svelte's transitions are JavaScript animations, so the reduced-motion block
   * in the stylesheet cannot reach them - the three below have to ask for
   * themselves. Asked at the moment each one starts rather than read once, so
   * changing the system setting takes effect without a reload.
   */
  function stillness(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Height and fade in one pass, for the field the register mode adds (and
   * the error line). Opacity trails the height so the field lands rather than
   * smears.
   */
  function makeRoom(node: Element, { duration = 400 }: { duration?: number } = {}) {
    const style = getComputedStyle(node);
    const height = parseFloat(style.height);
    const marginBottom = parseFloat(style.marginBottom);
    return {
      duration: stillness() ? 0 : duration,
      easing: expoOut,
      css: (t: number, u: number) =>
        `overflow:hidden;` +
        `height:${(t * height).toFixed(2)}px;` +
        `margin-bottom:${(t * marginBottom).toFixed(2)}px;` +
        `opacity:${Math.max(0, t * 1.45 - 0.45).toFixed(3)};` +
        `transform:translateY(${(u * -10).toFixed(2)}px)`,
    };
  }

  /** The gate does not vanish, it lifts off the room behind it. */
  function dissolve(_node: Element) {
    return {
      duration: stillness() ? 0 : 520,
      easing: cubicOut,
      css: (t: number, u: number) => `opacity:${t};transform:scale(${(1 + u * 0.014).toFixed(4)})`,
    };
  }
</script>

<div class="ev-gate" class:is-leaving={leaving} out:dissolve>
  <div class="ev-gate__room" aria-hidden="true">
    <Room room="lounge" />
  </div>
  <div class="ev-gate__scrim" aria-hidden="true"></div>

  <div class="ev-gate__scroll">
    <div class="ev-gate__air" aria-hidden="true"></div>

    <main class="ev-gate__card on-dark" class:has-notes={hasNotes} aria-labelledby="gate-title">
      <div class="ev-gate__head">
        <Logo />

        <div class="ev-gate__pitch">
          <h1 class="ev-gate__title" id="gate-title">Welcome to Evia</h1>
          <p class="ev-gate__lede">
            An AI skincare consultant. Ask anything, scan your skin with your own camera, and see what changes over
            time.
          </p>
        </div>
      </div>

      {#if hasNotes}
        <ul class="ev-gate__notes" role="list">
          {#if session.demoMode}
            <li class="ev-gate__note">
              <span class="ev-gate__tag">Demo mode</span>
              <span class="ev-gate__note-body">This server is seeded with a demo account and six scans of history.</span>
              <button type="button" class="ev-gate__demo" onclick={useDemo}>
                <span class="ev-gate__demo-label">Use the demo account</span>
                <code>demo@elohim.local</code>
                <code>demo1234</code>
              </button>
            </li>
          {/if}
          {#if !session.modelAvailable}
            <li class="ev-gate__note">
              <span class="ev-gate__tag">Local engine</span>
              <span class="ev-gate__note-body">
                Conversation runs on Evia's built-in engine rather than the full model. Your scans, storage and trends are
                real either way.
              </span>
            </li>
          {/if}
        </ul>
      {/if}

      <form class="ev-gate__form" onsubmit={submit}>
        <SegmentedTabs
          options={MODES}
          value={mode}
          label="Sign in or create an account"
          tone="glass"
          full
          onchange={setMode}
        />

        {#if mode === 'register'}
          <div class="ev-gate__field" transition:makeRoom>
            <label class="ev-gate__label" for="auth-name">What should Evia call you?</label>
            <input
              id="auth-name"
              class="ev-gate__input"
              bind:value={displayName}
              autocomplete="given-name"
              placeholder="Ada"
            />
          </div>
        {/if}

        <div class="ev-gate__field">
          <label class="ev-gate__label" for="auth-email">Email</label>
          <input
            id="auth-email"
            class="ev-gate__input"
            type="email"
            bind:value={email}
            autocomplete="email"
            required
          />
        </div>

        <div class="ev-gate__field">
          <label class="ev-gate__label" for="auth-password">Password</label>
          <!-- Not `bind:value`: a two-way binding forbids a dynamic `type`, and
               toggling the attribute on the same element is what keeps the
               caret and the focus where they were. -->
          <div class="ev-gate__pw">
            <input
              id="auth-password"
              class="ev-gate__input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              oninput={onPassword}
              autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
              minlength="8"
              required
            />
            <button
              type="button"
              class="ev-gate__peek"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onclick={() => (showPassword = !showPassword)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {#if mode === 'register'}
          <!-- Planning boundary only. A later approved flow can mount decisions
               here after credentials; creating an account does not accept them. -->
          <div class="ev-gate__legal-step" data-future-legal-step>
            <span class="ev-gate__tag">Legal review step (not active)</span>
            <span class="ev-gate__note-body">No agreement is collected on this screen.</span>
          </div>
        {/if}

        {#if error}
          <div class="ev-gate__error" role="alert" transition:makeRoom={{ duration: 320 }}>{error}</div>
        {/if}

        <!-- Offline is its own state, not an error the form should discover:
             said up front, with the form shut. -->
        {#if !session.serverReachable}
          <div class="ev-gate__note ev-gate__note--closed" role="status">
            <span class="ev-gate__tag">Offline</span>
            <span class="ev-gate__note-body">
              This build has no server attached, so sign-in is off. Everything you can see here runs on your device.
            </span>
          </div>
        {:else if !session.databaseAvailable}
          <div class="ev-gate__note ev-gate__note--closed" role="status">
            <span class="ev-gate__tag">No database</span>
            <span class="ev-gate__note-body">
              This deployment has nowhere to keep an account yet, so sign-in is off. The camera, the scan and the readouts
              all run on your device. Look around.
            </span>
          </div>
        {/if}

        <button class="ev-gate__cta" type="submit" disabled={busy || closed} data-busy={busy}>
          <span class="ev-gate__cta-label">
            <!-- The two labels overlap rather than queue, so the button is never
                 blank between them. -->
            {#key cta}
              <span
                in:fly={{ y: 6, duration: stillness() ? 0 : 260, easing: expoOut }}
                out:fly={{ y: -6, duration: stillness() ? 0 : 200, easing: cubicOut }}>{cta}</span
              >
            {/key}
          </span>
        </button>
      </form>

      <div class="ev-gate__alt">
        <p class="ev-gate__or"><span>or</span></p>

        <div class="ev-gate__ways">
          <!-- The way in without an account. What it costs is said on the
               button rather than discovered afterwards. -->
          <button type="button" class="ev-gate__way" onclick={enterGuestMode}>
            <span class="ev-gate__way-text">
              <span class="ev-gate__way-title">Look around without an account</span>
              <span class="ev-gate__way-sub">
                {#if session.guestVoice}
                  Evia talks in its own voice, scans and reads. Nothing is saved when you leave.
                {:else}
                  Evia talks, scans and reads. Nothing is saved when you leave.
                {/if}
              </span>
            </span>
            <Icon name="chevron-right" size={20} stroke={1.7} />
          </button>

          <!-- Every screen as designed, with the mockups' own sample data and a
               "Sample data" badge on screen the whole time. Same guest visit as
               above: nothing is saved. -->
          <button type="button" class="ev-gate__way" onclick={enterSamplePreview}>
            <span class="ev-gate__way-text">
              <span class="ev-gate__way-title">Preview with sample data</span>
              <span class="ev-gate__way-sub">Every screen filled in with clearly labelled sample data.</span>
            </span>
            <Icon name="chevron-right" size={20} stroke={1.7} />
          </button>
        </div>

        <footer class="ev-gate__foot">
          <p class="ev-gate__promise">
            <Icon name="lock" size={16} stroke={1.8} />
            <span>Skin scans are analysed on your device. The photo never leaves it unless you say so.</span>
          </p>
          <p class="ev-gate__legal">
            Review the placeholder <a href="/legal/terms" use:link>Terms</a> and
            <a href="/legal/privacy" use:link>Privacy Policy</a>. These drafts are not accepted by signing in or creating
            an account.
          </p>
          <AiDisclosure tone="dark" backed={false} />
        </footer>
      </div>
    </main>
  </div>
</div>

<style>
  .ev-gate {
    position: fixed;
    inset: 0;
    z-index: var(--z-auth);
    overflow: hidden;
    isolation: isolate;
    background: var(--choc-600);
    color: var(--text-on-dark);
    font-family: var(--font-sans);
    font-size: var(--fs-body);
    line-height: var(--lh-normal);
  }
  .is-leaving {
    pointer-events: none;
  }

  .ev-gate__room {
    position: absolute;
    inset: 0;
    z-index: -2;
  }
  /* Weight on the card's side, so the glass sits on a calm patch of room and
     the chair side stays bright. */
  .ev-gate__scrim {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(90deg, rgba(31, 17, 12, 0.5) 0%, rgba(31, 17, 12, 0.22) 42%, rgba(31, 17, 12, 0) 70%);
    pointer-events: none;
  }

  .ev-gate__scroll {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: minmax(0, 500px) 1fr;
    align-items: center;
    padding: max(32px, var(--safe-t)) 24px max(32px, var(--safe-b)) clamp(24px, 6vw, 104px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .ev-gate__air {
    display: none;
  }

  .ev-gate__card {
    position: relative;
    display: grid;
    gap: 16px;
    padding: 28px 28px 22px;
    border-radius: var(--r-2xl);
    background: linear-gradient(135deg, var(--glass-dark-sheen) 0%, transparent 55%), var(--glass-dark-strong);
    box-shadow:
      inset 0 0 0 1px var(--glass-dark-rim),
      var(--shadow-lg);
    -webkit-backdrop-filter: blur(22px) saturate(1.1);
    backdrop-filter: blur(22px) saturate(1.1);
  }

  /* Two groups that are invisible in the one-column card (same 16px rhythm)
     and become the columns on a wide screen: see the end of the sheet. */
  .ev-gate__head,
  .ev-gate__alt {
    display: grid;
    gap: 16px;
    align-content: start;
  }

  .ev-gate__pitch {
    display: grid;
    gap: 8px;
  }
  .ev-gate__title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 34px;
    font-weight: var(--fw-regular);
    line-height: 1.1;
    letter-spacing: var(--tr-title);
    color: var(--text-on-dark-strong);
  }
  .ev-gate__lede {
    margin: 0;
    font-size: var(--fs-body);
    line-height: var(--lh-normal);
    color: var(--text-on-dark);
  }

  /* ---- honesty notes ---- */
  .ev-gate__notes {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
  }
  .ev-gate__note,
  .ev-gate__legal-step {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--tint-hover-dark);
    box-shadow: inset 0 0 0 1px var(--glass-dark-rim);
    list-style: none;
  }
  .ev-gate__tag {
    flex: none;
    font-size: var(--fs-micro);
    font-weight: var(--fw-semibold);
    letter-spacing: var(--tr-micro);
    text-transform: uppercase;
    color: var(--rose-gold-300);
  }
  .ev-gate__note-body {
    flex: 1 1 14rem;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-on-dark);
  }
  .ev-gate__demo {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    width: 100%;
    min-height: 44px;
    margin-top: 6px;
    padding: 8px 12px;
    border: 1px solid var(--border-on-dark-strong);
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text-on-dark-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .ev-gate__demo-label {
    margin-right: auto;
    font-weight: var(--fw-medium);
  }
  .ev-gate__demo code {
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-on-dark);
  }
  @media (hover: hover) {
    .ev-gate__demo:hover {
      background: var(--tint-hover-dark);
    }
  }
  .ev-gate__note--closed {
    background: rgba(230, 138, 49, 0.14);
  }

  /* ---- the form ---- */
  .ev-gate__form {
    display: grid;
    gap: 16px;
  }
  .ev-gate__field {
    display: grid;
    gap: 8px;
  }
  .ev-gate__label {
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-on-dark-strong);
  }
  .ev-gate__input {
    box-sizing: border-box;
    width: 100%;
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--border-on-dark-strong);
    border-radius: var(--r-md);
    background: rgba(31, 17, 12, 0.35);
    color: var(--text-on-dark-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-label);
    transition:
      border-color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out);
  }
  .ev-gate__input::placeholder {
    color: var(--text-on-dark-muted);
    opacity: 0.85;
  }
  .ev-gate__input:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: 1px;
    background: rgba(31, 17, 12, 0.5);
  }
  .ev-gate__pw {
    position: relative;
  }
  .ev-gate__pw .ev-gate__input {
    padding-right: 76px;
  }
  .ev-gate__peek {
    position: absolute;
    top: 2px;
    right: 2px;
    bottom: 2px;
    min-width: 64px;
    padding: 0 14px;
    border: 0;
    border-radius: calc(var(--r-md) - 2px);
    background: transparent;
    color: var(--text-on-dark-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    cursor: pointer;
  }
  .ev-gate__peek:focus-visible,
  .ev-gate__demo:focus-visible,
  .ev-gate__way:focus-visible,
  .ev-gate__cta:focus-visible,
  .ev-gate__legal a:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring-on-dark);
    outline-offset: var(--focus-offset);
  }
  @media (hover: hover) {
    .ev-gate__peek:hover {
      background: var(--tint-hover-dark);
    }
  }

  .ev-gate__error {
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: rgba(154, 47, 63, 0.35);
    box-shadow: inset 0 0 0 1px rgba(255, 190, 190, 0.45);
    color: var(--text-on-dark-strong);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
  }

  /* The CTA: the app's primary gradient pill, full width. */
  .ev-gate__cta {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 52px;
    padding: 0 22px;
    border: 0;
    border-radius: var(--r-pill);
    background: linear-gradient(90deg, var(--cta-from) 0%, var(--cta-mid) 50%, var(--cta-to) 100%);
    box-shadow:
      inset 0 0 0 1px var(--cta-rim),
      var(--shadow-cta);
    color: var(--cta-ink);
    font-family: var(--font-sans);
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    cursor: pointer;
    transition:
      filter var(--dur-base) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }
  .ev-gate__cta-label {
    display: grid;
  }
  .ev-gate__cta-label > :global(*) {
    grid-area: 1 / 1;
  }
  @media (hover: hover) {
    .ev-gate__cta:hover:not(:disabled) {
      filter: brightness(1.04);
      transform: translateY(-1px);
    }
  }
  .ev-gate__cta:active:not(:disabled) {
    transform: translateY(1px) scale(0.99);
  }
  .ev-gate__cta:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .ev-gate__cta[data-busy='true'] {
    cursor: progress;
  }

  .ev-gate__or {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: -4px 0;
    font-size: var(--fs-meta);
    color: var(--text-on-dark-muted);
  }
  .ev-gate__or::before,
  .ev-gate__or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--glass-dark-rim);
  }

  .ev-gate__ways {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .ev-gate__way {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    min-height: 56px;
    padding: 10px 14px 10px 16px;
    border: 1px solid var(--border-on-dark-strong);
    border-radius: var(--r-lg);
    background: transparent;
    color: var(--text-on-dark-strong);
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) {
    .ev-gate__way:hover {
      background: var(--tint-hover-dark);
    }
  }
  .ev-gate__way:active {
    background: var(--tint-press-dark);
  }
  .ev-gate__way-text {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .ev-gate__way-title {
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    line-height: 1.3;
  }
  .ev-gate__way :global(.icon) {
    flex: none;
    margin-top: 1px;
  }
  .ev-gate__way-sub {
    font-size: var(--fs-body-sm);
    color: var(--text-on-dark);
  }

  .ev-gate__foot {
    display: grid;
    gap: 10px;
    padding-top: 16px;
    border-top: 1px solid var(--glass-dark-rim);
  }
  .ev-gate__promise {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-on-dark);
  }
  .ev-gate__promise :global(.icon) {
    flex: none;
    margin-top: 2px;
    color: var(--rose-gold-300);
  }
  .ev-gate__legal {
    margin: 0;
    font-size: var(--fs-meta);
    line-height: var(--lh-normal);
    color: var(--text-on-dark-muted);
  }
  /* Inline links in small print still need a 44px target (decision 7). Inline
     padding grows the hit box without moving the line; the side padding is
     paid back in margin so the sentence keeps its spacing. */
  .ev-gate__legal a {
    padding: 15px 4px;
    margin: 0 -4px;
    color: var(--text-on-dark-strong);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }

  /* Tablet portrait and phones: the room shows above, the card rises over it
     as a sheet and scrolls; the chair side of the room stays in the window. */
  @media (max-width: 819px), (max-aspect-ratio: 4/5) {
    /* The room is drawn into the top of the screen only, so the crop keeps
       the window and the chair rather than the ceiling above them. */
    .ev-gate__room {
      bottom: auto;
      height: max(300px, 48vh);
      -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent);
      mask-image: linear-gradient(180deg, #000 70%, transparent);
    }
    .ev-gate__scrim {
      background: linear-gradient(180deg, rgba(31, 17, 12, 0) 0%, rgba(31, 17, 12, 0.25) 30%, rgba(31, 17, 12, 0.55) 60%);
    }
    .ev-gate__scroll {
      display: block;
      padding: 0 max(16px, var(--safe-r)) max(16px, var(--safe-b)) max(16px, var(--safe-l));
    }
    .ev-gate__air {
      display: block;
      height: max(160px, 30vh);
    }
    .ev-gate__card {
      max-width: 520px;
      margin: 0 auto;
      padding: 24px 20px 20px;
    }
    .ev-gate__title {
      font-size: 30px;
    }
  }
  @media (max-width: 479px) {
    .ev-gate__ways {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* Landscape screens from 1024px: one column of everything ran to about
     1,050px (1,085 with the demo and local-engine notes), past the fold of
     any laptop, so the ways in and the legal line were never seen. The card
     widens into two columns instead - the wordmark and the form on the left,
     the honesty notes and the other ways in on the right - and fits a
     1280x800 screen. It still ends short of the chair, and the reading and
     tab order is unchanged: brand, notes, form, then the other ways in. */
  @media (min-width: 1024px) and (min-aspect-ratio: 5/4) {
    .ev-gate__scroll {
      grid-template-columns: minmax(0, 780px) 1fr;
    }
    .ev-gate__card {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20px 32px;
      padding: 30px 32px 24px;
    }
    .ev-gate__head {
      grid-area: 1 / 1;
    }
    .ev-gate__notes {
      grid-area: 1 / 2;
    }
    .ev-gate__form {
      grid-area: 2 / 1;
      align-self: start;
    }
    .ev-gate__alt {
      grid-area: 2 / 2;
    }
    /* Without notes, the other ways in take the whole right column, aligned
       with the foot of the form. */
    .ev-gate__card:not(.has-notes) .ev-gate__alt {
      grid-area: 1 / 2 / span 2;
      align-self: end;
    }
    .ev-gate__ways {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
