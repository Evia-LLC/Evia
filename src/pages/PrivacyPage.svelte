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
  import { setConsent } from '@/state/controller.ts';
  import { hasConsent } from '@shared/types.ts';
  import { CONSENT_KEYS } from '@shared/consent-keys.ts';

  const consents = $derived(session.user?.consents);

  async function toggle(kind: 'image_storage' | 'cloud_reasoning', event: Event) {
    const granted = (event.target as HTMLInputElement).checked;
    await setConsent(kind, granted);
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
          checked={hasConsent(consents, CONSENT_KEYS.IMAGE_STORAGE)}
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
          checked={hasConsent(consents, CONSENT_KEYS.CLOUD_REASONING)}
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

</Page>
