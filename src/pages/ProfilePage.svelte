<!--
  Profile: what Evia works from, and what it has remembered.

  The pregnancy question lives here as a real question in sentence case,
  not as something to be discovered by typing it into the sensitivities
  box. "Prefer not to say" is not read as a no; Evia stays cautious.

  Everything on the page is the account's own (or, for a guest, the visit's
  defaults): there is no sample version of a profile. The skin fields and the
  preferences are saved together by one Save, which sits in a bar that stays
  in view at the foot of the page; room sound is a device setting and applies
  at once, as it always has.

  Sample data on while signed in: the account is set aside (BUILD-PLAN 3.1).
  The fields show the defaults a guest sees, not the account's values, what
  Evia remembers is not loaded, and Save is off; a note at the top offers the
  way back, and turning sample data off fills the fields from the account.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import { sample } from '@/sample/mode.svelte.ts';
  import { api } from '@/lib/api.ts';
  import { listVoiceOptions, previewVoice, refreshVoice, signOut } from '@/state/controller.ts';
  import { forgetIntro } from '@/lib/intro.ts';
  import { setSoundEnabled, soundEnabled } from '@/lib/sound.ts';
  import type { ExplanationStyle, MemoryRecord, SkinType, PregnancyStatus } from '@shared/types.ts';
  import { PREGNANCY_STATUSES, PREGNANCY_STATUS_LABELS } from '@shared/types.ts';
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import Toggle from '@/ui/Toggle.svelte';
  import Button from '@/ui/Button.svelte';
  import Pill from '@/ui/Pill.svelte';
  import EmptyState from '@/ui/EmptyState.svelte';
  import PageFrame from './frame/PageFrame.svelte';
  import TextField from './frame/TextField.svelte';
  import SelectField from './frame/SelectField.svelte';
  import SampleAccountNote from './frame/SampleAccountNote.svelte';

  /** Plays the introduction again: forget that it was seen, go home, it plays. */
  function replayIntro() {
    forgetIntro();
    location.assign('/');
  }

  let saving = $state(false);
  let saved = $state(false);
  let saveError = $state<string | null>(null);
  let memories = $state<MemoryRecord[]>([]);

  /** A signed-in account while sample data is on: set aside, not shown or saved. */
  const setAside = $derived(sample.on && !session.guest);
  /** Nothing on this page can be saved: no account, or the account set aside. */
  const readOnly = $derived(session.guest || sample.on);

  /** The user whose values fill the form: none while the account is set aside. */
  const source = () => (sample.on && !session.guest ? null : session.user);

  let skinType = $state<SkinType>(source()?.profile.skinType ?? 'unknown');
  let concerns = $state((source()?.profile.concerns ?? []).join(', '));
  let sensitivities = $state((source()?.profile.sensitivities ?? []).join(', '));
  let pregnancyStatus = $state<PregnancyStatus>(source()?.profile.pregnancyStatus ?? 'unknown');
  let style = $state<ExplanationStyle>(source()?.preferences.explanationStyle ?? 'adaptive');
  let reducedMotion = $state(source()?.preferences.reducedMotion ?? false);
  let voiceEnabled = $state(source()?.preferences.voiceEnabled ?? false);
  let voiceURI = $state(source()?.preferences.voiceURI ?? '');

  /* Sample data switched on or off from this page: refill from what now shows. */
  function fill() {
    const user = source();
    skinType = user?.profile.skinType ?? 'unknown';
    concerns = (user?.profile.concerns ?? []).join(', ');
    sensitivities = (user?.profile.sensitivities ?? []).join(', ');
    pregnancyStatus = user?.profile.pregnancyStatus ?? 'unknown';
    style = user?.preferences.explanationStyle ?? 'adaptive';
    reducedMotion = user?.preferences.reducedMotion ?? false;
    voiceEnabled = user?.preferences.voiceEnabled ?? false;
    voiceURI = user?.preferences.voiceURI ?? '';
  }
  let sampleWas = sample.on;
  $effect(() => {
    const on = sample.on;
    if (on === sampleWas) return;
    sampleWas = on;
    untrack(fill);
  });
  let voiceOptions = $state<Array<{ uri: string; name: string; lang: string }>>([]);
  let sound = $state(soundEnabled());

  const SKIN_TYPES: Array<{ value: SkinType; label: string }> = [
    { value: 'unknown', label: 'Not sure yet' },
    { value: 'dry', label: 'Dry' },
    { value: 'oily', label: 'Oily' },
    { value: 'combination', label: 'Combination' },
    { value: 'normal', label: 'Normal' },
    { value: 'sensitive', label: 'Sensitive' },
  ];
  const STYLES: Array<{ value: ExplanationStyle; label: string }> = [
    { value: 'adaptive', label: 'Read the room' },
    { value: 'simple', label: 'Keep it simple' },
    { value: 'detailed', label: 'Give me the detail' },
    { value: 'genz', label: 'Gen-Z mode' },
  ];
  const PREGNANCY = PREGNANCY_STATUSES.map((status) => ({ value: status, label: PREGNANCY_STATUS_LABELS[status] }));
  const voiceChoices = $derived([
    { value: '', label: 'Let Evia pick the best one' },
    ...voiceOptions.map((option) => ({ value: option.uri, label: option.name })),
  ]);

  const voiceNote = $derived.by(() => {
    if (!session.canSpeak) {
      return 'This browser has no speech synthesis and no licensed voice is configured, so Evia cannot speak here.';
    }
    return session.clonedVoice
      ? "Evia reads its replies aloud in its own licensed voice."
      : "Evia reads its replies aloud in this device's built-in voice for now.";
  });

  // The account's own creation date, written as Settings writes it. With no
  // date on record the line says nothing rather than guessing one.
  const since = $derived(
    session.user?.createdAt
      ? new Date(session.user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : null,
  );

  const split = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  async function save() {
    if (readOnly) return;
    saving = true;
    saved = false;
    saveError = null;
    try {
      await api.updateProfile({
        skinType,
        concerns: split(concerns),
        sensitivities: split(sensitivities),
        pregnancyStatus,
      });
      await api.updatePreferences({
        explanationStyle: style,
        reducedMotion,
        voiceEnabled,
        voiceURI: voiceURI || null,
      });
      const me = await api.me();
      session.user = me.user;
      await refreshVoice();
      saved = true;
      setTimeout(() => (saved = false), 2400);
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Your changes could not be saved.';
    } finally {
      saving = false;
    }
  }

  async function loadMemories() {
    if (session.guest || sample.on) {
      memories = [];
      return;
    }
    memories = (await api.memories()).memories;
  }

  async function forget(id: string) {
    if (readOnly) return;
    await api.forget(id);
    await loadMemories();
  }

  function setSound(on: boolean) {
    sound = on;
    setSoundEnabled(on);
  }

  const kindLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' ');

  $effect(() => {
    void sample.on;
    void loadMemories();
  });
  $effect(() => {
    void listVoiceOptions().then((options) => (voiceOptions = options));
  });
</script>

<PageFrame
  title="Profile"
  subtitle="What Evia works from. Correct anything that is wrong, and the next answer uses the correction."
  back={{ href: '/settings', label: 'Settings' }}
>
  {#if setAside}<SampleAccountNote action="see and change your profile" />{/if}

  <!-- From main (Section 5): the way to the account controls and to the
       optional safety and lifestyle consent, as quiet links under the title. -->
  <nav class="profile__links" aria-label="Consent and account controls">
    <Button variant="secondary" size="sm" href="/privacy" iconEnd="chevron-right">Account controls and consent</Button>
    <Button variant="secondary" size="sm" href="/legal/safety-lifestyle-consent" iconEnd="chevron-right">Optional safety and lifestyle consent</Button>
  </nav>

  <div class="profile">
    <div class="profile__col">
      <Card aria-labelledby="pro-skin">
        <SectionHeader id="pro-skin" title="Your skin" icon="droplet" />
        <div class="fields">
          <SelectField label="Skin type" bind:value={skinType} options={SKIN_TYPES} />
          <TextField
            label="What do you want to work on?"
            bind:value={concerns}
            placeholder="acne, texture, dark spots"
            hint="Separate each one with a comma."
          />
          <TextField
            label="What does your skin not get on with?"
            bind:value={sensitivities}
            placeholder="fragrance, essential oils"
            hint="Separate each one with a comma."
          />
        </div>
      </Card>

      <Card tone="rose" aria-labelledby="pro-preg">
        <SectionHeader id="pro-preg" title="One question that changes the advice" icon="info" iconStyle="rose" />
        <div class="fields">
          <SelectField
            label="Are you currently pregnant, trying to become pregnant, or breastfeeding?"
            bind:value={pregnancyStatus}
            options={PREGNANCY}
            hint="This changes what Evia suggests, retinoids in particular. “Prefer not to say” is not read as a no: Evia stays cautious either way."
          />
        </div>
      </Card>

      <Card aria-labelledby="pro-mem">
        <SectionHeader
          id="pro-mem"
          title="What Evia remembers"
          icon="lightbulb"
          subtitle="Durable facts, kept apart from the conversation. Delete anything that is wrong or that you would rather it forgot."
        >
          {#snippet action()}
            {#if memories.length}<Pill size="sm">{memories.length}</Pill>{/if}
          {/snippet}
        </SectionHeader>
        {#if memories.length}
          <ul class="memories" role="list">
            {#each memories as memory (memory.id)}
              <li class="memory">
                <Pill size="sm" tone="rose">{kindLabel(memory.kind)}</Pill>
                <span class="memory__value">{memory.value}</span>
                <Button variant="ghost" size="sm" onclick={() => forget(memory.id)} label={`Forget: ${memory.value}`}>
                  Forget
                </Button>
              </li>
            {/each}
          </ul>
        {:else}
          <EmptyState
            compact
            icon="lightbulb"
            title="Nothing yet"
            body={session.guest
              ? 'Nothing is remembered while you are looking around without an account.'
              : sample.on
              ? 'Your account is set aside while sample data is on, so what Evia remembers is not shown.'
              : 'As you talk, Evia keeps the things worth keeping — what you use, what flares, what you are working towards. They show up here, and you can strike any of them.'}
          />
        {/if}
      </Card>
    </div>

    <div class="profile__col">
      <Card aria-labelledby="pro-talk">
        <SectionHeader id="pro-talk" title="How Evia talks to you" icon="messages" />
        <div class="fields">
          <!-- A disabled switch dims its own row, so the reason sits beside it. -->
          <div class="toggle-with-note">
            <Toggle
              label="Evia's voice"
              description={session.canSpeak ? voiceNote : undefined}
              bind:checked={voiceEnabled}
              disabled={!session.canSpeak}
            />
            {#if !session.canSpeak}<p class="toggle-note">{voiceNote}</p>{/if}
          </div>

          {#if voiceEnabled && !session.clonedVoice && voiceOptions.length > 1}
            <div class="inline">
              <SelectField label="Which voice" bind:value={voiceURI} options={voiceChoices} class="inline__grow" />
              <Button variant="secondary" size="sm" iconStart="play" onclick={() => previewVoice(voiceURI || null)}>
                Hear it
              </Button>
            </div>
          {/if}

          {#if session.clonedVoice}
            <div class="line">
              <div class="line__text">
                <span class="line__title">Hear the voice</span>
                <span class="line__sub">
                  {session.voiceStatus || 'A short line in Evia’s own voice, so you can check this device plays it.'}
                </span>
              </div>
              <Button variant="secondary" size="sm" iconStart="play" onclick={() => previewVoice(null)}>Play</Button>
            </div>
          {/if}

          <SelectField label="How should Evia explain things?" bind:value={style} options={STYLES} />

          <Toggle
            label="Reduced motion"
            description="Damps the room's movement, the transitions, and the way pages arrive."
            bind:checked={reducedMotion}
          />
          <Toggle
            label="Room sound"
            description="A low tone under the room, a tick for the countdown, one note when a reading lands. Remembered on this device."
            checked={sound}
            onchange={setSound}
          />

          <div class="line">
            <div class="line__text">
              <span class="line__title">The introduction</span>
              <span class="line__sub">The short introduction you saw when you first arrived.</span>
            </div>
            <Button variant="secondary" size="sm" onclick={replayIntro}>Play it again</Button>
          </div>
        </div>
      </Card>

      <Card aria-labelledby="pro-account">
        <SectionHeader id="pro-account" title="Account" icon="user" />
        <div class="line line--account">
          <div class="line__text">
            <span class="line__title line__title--strong">
              {session.guest ? (sample.on ? 'Sample preview' : 'Looking around') : setAside ? 'Sample preview' : session.user?.email}
            </span>
            {#if session.guest}
              <span class="line__sub">No account, nothing saved</span>
            {:else if setAside}
              <span class="line__sub">Your account is set aside while sample data is on</span>
            {:else if since}
              <span class="line__sub">Member since {since}</span>
            {/if}
          </div>
          {#if !setAside}
            <Button variant="secondary" size="sm" onclick={() => signOut()}>{session.guest ? 'Leave' : 'Sign out'}</Button>
          {/if}
        </div>
      </Card>
    </div>
  </div>

  <div class="savebar" role="group" aria-label="Save your profile">
    <div class="savebar__status" aria-live="polite">
      {#if saved}
        <Pill tone="sage" dot>Saved</Pill>
      {:else if saveError}
        <span class="savebar__error">{saveError}</span>
      {:else if session.guest}
        <span class="savebar__note">Nothing is saved while you are looking around.</span>
      {:else if sample.on}
        <span class="savebar__note">Nothing is saved while sample data is on.</span>
      {:else}
        <span class="savebar__note">Skin details and how Evia talks are saved together.</span>
      {/if}
    </div>
    <Button variant="primary" onclick={save} disabled={saving || readOnly}>
      {saving ? 'Saving…' : 'Save changes'}
    </Button>
  </div>
</PageFrame>

<style>
  .profile__links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    margin: 0 0 16px;
  }
  .profile {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }
  .profile__col {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  @media (max-width: 1023px) {
    .profile {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .fields {
    display: grid;
    gap: 20px;
    margin-top: 20px;
  }

  .toggle-with-note {
    display: grid;
    gap: 2px;
  }
  .toggle-note {
    margin: 0;
    max-width: 52ch;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }

  .inline {
    display: flex;
    align-items: flex-end;
    gap: 12px;
  }
  .inline :global(.inline__grow) {
    flex: 1;
  }
  .inline :global(.ev-btn) {
    min-height: 48px;
  }

  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .line--account {
    margin-top: 16px;
  }
  .line__text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .line__title {
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }
  .line__title--strong {
    font-size: var(--fs-label);
    font-weight: var(--fw-semibold);
  }
  .line__sub {
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }

  .memories {
    display: grid;
    margin: 12px 0 0;
    padding: 0;
  }
  .memory {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    list-style: none;
  }
  .memory + .memory {
    border-top: 1px solid var(--divider);
  }
  .memory__value {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-body);
    color: var(--text-strong);
  }

  /* The save bar stays in view at the foot of the scrolling page. */
  .savebar {
    position: sticky;
    bottom: 16px;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px 20px;
    flex-wrap: wrap;
    margin-top: 8px;
    padding: 12px 12px 12px 20px;
    border: 1px solid var(--card-rim-raised);
    border-radius: var(--r-pill);
    background: var(--glass-light-strong);
    box-shadow: var(--shadow-md);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
  }
  .savebar__status {
    flex: 1;
    min-width: 0;
  }
  .savebar__note {
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }
  .savebar__error {
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-danger);
  }
  @media (max-width: 819px) {
    .savebar {
      bottom: 10px;
    }
  }
  @media (max-width: 559px) {
    .savebar {
      border-radius: var(--r-xl);
      padding: 12px;
    }
    .savebar__status {
      flex-basis: 100%;
    }
    .savebar :global(.ev-btn) {
      width: 100%;
    }
  }
</style>
