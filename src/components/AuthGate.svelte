<script lang="ts">
  import { onDestroy } from 'svelte';
  import FilmLanding from './FilmLanding.svelte';
  import ConsultationIntake from './ConsultationIntake.svelte';
  import { register, signIn, enterGuestMode } from '@/state/controller.ts';
  import { session } from '@/state/session.svelte.ts';
  import { router } from '@/router/router.svelte.ts';
  import { persistIntake } from '@/lib/intake.ts';
  import { emptyIntakeDraft, type IntakeDraft, type IntakePresentation } from '@shared/intake.ts';
  import { WelcomeNarrator } from '@/voice/welcome.ts';
  import { primeSound } from '@/lib/sound.ts';

  let screen = $state<'film' | 'intake' | 'account' | 'login'>('film');
  let draft = $state<IntakeDraft>(emptyIntakeDraft());
  let email = $state('');
  let password = $state('');
  let name = $state('');
  let showPassword = $state(false);
  let busy = $state(false);
  let error = $state('');
  let created = $state(false);
  let welcomeVoice = $state(true);
  let voiceStatus = $state('');
  const narrator = new WelcomeNarrator();
  narrator.onStatus = (status) => voiceStatus = status;

  $effect(() => { session.entryStage = screen === 'film' ? 'film' : 'intake'; });
  function enterLounge() {
    narrator.stop();
    draft = emptyIntakeDraft();
    session.onboardingActive = false;
    session.introPlaying = false;
    session.entryStage = 'app';
    router.go('/lounge');
  }
  function signup() {
    if (session.signedIn && !session.guest) { enterLounge(); return; }
    primeSound();
    session.onboardingActive = true;
    session.introPlaying = true;
    screen = 'intake'; error = '';
  }
  function login() {
    if (session.signedIn && !session.guest) { enterLounge(); return; }
    screen = 'login'; error = '';
    // Keep a deep-link's page (especially its camera) behind the gate until
    // sign-in has finished and enterLounge chooses the destination explicitly.
    session.onboardingActive = true;
  }
  function explore() { if (!session.signedIn) enterGuestMode(); enterLounge(); }
  function back() {
    if (busy) return;
    narrator.stop();
    session.introPlaying = false;
    session.onboardingActive = false;
    screen = 'film'; error = ''; draft = emptyIntakeDraft();
  }
  function present(presentation: IntakePresentation) {
    void narrator.present(presentation.line, presentation.directive);
  }
  function done(value: IntakeDraft) {
    narrator.stop(); draft = value; screen = 'account';
    name = value.answers.preferredName ?? '';
  }
  function toggleVoice() {
    welcomeVoice = !welcomeVoice;
    narrator.setEnabled(welcomeVoice);
    if (welcomeVoice) { primeSound(); narrator.replay(); }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (busy) return;
    busy = true; error = '';
    try {
      if (screen === 'login') await signIn(email.trim(), password);
      else {
        if (!created) { await register(email.trim(), password, name.trim() || 'friend'); created = true; }
        await persistIntake({ ...draft, answers: { ...draft.answers, preferredName: name.trim() || null } });
      }
      enterLounge();
    } catch (err) {
      error = created
        ? 'Your account is ready, but your consultation could not be saved. Try saving again, or continue without saving these answers.'
        : err instanceof Error ? err.message : 'That did not work. Please try again.';
    } finally { busy = false; }
  }
  function discardAndContinue() { draft = emptyIntakeDraft(); enterLounge(); }
  onDestroy(() => { narrator.dispose(); session.introPlaying = false; });
</script>

{#if screen === 'film'}
  <FilmLanding signedIn={session.signedIn && !session.guest} onSignup={signup} onSignIn={login} onExplore={explore} />
{:else if screen === 'intake'}
  <ConsultationIntake onDone={done} onBack={back} onPresent={present} />
  <div class="narration" aria-label="Welcome narration controls">
    <button type="button" onclick={toggleVoice} aria-pressed={welcomeVoice}>{welcomeVoice ? '◖)) Voice on' : '◖ Voice off'}</button>
    <button type="button" onclick={() => narrator.replay()} disabled={!welcomeVoice}>Replay</button>
    <span>{voiceStatus || 'AI-generated welcome · your answers stay private'}</span>
  </div>
{:else}
  <main class="account-stage">
    <header><a class="wordmark" href="/" onclick={(event) => { event.preventDefault(); back(); }}>ese</a><button class="back" type="button" onclick={back} disabled={busy || created}>← Back</button></header>
    <section class="account-board" aria-labelledby="account-title">
      <p class="eyebrow">{screen === 'login' ? 'YOUR PLACE IS HERE' : 'ONE LAST THING'}</p>
      <h1 id="account-title">{screen === 'login' ? 'Welcome back.' : 'Let’s make this your space.'}</h1>
      <p class="subtitle">{screen === 'login' ? 'Ese is waiting for you in the lounge.' : 'Create your account, then take a moment with Ese in the lounge. The clinic comes when you’re ready.'}</p>
      <form onsubmit={submit}>
        {#if screen === 'account'}<label>Your name<input autocomplete="given-name" maxlength="60" bind:value={name} disabled={created} required /></label>{/if}
        <label>Email<input type="email" autocomplete="email" bind:value={email} disabled={created} required /></label>
        {#if !created}<label>Password<div class="password"><input type={showPassword ? 'text' : 'password'} autocomplete={screen === 'login' ? 'current-password' : 'new-password'} minlength="8" bind:value={password} required /><button type="button" onclick={() => showPassword = !showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div></label>{/if}
        {#if error}<p class="form-error" role="alert">{error}</p>{/if}
        {#if !session.serverReachable || !session.databaseAvailable}<p class="form-error">Accounts are temporarily unavailable. You can still look around the rooms.</p>{/if}
        <button class="submit" type="submit" disabled={busy || !session.serverReachable || !session.databaseAvailable}>{busy ? 'One moment…' : screen === 'login' ? 'Back to my lounge' : created ? 'Save my consultation' : 'Create my account'}<span>↗</span></button>
        {#if created && error}<button class="text-button" type="button" onclick={discardAndContinue}>Continue without saving my answers</button>{/if}
      </form>
      {#if screen === 'login'}<button class="text-button" onclick={signup}>New here? Meet Ese</button>{:else}<p class="storage-note">Your email and name create your account. Consultation answers are saved only if you chose to save them. Photos and cloud processing have separate controls.</p>{/if}
      {#if session.demoMode && screen === 'login'}<button class="demo" type="button" onclick={() => { email = 'demo@elohim.local'; password = 'demo1234'; }}>Use the local demo account <span>Synthetic scan history</span></button>{/if}
    </section>
    <p class="character-note">{session.characterStatus === 'loading' ? 'Ese is arriving…' : session.characterStatus === 'error' ? 'Ese’s 3D model could not load. You can still continue.' : 'A little care. At your pace.'}</p>
  </main>
{/if}

<style>
  .account-stage{position:fixed;inset:0;z-index:15;pointer-events:none;overflow:auto;background:linear-gradient(90deg,transparent 30%,#11111745);color:#f1e9df;}
  header{display:flex;justify-content:space-between;align-items:center;margin:24px 4vw;pointer-events:auto;}.wordmark{font-family:Georgia,serif;letter-spacing:-.065em;font-size:46px;color:#f8ece3;text-decoration:none;}.back{border:1px solid #dacbd034;padding:10px 17px;border-radius:30px;color:#e8ddd6;background:#17151fa1;font-size:11px;cursor:pointer;}
  .account-board{pointer-events:auto;position:relative;margin:4vh 6vw 40px auto;width:min(450px,43vw);padding:35px;border:1px solid #b5947460;border-radius:5px;background:repeating-linear-gradient(2deg,#7b5b4014 0 1px,transparent 1px 7px),linear-gradient(115deg,#392a21f7,#221c1bf7);box-shadow:inset 0 0 0 6px #d4b59005,0 35px 80px #0007;}.account-board::before{content:'';position:absolute;inset:9px;pointer-events:none;border:1px solid #d2b0821f;}.eyebrow{font-size:9px;letter-spacing:.22em;color:#bfa789;margin:0 0 18px;}h1{font:400 clamp(27px,3vw,38px)/1.15 Georgia,serif;letter-spacing:-.035em;margin:0 0 16px;}.subtitle{font-size:12px;line-height:1.7;color:#c6b9aa;margin-bottom:23px;}
  form{display:grid;gap:17px;}label{display:grid;gap:8px;font-size:11px;color:#cabbac;}input{font:inherit;font-size:13px;border:1px solid #ceb9a12f;background:#090b114d;border-radius:4px;padding:13px;color:#f5ebe4;min-width:0;width:100%;outline:none;}input:focus{border-color:#c6a0bd;}input:disabled{opacity:.65;}.password{display:flex;position:relative;}.password input{padding-right:55px;}.password button{position:absolute;right:8px;top:0;height:100%;border:0;background:none;color:#c8b5c3;font-size:10px;padding:7px;cursor:pointer;}.submit{display:flex;justify-content:space-between;align-items:center;background:#e9d7d8;border:0;border-radius:4px;color:#36282d;padding:15px 17px;font-size:12px;margin-top:3px;cursor:pointer;}.submit:disabled{opacity:.5;cursor:wait;}.text-button{border:0;background:none;color:#d7c2d6;font-size:11px;padding:16px 0 0;text-align:left;cursor:pointer;}.storage-note{font-size:9px;line-height:1.7;color:#b39e8f;margin:19px 0 0;}.form-error{font-size:11px;line-height:1.6;color:#f6c1b3;}.demo{margin-top:23px;border:1px solid #9278635c;background:none;padding:10px;color:#cdbdaa;width:100%;font-size:10px;cursor:pointer;}.demo span{display:block;font-size:8px;color:#978e83;margin-top:5px;}.character-note{position:fixed;bottom:6vh;left:10vw;font-size:10px;color:#d1c2c2;}.narration{position:fixed;left:4vw;bottom:22px;z-index:45;display:flex;gap:7px;align-items:center;color:#d1c3cf;max-width:48vw;flex-wrap:wrap;}.narration button{padding:8px 12px;border:1px solid #c8b3c939;border-radius:30px;background:#181622cc;color:#e5d8df;font-size:10px;cursor:pointer;}.narration span{font-size:8px;line-height:1.5;max-width:200px;}.narration button:disabled{opacity:.4;}
  @media(max-width:760px){header{margin:16px 22px;}.wordmark{font-size:36px;}.account-board{margin:44vh 18px 28px;width:calc(100% - 36px);padding:26px;}.character-note{display:none;}.narration{left:20px;right:20px;top:20px;bottom:auto;max-width:none;}.narration span{max-width:150px;font-size:7px;}.narration button{font-size:9px;padding:7px 10px;}}
  @media(max-height:640px) and (min-width:761px){.account-board{margin-top:0;padding:25px;}header{margin-top:12px;margin-bottom:8px;}}
</style>
