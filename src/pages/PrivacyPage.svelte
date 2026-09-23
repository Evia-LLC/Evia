<script lang="ts">
  /**
   * Privacy, stated plainly (ARCHITECTURE §10).
   *
   * Both consents default to off and are asked for separately, because storing
   * a face and sending a face to a third party are different decisions, and
   * bundling them into one switch would be the dishonest design.
   */
  import Page from '@/components/Page.svelte';
  import { session } from '@/state/session.svelte.ts';
  import { deleteEverything, setConsent } from '@/state/controller.ts';
  import { LEGAL_CONTENT } from '@shared/legal-content.ts';

  let confirming = $state(false);
  let busy = $state(false);
  let result = $state<string | null>(null);

  const consents = $derived(session.user?.consents);

  async function toggle(kind: 'progress_photos' | 'cloud_reasoning', event: Event) {
    const granted = (event.target as HTMLInputElement).checked;
    await setConsent(kind, granted);
  }

  async function wipe() {
    busy = true;
    try {
      const shredded = await deleteEverything();
      result = `Everything is gone. ${shredded} stored image${shredded === 1 ? '' : 's'} shredded.`;
    } finally {
      busy = false;
    }
  }
</script>

<Page
  eyebrow="Privacy"
  title="Your face stays with you."
  lede="Your skin is measured in this browser. Unless you tell me otherwise, the photo never leaves your device — only the numbers do, and only to my own server."
>
  <section class="sec sec--prose" aria-labelledby="where">
    <div class="sec__head">
      <h2 class="sec__title" id="where">Where things go</h2>
    </div>
    <div class="cols">
      <div class="card">
        <p class="card__title">On your device</p>
        <p class="card__text">
          The camera frame, the face detection, all nine measurements, and the label reader.
          None of it needs a network.
        </p>
      </div>
      <div class="card">
        <p class="card__title">On my server</p>
        <p class="card__text">
          The numbers, your profile, our conversation, and what I remember. Photos only with
          the first switch below — and encrypted if so.
        </p>
      </div>
    </div>
  </section>

  <section class="sec" aria-labelledby="choices">
    <div class="sec__head">
      <h2 class="sec__title" id="choices">Two separate choices</h2>
    </div>
    <div class="card">
      <label class="toggle">
        <input
          type="checkbox"
          checked={consents?.progress_photos ?? false}
          onchange={(e) => toggle('progress_photos', e)}
          disabled={!session.imageStorage || session.guest}
        />
        <div>
          <strong>{LEGAL_CONTENT.progress_photos.title}</strong>
          <small>
            {LEGAL_CONTENT.progress_photos.wording}
            {#if !session.imageStorage}
              Unavailable: this server has no encryption key configured, so it refuses to
              store images at all rather than store them in the clear.
            {/if}
            <br /><br />This consent never saves a capture by itself. You must affirmatively
            save each photo from its result screen.
          </small>
        </div>
      </label>

      <label class="toggle">
        <input
          type="checkbox"
          checked={consents?.cloud_reasoning ?? false}
          onchange={(e) => toggle('cloud_reasoning', e)}
          disabled={!session.modelAvailable || session.guest}
        />
        <div>
          <strong>Let me think in the cloud</strong>
          <small>
            Off by default, and nothing below happens while it is off. Turning it on lets me
            send what you type, your name, skin type, stated concerns and sensitivities,
            anything I have remembered about you, and your scan history to the model I think
            with (Anthropic). It also lets me look at a capture for qualitative observations,
            and lets my own voice speak my replies — which means the words I say are sent to
            the voice provider to be synthesised.
            <br /><br />
            With it off I still talk, still scan, still track your history — I answer from my
            own server instead, and say so. The measured numbers never depend on this either way.
            {#if !session.modelAvailable}
              Unavailable while no API key is configured.
            {/if}
          </small>
        </div>
      </label>
    </div>
  </section>

  <section class="sec" aria-labelledby="delete">
    <div class="sec__head">
      <h2 class="sec__title" id="delete">Delete everything</h2>
    </div>
    <p class="sec__lede">
      Removes your account, every scan, every message, every remembered fact, and shreds any
      stored images. There is no soft delete behind it and I cannot undo it.
    </p>
    {#if result}
      <div class="card"><p class="card__text">{result}</p></div>
    {:else if confirming}
      <div class="card card--warm">
        <p class="card__title">Are you sure?</p>
        <p class="card__text">
          This is the one thing I will ask you twice.
        </p>
        <div class="confirm__actions">
          <button class="btn btn--danger" onclick={wipe} disabled={busy}>
            {busy ? 'Deleting…' : 'Yes, delete all of it'}
          </button>
          <button class="btn" onclick={() => (confirming = false)}>Keep it</button>
        </div>
      </div>
    {:else}
      <button class="btn btn--danger" onclick={() => (confirming = true)} disabled={session.guest}>
        Delete my data
      </button>
    {/if}
  </section>
</Page>

<style>
  .confirm__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3) var(--s-5);
    margin-top: var(--s-4);
  }
</style>
