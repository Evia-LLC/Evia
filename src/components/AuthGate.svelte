<script lang="ts">
  import { api } from '@/lib/api.ts';
  import { register, signIn, enterGuestMode } from '@/state/controller.ts';
  import { session } from '@/state/session.svelte.ts';
  import AgeGuardianFlow from '@/components/legal/AgeGuardianFlow.svelte';
  import { AGE_FLOW_COPY, ageOnDate } from '@shared/age-flow.ts';
  import { link, router } from '@/router/router.svelte.ts';

  let mode = $state<'login' | 'register'>('login');
  let dateOfBirth = $state('');
  let email = $state('');
  let password = $state('');
  let displayName = $state('');
  let termsAccepted = $state(false);
  let showPassword = $state(false);
  let busy = $state(false);
  let ageBlocked = $state(false);
  let guardianPreview = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(new URLSearchParams(location.search).get('auth') === 'link-invalid' ? 'This email link could not be completed. Use the browser that requested it, or sign in after confirming your email.' : null);
  const age = $derived(ageOnDate(dateOfBirth));
  const canReachAccount = $derived(session.serverReachable && session.databaseAvailable);
  const registrationAvailable = $derived(canReachAccount && session.registrationEnabled);

  async function emailAction(action: 'reset' | 'resend') {
    if (busy) return;
    if (!email.trim()) { error = 'Enter your email address first.'; return; }
    busy = true; error = null; notice = null;
    try { const result = action === 'reset' ? await api.requestPasswordReset(email) : await api.resendConfirmation(email); notice = result.message; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'The email request failed.'; }
    finally { busy = false; }
  }
  function switchMode(next: 'login' | 'register') {
    mode = next;
    error = null;
    notice = null;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    error = null;
    notice = null;
    if (!canReachAccount) {
      error = 'Accounts are temporarily unavailable. You can still explore privately.';
      return;
    }
    busy = true;
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        if (age === null) throw new Error('Enter a valid date of birth.');
        if (age < 16) {
          ageBlocked = true;
          email = ''; password = ''; displayName = ''; dateOfBirth = ''; termsAccepted = false;
          throw new Error(AGE_FLOW_COPY.under16);
        }
        if (age < 18) {
          guardianPreview = true;
          password = ''; displayName = ''; termsAccepted = false;
          return;
        }
        if (!registrationAvailable) {
          throw new Error('Sample registration is not available in this deployment while the legal wording is being reviewed.');
        }
        if (!termsAccepted) throw new Error('Please choose whether to accept the current Terms.');
        const signedIn = await register(email, password, displayName, dateOfBirth, termsAccepted);
        if (!signedIn) { notice = 'Check your email to confirm your account, then sign in.'; password = ''; mode = 'login'; return; }
        router.go('/legal/age-assurance');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Please try again.';
      if (message.startsWith('Check your email to confirm')) {
        notice = message;
        mode = 'login';
        password = '';
      } else error = message;
    } finally {
      busy = false;
    }
  }

  function fillDemo() {
    mode = 'login';
    email = 'demo@elohim.local';
    password = 'demo1234';
    error = null;
  }
</script>

<div class="entry" aria-label="Welcome to Evia">
  <div class="entry__wash" aria-hidden="true"></div>
  <header class="entry__top">
    <a href="/" use:link class="entry__brand" aria-label="Evia home">evia<span>.</span></a>
    <span class="entry__top-aside">PERSONAL SKIN INTELLIGENCE</span>
  </header>

  <main class="entry__scroll">
    <div class="entry__layout">
      <section class="entry__story" aria-labelledby="entry-heading">
        <div class="entry__eyebrow"><span aria-hidden="true">✦</span> A calmer way to understand your skin</div>
        <h1 id="entry-heading">Care that <em>sees</em><br />the whole picture.</h1>
        <p class="entry__lede">Meet Evia. A beauty companion that listens, helps you understand your skin, and makes every new reading more meaningful.</p>
        <div class="entry__features" aria-label="What you can explore">
          <div><strong>01</strong><span>Understand your skin</span></div>
          <div><strong>02</strong><span>Follow real progress</span></div>
          <div><strong>03</strong><span>Care with confidence</span></div>
        </div>
        <p class="entry__on-device">Skin analysis runs on your device. Photos stay there unless you choose otherwise.</p>
      </section>

      <section class="entry__account" aria-label="Your account">
        {#if guardianPreview}
          <div class="entry__account-head">
            <p class="entry__kicker">AGE AND GUARDIAN REVIEW</p>
            <h2>A little more guidance.</h2>
            <p>This is a preview of the age and guardian flow; it does not activate a minor's account.</p>
          </div>
          <AgeGuardianFlow initialStep={3} initialEmail={email} initialDOB={dateOfBirth} />
          <button type="button" class="entry__plain" onclick={() => { guardianPreview = false; email = ''; dateOfBirth = ''; }}>Back to sign in</button>
        {:else}
          <div class="entry__account-head">
            <p class="entry__kicker">{mode === 'login' ? 'WELCOME BACK' : 'BEGIN YOUR JOURNEY'}</p>
            <h2>{mode === 'login' ? 'Your space awaits.' : 'A space that’s yours.'}</h2>
            <p>{mode === 'login' ? 'Sign in to pick up where you left off.' : 'Create a sample account to keep your readings and preferences together.'}</p>
          </div>

          <div class="entry__tabs" role="group" aria-label="Account access">
            <button type="button" aria-pressed={mode === 'login'} class:entry__tab--active={mode === 'login'} onclick={() => switchMode('login')}>Sign in</button>
            <button type="button" aria-pressed={mode === 'register'} class:entry__tab--active={mode === 'register'} onclick={() => switchMode('register')}>Create account</button>
          </div>

          <form class="entry__form" onsubmit={submit}>
            {#if mode === 'register'}
              <label class="entry__field">
                <span id="entry-dob-label">Date of birth</span>
                <input type="date" bind:value={dateOfBirth} aria-labelledby="entry-dob-label" aria-describedby="entry-dob-help" required />
                <small id="entry-dob-help">{AGE_FLOW_COPY.eligibility}</small>
              </label>
              {#if (age ?? 0) >= 18}
                <label class="entry__field">
                  <span>What should Evia call you?</span>
                  <input bind:value={displayName} autocomplete="given-name" maxlength="100" placeholder="Your first name" />
                </label>
              {/if}
            {/if}

            <label class="entry__field">
              <span>Email address</span>
              <input type="email" bind:value={email} autocomplete="email" placeholder="you@example.com" required />
            </label>

            {#if mode === 'login' || (age ?? 0) >= 18}
              <div class="entry__field">
                <label for="entry-password">Password</label>
                <div class="entry__password">
                  <input id="entry-password" type={showPassword ? 'text' : 'password'} bind:value={password}
                    autocomplete={mode === 'login' ? 'current-password' : 'new-password'} minlength="8" required />
                  <button type="button" onclick={() => (showPassword = !showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
                </div>
              </div>
            {/if}

            {#if mode === 'register' && (age ?? 0) >= 18}
              <div class="entry__terms">
                <p>Sample registration only. Legal wording is still under review; no production account processing is approved.</p>
                <label><input type="checkbox" bind:checked={termsAccepted} required /> <span>{AGE_FLOW_COPY.terms}</span></label>
                <div><a href="/legal/terms" use:link>Read the Terms</a><a href="/legal/privacy" use:link>Privacy policy</a></div>
              </div>
              {#if !registrationAvailable}
                <p class="entry__notice" role="status">Registration is disabled in this build while legal review or backend setup is outstanding. You can explore as a guest.</p>
              {/if}
            {/if}

            {#if !session.serverReachable}
              <p class="entry__notice" role="status">The server is offline. Account access is temporarily unavailable.</p>
            {:else if !session.databaseAvailable}
              <p class="entry__notice" role="status">Account storage is currently unavailable. On-device preview still works.</p>
            {/if}

            {#if mode === 'login'}
              <div class="actions">
                <button type="button" class="entry__plain" disabled={busy || !session.serverReachable} onclick={() => emailAction('reset')}>Forgot password?</button>
                <button type="button" class="entry__plain" disabled={busy || !session.serverReachable} onclick={() => emailAction('resend')}>Resend confirmation</button>
              </div>
            {/if}
            {#if error}<p class="entry__error" role="alert">{error}</p>{/if}
            {#if notice}<p class="entry__success" role="status">{notice}</p>{/if}

            <button type="submit" class="entry__submit" disabled={busy || !canReachAccount || (mode === 'register' && !registrationAvailable)}>
              {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create sample account'} <span aria-hidden="true">↗</span>
            </button>
          </form>

          <div class="entry__divider"><span>or simply explore</span></div>
          <button type="button" class="entry__guest" disabled={ageBlocked} onclick={enterGuestMode}>
            Look around without an account <span aria-hidden="true">↗</span>
            <small>No account, no saved history. Your scans stay on your device.</small>
          </button>
          {#if session.demoMode}
            <button type="button" class="entry__demo" onclick={fillDemo}>Use sample demo credentials</button>
          {/if}
          {#if !session.modelAvailable}<p class="entry__footnote">Conversation is using the local demo engine; a cloud model isn't connected in this build.</p>{/if}
          <p class="entry__legal">Review the <a href="/legal/terms" use:link>draft Terms</a>,
            <a href="/legal/privacy" use:link>draft Privacy Policy</a> and
            <a href="/legal/age-assurance" use:link>age-assurance preview</a>.
            Signing in does not accept these drafts.</p>
        {/if}
      </section>
    </div>
  </main>
</div>
