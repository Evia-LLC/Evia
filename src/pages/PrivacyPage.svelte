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
  import { CONSENT_KEYS } from '@shared/consent-keys.ts';
  import { LEGAL_CONTENT, approvedConsent, consentWordingVersion } from '@shared/legal-content.ts';

  const consents = $derived(session.user?.consents);

  async function toggle(kind: 'progress_photos' | 'cloud_reasoning', event: Event) {
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
          checked={approvedConsent(consents?.[CONSENT_KEYS.PROGRESS_PHOTOS])}
          onchange={(e) => toggle('progress_photos', e)}
          disabled={!session.imageStorage || session.guest || LEGAL_CONTENT['progress-photo-consent'].status !== 'approved'}
        />
        <div>
          <strong>{LEGAL_CONTENT['progress-photo-consent'].title}</strong>
          <small>
            {LEGAL_CONTENT['progress-photo-consent'].body.join(' ')}
            {#if LEGAL_CONTENT['progress-photo-consent'].status !== 'approved'}
              This option is unavailable until the consent wording is approved.
            {/if}
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
          checked={approvedConsent(consents?.[CONSENT_KEYS.CLOUD_REASONING])}
          onchange={(e) => toggle('cloud_reasoning', e)}
          disabled={!session.modelAvailable || session.guest || consentWordingVersion('cloud-reasoning-v1')?.status !== 'approved'}
        />
        <div>
          <strong>Let me think in the cloud</strong>
          <small>
            Off by default, and nothing below happens while it is off. Turning it on lets me
            send what you type, your name, skin type, stated concerns and sensitivities,
            anything I have remembered about you, and your scan history to the model I think
            with (Anthropic). It also lets my own voice speak my replies — which means the words I say are sent to
            the voice provider to be synthesised.
            <br /><br />
            With it off I still talk, still scan, still track your history — I answer from my
            own server instead, and say so. The measured numbers never depend on this either way.
            {#if !session.modelAvailable}
              Unavailable while no API key is configured.
            {/if}
            {#if consentWordingVersion('cloud-reasoning-v1')?.status !== 'approved'}
              This option is unavailable until its consent wording is approved.
            {/if}
          </small>
        </div>
      </label>
    </div>
  </section>

</Page>
