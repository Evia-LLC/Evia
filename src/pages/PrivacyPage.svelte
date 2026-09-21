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
  import { exportIntake } from '@/lib/intake.ts';

  let confirming = $state(false);
  let busy = $state(false);
  let result = $state<string | null>(null);
  let exportStatus = $state('');

  async function downloadIntake() {
    try {
      const record = await exportIntake();
      const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'ese-consultation.json'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportStatus = record.intake ? 'Your consultation export is ready.' : 'No consultation answers are saved on this account.';
    } catch { exportStatus = 'The export could not be prepared. Please try again.'; }
  }

  const consents = $derived(session.user?.consents);

  async function toggle(kind: 'image_storage' | 'cloud_reasoning', event: Event) {
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
          The numbers, your profile, our conversation, any consultation answers you chose to save, and what I remember. Photos only with
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
          checked={consents?.image_storage ?? false}
          onchange={(e) => toggle('image_storage', e)}
          disabled={!session.imageStorage || session.guest}
        />
        <div>
          <strong>Keep my scan photos</strong>
          <small>
            Stores each capture, encrypted with AES-256-GCM, so you can look back at them and
            see the measured zones drawn on your own face.
            {#if !session.imageStorage}
              Unavailable: this server has no encryption key configured, so it refuses to
              store images at all rather than store them in the clear.
            {/if}
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
            For accounts, this is off by default. While it is off, your content is not sent
            to a model or voice provider. Turning it on lets me
            send what you type, your name, skin type, stated concerns and sensitivities,
            anything I have remembered about you, and your scan history to the model I think
            with (OpenAI, or Anthropic when that server fallback is configured). It also lets me
            send a capture for optional observations about visible appearance. The text of
            spoken replies is sent to OpenAI to create an AI-generated voice.
            Camera-based estimates are not diagnoses or measurements of skin hydration.
            <br /><br />
            With it off, replies remain available as text, with local appearance estimates
            and history. I answer from my own server and say so. The image estimates never depend on this either way.
            {#if session.guest}
              As a guest, cloud reasoning is unavailable. Separately, you can opt into
              AI-generated speech on the You page; that sends reply text to OpenAI.
              Guest speech starts off and can be muted at any time.
            {/if}
            {#if !session.modelAvailable}
              Unavailable while no API key is configured.
            {/if}
          </small>
        </div>
      </label>
    </div>
  </section>

  {#if !session.guest}
    <section class="sec" aria-labelledby="intake-data">
      <div class="sec__head"><h2 class="sec__title" id="intake-data">Your consultation answers</h2></div>
      <p class="sec__lede">Saved only when you chose to save them. Detailed medications, allergies, procedures and free-text answers stay in your private account record. The welcome voice reads fixed prompts; it does not send your answers to a voice provider.</p>
      <button class="btn" type="button" onclick={downloadIntake}>Download my consultation</button>
      {#if exportStatus}<p role="status">{exportStatus}</p>{/if}
    </section>
  {/if}
  <section class="sec" aria-labelledby="delete">
    <div class="sec__head">
      <h2 class="sec__title" id="delete">Delete everything</h2>
    </div>
    <p class="sec__lede">
      Removes your account, consultation answers, every scan, every message, every remembered fact, and shreds any
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
