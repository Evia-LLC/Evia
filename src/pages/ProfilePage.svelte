<script lang="ts">
  /**
   * You. What she works from, and what she has remembered.
   *
   * The pregnancy question lives here as a real question in sentence case,
   * not as something to be discovered by typing it into the sensitivities
   * box. "Prefer not to say" is not read as a no; she stays cautious.
   */
  import Page from '@/components/Page.svelte';
  import { session } from '@/state/session.svelte.ts';
  import { api } from '@/lib/api.ts';
  import { link, router } from '@/router/router.svelte.ts';
  import { listVoiceOptions, previewVoice, refreshVoice, setGuestVoice, setVoiceEnabled, signOut } from '@/state/controller.ts';
  import { setSoundEnabled, soundEnabled } from '@/lib/sound.ts';

  /** Plays the introduction again: forget that it was seen, go home, it plays. */
  function replayIntro() {
    router.go('/');
  }
  import type { ExplanationStyle, MemoryRecord, SkinType, PregnancyStatus } from '@shared/types.ts';
  import { PREGNANCY_STATUSES, PREGNANCY_STATUS_LABELS } from '@shared/types.ts';

  let saving = $state(false);
  let saved = $state(false);
  let memories = $state<MemoryRecord[]>([]);

  let skinType = $state<SkinType>(session.user?.profile.skinType ?? 'unknown');
  let concerns = $state((session.user?.profile.concerns ?? []).join(', '));
  let sensitivities = $state((session.user?.profile.sensitivities ?? []).join(', '));
  let pregnancyStatus = $state<PregnancyStatus>(
    session.user?.profile.pregnancyStatus ?? 'unknown',
  );
  let style = $state<ExplanationStyle>(session.user?.preferences.explanationStyle ?? 'adaptive');
  let reducedMotion = $state(session.user?.preferences.reducedMotion ?? false);
  let voiceEnabled = $state(session.user?.preferences.voiceEnabled ?? false);
  let voiceURI = $state(session.user?.preferences.voiceURI ?? '');
  let voiceOptions = $state<Array<{ uri: string; name: string; lang: string }>>([]);

  // A guest's display name is the word she greets with ('there'), which
  // made this title read "What I know about there." A guest is 'you'.
  const name = $derived(session.guest ? 'you' : (session.user?.displayName ?? 'you'));

  const split = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  async function save() {
    saving = true;
    saved = false;
    try {
      if (session.guest && session.user) {
        // A guest's choices live only in this session; never send them to an
        // account endpoint (which could still have a cookie from another tab).
        session.user = {
          ...session.user,
          profile: { ...session.user.profile, skinType, concerns: split(concerns),
            sensitivities: split(sensitivities), pregnancyStatus },
          preferences: { ...session.user.preferences, explanationStyle: style,
            reducedMotion, voiceEnabled, voiceURI: null },
        };
        setGuestVoice(voiceEnabled);
        saved = true;
        setTimeout(() => (saved = false), 2400);
        return;
      }
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
    } finally {
      saving = false;
    }
  }

  function changeVoice(event: Event): void {
    voiceEnabled = (event.currentTarget as HTMLInputElement).checked;
    if (session.guest) setGuestVoice(voiceEnabled);
    else void setVoiceEnabled(voiceEnabled);
  }

  async function loadMemories() {
    if (session.guest) return;
    memories = (await api.memories()).memories;
  }

  async function forget(id: string) {
    await api.forget(id);
    await loadMemories();
  }

  $effect(() => {
    void loadMemories();
    void listVoiceOptions().then((options) => (voiceOptions = options));
  });
</script>

<Page
  eyebrow="You"
  title={`What I know about ${name}.`}
  lede="This is what I work from. I update some of it myself as we talk — correct anything I have wrong, and I will use the correction from the next sentence on."
>
  {#snippet actions()}
    <a class="cta cta--quiet" href="/privacy" use:link>Where your data goes</a>
  {/snippet}

  <section class="sec" aria-labelledby="skin">
    <div class="sec__head">
      <h2 class="sec__title" id="skin">Your skin</h2>
    </div>
    <div class="card">
      <label class="field">
        <span>Skin type</span>
        <select bind:value={skinType}>
          <option value="unknown">Not sure yet</option>
          <option value="dry">Dry</option>
          <option value="oily">Oily</option>
          <option value="combination">Combination</option>
          <option value="normal">Normal</option>
          <option value="sensitive">Sensitive</option>
        </select>
      </label>

      <label class="field">
        <span>What do you want to work on?</span>
        <input bind:value={concerns} placeholder="acne, texture, dark spots" />
      </label>

      <label class="field">
        <span>What does your skin not get on with?</span>
        <input bind:value={sensitivities} placeholder="fragrance, essential oils" />
      </label>
    </div>
  </section>

  <section class="sec sec--prose" aria-labelledby="preg">
    <div class="sec__head">
      <h2 class="sec__title" id="preg">One question that changes my advice</h2>
    </div>
    <div class="card card--warm">
      <label class="field field--tight">
        <small class="field__ask">
          Are you currently pregnant, trying to become pregnant, or breastfeeding?
        </small>
        <select bind:value={pregnancyStatus}>
          {#each PREGNANCY_STATUSES as status (status)}
            <option value={status}>{PREGNANCY_STATUS_LABELS[status]}</option>
          {/each}
        </select>
        <small class="field__note">
          This changes what I will suggest — retinoids in particular. “Prefer not to say” is not
          read as a no: I stay cautious either way.
        </small>
      </label>
    </div>
  </section>

  <section class="sec" aria-labelledby="how">
    <div class="sec__head">
      <h2 class="sec__title" id="how">How I talk to you</h2>
    </div>
    <div class="card">
      <label class="toggle">
        <input
          type="checkbox"
          checked={soundEnabled()}
          onchange={(e) => setSoundEnabled((e.currentTarget as HTMLInputElement).checked)}
        />
        <div>
          <strong>Room sound</strong>
          <small>
            A low tone under the clinic, a tick for the countdown, one note when a reading
            lands. Off, and the room is silent.
          </small>
        </div>
      </label>

      <label class="toggle">
        <input type="checkbox" checked={voiceEnabled} onchange={changeVoice}
          disabled={!session.canSpeak || (!session.guest && !session.user?.consents.cloud_reasoning)} />
        <div>
          <strong>Let me speak</strong>
          <small>
            {#if session.guest}
              Off until you choose it. Enabling sends the text of Ese's replies,
              which may mention your readings and concerns, to OpenAI for an AI-generated
              Marin voice. This choice lasts only for this visit.
            {:else if session.clonedVoice}
              AI-generated voice · OpenAI Marin. My mouth follows the audio waveform,
              and returns to rest when playback pauses or stops.
            {:else}
              Natural voice is available when OpenAI audio is configured on the server
              and cloud processing is enabled.
            {/if}
            {#if !session.guest && !session.user?.consents.cloud_reasoning}
              Enable cloud processing in Privacy before choosing voice.
            {/if}
            {#if !session.canSpeak}Voice is unavailable right now. You can still read and send messages.{/if}
          </small>
        </div>
      </label>

      {#if voiceEnabled && !session.clonedVoice && voiceOptions.length > 1}
        <label class="field">
          <span>Which voice</span>
          <select bind:value={voiceURI}>
            <option value="">Let me pick the best one</option>
            {#each voiceOptions as option (option.uri)}
              <option value={option.uri}>{option.name}</option>
            {/each}
          </select>
        </label>
        <button class="btn btn--mini hear" onclick={() => previewVoice(voiceURI || null)}>
          Hear it
        </button>
      {/if}

      {#if session.clonedVoice}
        <div class="line">
          <div class="line__main">
            <span class="line__title line__title--plain">Hear my voice</span>
            <span class="line__sub">
              {session.voiceStatus || 'An AI-generated voice sample from OpenAI.'}
            </span>
          </div>
          <div class="line__end">
            <button class="btn btn--mini" type="button" onclick={() => previewVoice(null)}
              disabled={session.guest ? !voiceEnabled : !session.user?.consents.cloud_reasoning}>Play</button>
          </div>
        </div>
      {/if}

      <label class="field">
        <span>How should I explain things?</span>
        <select bind:value={style}>
          <option value="adaptive">Read the room</option>
          <option value="simple">Keep it simple</option>
          <option value="detailed">Give me the detail</option>
          <option value="genz">Gen-Z mode</option>
        </select>
      </label>

      <label class="toggle">
        <input type="checkbox" bind:checked={reducedMotion} />
        <div>
          <strong>Reduced motion</strong>
          <small>Damps my idle movement, the room transitions, and the way pages arrive.</small>
        </div>
      </label>

      <div class="line">
        <div class="line__main">
          <span class="line__title line__title--plain">The welcome film</span>
          <span class="line__sub">The silent consultation film from the welcome page.</span>
        </div>
        <div class="line__end">
          <button class="btn btn--mini" type="button" onclick={replayIntro}>Play it again</button>
        </div>
      </div>

      <div class="save">
        <button class="cta" type="button" onclick={save} disabled={saving || session.guest}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {#if saved}<span class="tag tag--good">Saved</span>{/if}
        {#if session.guest}<span class="legal">Nothing is saved while you are looking around.</span>{/if}
      </div>
    </div>
  </section>

  <section class="sec" aria-labelledby="mem">
    <div class="sec__head">
      <h2 class="sec__title" id="mem">What I remember</h2>
      {#if memories.length}<span class="sec__meta">{memories.length}</span>{/if}
    </div>
    <p class="sec__lede">
      Durable facts, kept apart from the conversation. Delete anything that is wrong or that you
      would rather I forgot.
    </p>
    {#if memories.length}
      <div class="card">
        {#each memories as memory (memory.id)}
          <div class="line">
            <span class="tag">{memory.kind.charAt(0).toUpperCase() + memory.kind.slice(1).replace(/_/g, ' ')}</span>
            <div class="line__main">
              <span class="line__title line__title--plain">{memory.value}</span>
            </div>
            <div class="line__end">
              <button class="btn btn--danger btn--mini" onclick={() => forget(memory.id)}>Forget</button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">
        <p class="empty__title">Nothing yet.</p>
        <p class="empty__text">
          As we talk I keep the things worth keeping — what you use, what flares, what you are
          working towards. They show up here, and you can strike any of them.
        </p>
      </div>
    {/if}
  </section>

  <section class="sec">
    <div class="card">
      <div class="line">
        <div class="line__main">
          <span class="line__title">{session.guest ? 'Looking around' : session.user?.email}</span>
          <span class="line__sub">{session.guest ? 'No account, nothing saved' : `Since ${new Date(session.user?.createdAt ?? Date.now()).toLocaleDateString()}`}</span>
        </div>
        <div class="line__end">
          <button class="btn btn--mini" onclick={() => signOut()}>{session.guest ? 'Leave' : 'Sign out'}</button>
        </div>
      </div>
    </div>
  </section>
</Page>

<style>
  .field--tight {
    margin-bottom: 0;
  }
  .hear {
    margin: 0 0 var(--s-5);
  }
  .line__title--plain {
    font-weight: var(--w-regular);
  }
  .save {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s-3) var(--s-5);
    margin-top: var(--s-4);
  }
</style>
