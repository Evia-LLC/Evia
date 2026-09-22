<script lang="ts">
  /**
   * The entry screen.
   *
   * This is the only screen a stranger ever sees, and the product it is selling
   * is standing right behind it: `EviaStage` mounts before this does, so by
   * the time the gate paints, she is already in the lounge breathing and
   * blinking. So the gate does not cover the canvas — it grades it. The type
   * sits on the part of the frame that is nearly opaque and she keeps the part
   * that is not, which is the whole pitch in one image: there is a person in
   * here, and she is looking back.
   *
   * Nothing on this screen is decorative. There is no third-party sign-in, no
   * password reset, no counts and no logos, because none of that exists on the
   * server — the only two calls that exist are `signIn` and `register` (brief
   * §33). The demo and local-engine blocks are honesty disclosures and are
   * placed *above* the form deliberately: below the fold on a phone is the same
   * thing as hidden.
   */
  import { cubicOut, expoOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { register, signIn } from '@/state/controller.ts';
  import { session } from '@/state/session.svelte.ts';
  import { enterGuestMode } from '@/state/controller.ts';

  /**
   * Six of the nine metrics the analysis pipeline actually produces, in its own
   * vocabulary. It is here in place of a feature list because the specificity is
   * the proof: a product that says "under-eye" has looked at a face.
   */
  const READS = ['hydration', 'texture', 'redness', 'pores', 'evenness', 'under-eye'];

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
    email = 'demo@evia.local';
    password = 'demo1234';
    mode = 'login';
  }

  function setMode(next: 'login' | 'register') {
    if (next === mode) return;
    mode = next;
    // A stale "wrong password" hanging over a form you have just retitled reads
    // as an error about the new form.
    error = null;
  }

  function onPassword(event: Event) {
    password = (event.currentTarget as HTMLInputElement).value;
  }

  /**
   * Svelte's transitions are JavaScript animations, so the reduced-motion block
   * in the stylesheet cannot reach them — the three below have to ask for
   * themselves. Asked at the moment each one starts rather than read once, so
   * changing the system setting takes effect without a reload.
   */
  function stillness(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Height and fade in one pass, for the field the register mode adds.
   *
   * The obvious build was Svelte's `slide` wrapped around a `fade`, and it reads
   * as two events — the box finishes opening a beat before its contents catch
   * up. Driving both from one clock keeps it feeling like a single object being
   * made room for. Opacity is deliberately behind the height (it only starts at
   * t≈0.3) so the field lands rather than smears.
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

  /** The gate does not vanish, it lifts off the room it was dimming. */
  function dissolve(_node: Element) {
    return {
      duration: stillness() ? 0 : 520,
      easing: cubicOut,
      css: (t: number, u: number) => `opacity:${t};transform:scale(${(1 + u * 0.014).toFixed(4)})`,
    };
  }
</script>

<div class="auth auth--gate" class:auth--leaving={leaving} out:dissolve>
  <div class="auth__light" aria-hidden="true">
    <span class="auth__key"></span>
    <span class="auth__fill"></span>
    <span class="auth__grain"></span>
  </div>

  <div class="auth__scroll">
    <!-- Her window. Not empty space: it is the part of the screen the product
         is happening in, and it yields first when there is nothing to spare. -->
    <div class="auth__air" aria-hidden="true"></div>

    <div class="auth__col">
      <!-- The pitch and the form are wrapped separately because on a short wide
           window they become two columns, and a grid can only move whole
           children. Wrapping is also why the disclosures travel with the pitch
           rather than with the fields. -->
      <div class="auth__pitch">
        <h1 class="auth__wordmark">Evia</h1>

        <p class="auth__lede">
          <span class="auth__lede-a">A beauty consultant</span>
          <span class="auth__lede-b">who can actually look at your skin.</span>
        </p>

        <p class="auth__sub">
          Ask her anything. When it matters she reads your face with your own camera — and
          remembers what changed since last time.
        </p>

        <!-- The separating dots are drawn by CSS from an empty `content`, so the
             real space after each word is what stops a screen reader running the
             whole strip together as one word. -->
        <p class="auth__reads">
          <span class="auth__reads-key">reads</span>
          {#each READS as read (read)}<b>{read}</b>{' '}{/each}
        </p>

        <!-- The disclosures, as a hairline band rather than two tinted boxes.
             They were bordered panels taking about 40% of the first screen on a
             phone, which pushed the actual purpose of the page under two
             notices. "Not buried" and "the biggest thing on screen" are far
             apart: this is one quiet row each, above the form where they are
             found without being announced, and the credentials are still one
             tap. -->
        {#if session.demoMode || !session.modelAvailable}
          <div class="auth__notes">
            {#if session.demoMode}
              <div class="auth__note">
                <span class="auth__note-tag">Demo mode</span>
                <span class="auth__note-body">seeded with six scans of history</span>
                <!-- The credentials and the control that fills them are one
                     object; the disclosure is not weakened by being legible on
                     a button. Last in the row so that when the row is too narrow
                     to hold all three it is the button that drops to its own
                     line, rather than the sentence breaking around it. -->
                <button type="button" class="auth__note-btn" onclick={useDemo}>
                  <code>demo@evia.local</code>
                  <code>demo1234</code>
                </button>
              </div>
            {/if}

<!--
              The disclosure survives; the environment variable does not.
              Naming ANTHROPIC_API_KEY in the second sentence a visitor reads
              tells them the page was assembled rather than designed, and it
              means nothing to the person it is shown to. What it has to say —
              that the conversation is not the real model, and that the
              measurements are real regardless — is said here in full. The
              variable name belongs in the README, where someone can act on it.
            -->
            {#if !session.modelAvailable}
              <div class="auth__note auth__note--engine">
                <span class="auth__note-tag">Local engine</span>
                <span class="auth__note-body">
                  conversation is running the built-in Evia rather than the full model — your
                  scans, storage and trends are real either way
                </span>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <form class="auth__form" onsubmit={submit}>
        <div class="auth__rail" role="group" aria-label="Sign in or create an account">
          <button
            type="button"
            class="auth__tab"
            data-active={mode === 'login'}
            aria-pressed={mode === 'login'}
            onclick={() => setMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            class="auth__tab"
            data-active={mode === 'register'}
            aria-pressed={mode === 'register'}
            onclick={() => setMode('register')}
          >
            Create account
          </button>
        </div>

        <!-- Explicit `for`/`id` rather than a wrapping label. The password field
             carries a reveal control, and a button inside a label is both
             invalid content and a real defect: the input's accessible name
             would come out as "Password Show". Uniform across all three so
             there is one field shape, not two. -->
        {#if mode === 'register'}
          <div class="auth__field auth__field--name" transition:makeRoom>
            <label class="auth__label" for="auth-name">What should I call you?</label>
            <input
              id="auth-name"
              class="auth__input"
              bind:value={displayName}
              autocomplete="given-name"
              placeholder="Ada"
            />
          </div>
        {/if}

        <div class="auth__field auth__field--email">
          <label class="auth__label" for="auth-email">Email</label>
          <input
            id="auth-email"
            class="auth__input"
            type="email"
            bind:value={email}
            autocomplete="email"
            required
          />
        </div>

        <div class="auth__field auth__field--password">
          <label class="auth__label" for="auth-password">Password</label>
          <!-- Not `bind:value`: a two-way binding forbids a dynamic `type`, and
               toggling the attribute on the same element is what keeps the
               caret and the focus where they were. -->
          <input
            id="auth-password"
            class="auth__input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            oninput={onPassword}
            autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
            minlength="8"
            required
          />
          <button
            type="button"
            class="auth__peek"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onclick={() => (showPassword = !showPassword)}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>

        {#if error}
          <div class="error auth__error" role="alert" transition:makeRoom={{ duration: 320 }}>
            {error}
          </div>
        {/if}

<!--
          Offline is its own state, not an error the form should discover.
          Without this the fields and the button are live against a server that
          is not there, so the first thing a visitor learns about the product is
          that its sign-in is broken. Said up front instead, with the form shut.
        -->
        {#if !session.serverReachable}
          <div class="auth__offline" role="status">
            <span class="auth__note-tag">Offline</span>
            <span class="auth__note-body">
              this build has no server attached, so sign-in is off — everything you can see
              here is running on your device
            </span>
          </div>
        {:else if !session.databaseAvailable}
          <div class="auth__offline" role="status">
            <span class="auth__note-tag">No database</span>
            <span class="auth__note-body">
              this deployment has nowhere to keep an account yet, so sign-in is off — the
              room, the camera, the scan and the readouts all run on your device. Look around.
            </span>
          </div>
        {/if}

        <button
          class="auth__cta"
          type="submit"
          disabled={busy || !session.serverReachable || !session.databaseAvailable}
          data-busy={busy}
        >
          <span class="auth__cta-label">
            <!-- The two labels overlap rather than queue. Holding the incoming
                 one back 70ms left a window where the outgoing label had faded
                 and the new one had not arrived, and the primary button on the
                 screen sat there with nothing written on it. -->
            {#key cta}
              <span
                in:fly={{ y: 6, duration: stillness() ? 0 : 260, easing: expoOut }}
                out:fly={{ y: -6, duration: stillness() ? 0 : 200, easing: cubicOut }}>{cta}</span
              >
            {/key}
          </span>
        </button>

<!--
          The way in without an account.
          
          Everything worth looking at on a phone — the room, her, the camera,
          the analysis, the readouts — runs on the device and needs nothing from
          a server. Requiring an account to reach any of it was a rule borrowed
          from the parts that genuinely do. What it costs is stated on the
          button rather than discovered afterwards.
        -->
        <button type="button" class="auth__guest" onclick={enterGuestMode}>
          Look around without an account
          <small>
            {#if session.guestVoice}
              she talks in her own voice, scans and reads — nothing is saved when you leave
            {:else}
              she talks, scans and reads — nothing is saved when you leave
            {/if}
          </small>
        </button>

        <p class="auth__promise">
          Skin scans are analysed on your device. The photo never leaves it unless you say so.
        </p>
      </form>
    </div>
  </div>
</div>
