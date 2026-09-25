<!--
  Privacy, stated plainly (ARCHITECTURE section 10), in the dashboard's
  language: where things go, then the two separate choices.

  Both consents default to off and are asked for separately, because storing
  a face and sending a face to a third party are different decisions, and
  bundling them into one switch would be the dishonest design.

  A switch is only live when its wording is approved (and the server can do
  what it promises); until then it is disabled and says why, and the reasons
  are the same checks the old page made. The progress-photo switch shows the
  consent record's own title and body, unedited. The cloud-reasoning text is
  the disclosure of what would be sent, kept word for word.

  With sample data on, a signed-in account is set aside (BUILD-PLAN 3.1): the
  switches show nothing recorded and cannot record anything, the account's
  saved photos are not counted, and the note offers the way back.
-->
<script lang="ts">
  import { session } from '@/state/session.svelte.ts';
  import { sample } from '@/sample/mode.svelte.ts';
  import { setConsent } from '@/state/controller.ts';
  import { link } from '@/router/router.svelte.ts';
  import { CONSENT_KEYS } from '@shared/consent-keys.ts';
  import { LEGAL_CONTENT, approvedConsent, consentWordingVersion } from '@shared/legal-content.ts';
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import Toggle from '@/ui/Toggle.svelte';
  import Pill from '@/ui/Pill.svelte';
  import Icon from '@/ui/Icon.svelte';
  import PageFrame from './frame/PageFrame.svelte';
  import SampleAccountNote from './frame/SampleAccountNote.svelte';

  /** No account to record on: a guest, or an account set aside for sample data. */
  const accountless = $derived(session.guest || sample.on);
  const consents = $derived(accountless ? undefined : session.user?.consents);
  const photoConsent = LEGAL_CONTENT['progress-photo-consent'];
  // The wording sits beside the switch rather than inside it: a disabled
  // switch dims its own row, and the words have to stay readable either way.

  const photosOn = $derived(approvedConsent(consents?.[CONSENT_KEYS.PROGRESS_PHOTOS]));
  const cloudOn = $derived(approvedConsent(consents?.[CONSENT_KEYS.CLOUD_REASONING]));
  const photoWordingApproved = photoConsent.status === 'approved';
  const cloudWordingApproved = consentWordingVersion('cloud-reasoning-v1')?.status === 'approved';

  const photosDisabled = $derived(!session.imageStorage || accountless || !photoWordingApproved);
  const cloudDisabled = $derived(!session.modelAvailable || accountless || !cloudWordingApproved);

  let error = $state<string | null>(null);
  /** Bumped after a failed save, so a switch redraws from the recorded state. */
  let resync = $state(0);

  async function toggle(kind: 'progress_photos' | 'cloud_reasoning', granted: boolean) {
    if (accountless) return;
    error = null;
    try {
      await setConsent(kind, granted);
    } catch (err) {
      error = err instanceof Error ? err.message : 'That choice could not be recorded.';
      resync += 1;
    }
  }
</script>

<PageFrame
  title="Privacy"
  subtitle="Your skin is measured in this browser. Unless you choose otherwise, the photo never leaves your device — only the numbers do, and only to Evia's own server."
  back={{ href: '/settings', label: 'Settings' }}
>
  {#if sample.on && !session.guest}<SampleAccountNote action="see and change your choices" />{/if}

  <section class="where" aria-labelledby="priv-where">
    <h2 class="visually-hidden" id="priv-where">Where things go</h2>
    <Card>
      <SectionHeader title="On your device" icon="camera" level={3} />
      <p class="where__text">
        The camera frame, the face detection, all nine measurements, and the label reader. None of it needs a network.
      </p>
    </Card>
    <Card>
      <SectionHeader title="On Evia's server" icon="lock" level={3} />
      <p class="where__text">
        The numbers, your profile, your conversation, and what Evia remembers. Photos only with the first switch
        below — and encrypted if so.
      </p>
    </Card>
  </section>

  <Card aria-labelledby="priv-choices">
    <SectionHeader
      id="priv-choices"
      title="Two separate choices"
      icon="shield"
      subtitle="Both are off by default. Neither one turns the other on."
    />

    <div class="choice">
      {#key resync}
        <Toggle
          label={photoConsent.title}
          checked={photosOn}
          disabled={photosDisabled}
          onchange={(on) => toggle('progress_photos', on)}
        />
      {/key}
      <div class="choice__body">
        <p>{photoConsent.body.join(' ')}</p>
      </div>
      <ul class="choice__notes" role="list">
        {#if !photoWordingApproved}
          <li class="note note--hold">
            <Icon name="lock" size={16} stroke={1.8} />
            <span>This option is unavailable until the consent wording is approved.</span>
          </li>
        {/if}
        {#if !session.imageStorage}
          <li class="note note--hold">
            <Icon name="lock" size={16} stroke={1.8} />
            <span>
              Unavailable: this server has no encryption key configured, so it refuses to store images at all rather
              than store them in the clear.
            </span>
          </li>
        {/if}
        {#if session.guest}
          <li class="note note--hold">
            <Icon name="info" size={16} stroke={1.8} />
            <span>Consents belong to an account. There is nothing to record while you are looking around.</span>
          </li>
        {/if}
        <li class="note">
          <Icon name="info" size={16} stroke={1.8} />
          <span>This consent never saves a capture by itself. You must affirmatively save each photo from its result screen.</span>
        </li>
        {#if !accountless && session.progressPhotos.length}
          <li class="note">
            <Icon name="info" size={16} stroke={1.8} />
            <span>
              You have {session.progressPhotos.length} saved progress photo{session.progressPhotos.length === 1 ? '' : 's'}.
              Delete any of them from <a href="/progress" use:link>Progress</a>.
            </span>
          </li>
        {/if}
        <li class="note">
          <Icon name="book-open" size={16} stroke={1.8} />
          <span>Read the <a href="/legal/progress-photo-consent" use:link>progress photo consent</a> draft.</span>
        </li>
      </ul>
    </div>

    <div class="choice">
      {#key resync}
        <Toggle
          label="Let me think in the cloud"
          checked={cloudOn}
          disabled={cloudDisabled}
          onchange={(on) => toggle('cloud_reasoning', on)}
        />
      {/key}
      <div class="choice__body">
        <p>Off by default, and nothing below happens while it is off.</p>
        <p>
          Turning it on lets me send what you type, your name, skin type, stated concerns and sensitivities, anything I
          have remembered about you, and your scan history to the model I think with (Anthropic). It also lets my own
          voice speak my replies — which means the words I say are sent to the voice provider to be synthesised.
        </p>
        <p>
          With it off I still talk, still scan, still track your history — I answer from my own server instead, and say
          so. The measured numbers never depend on this either way.
        </p>
      </div>
      <ul class="choice__notes" role="list">
        {#if !session.modelAvailable}
          <li class="note note--hold">
            <Icon name="lock" size={16} stroke={1.8} />
            <span>Unavailable while no API key is configured.</span>
          </li>
        {/if}
        {#if !cloudWordingApproved}
          <li class="note note--hold">
            <Icon name="lock" size={16} stroke={1.8} />
            <span>This option is unavailable until its consent wording is approved.</span>
          </li>
        {/if}
      </ul>
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="status">
      <Pill size="sm" tone={photosOn ? 'sage' : 'neutral'} dot>Progress photos {photosOn ? 'on' : 'off'}</Pill>
      <Pill size="sm" tone={cloudOn ? 'sage' : 'neutral'} dot>Cloud reasoning {cloudOn ? 'on' : 'off'}</Pill>
    </div>
  </Card>
</PageFrame>

<style>
  .where {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  @media (max-width: 819px) {
    .where {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .where__text {
    margin: 14px 0 0;
    max-width: 34em; /* about 70-75 characters in this font; see LegalDocument */
    font-size: var(--fs-body);
    line-height: var(--lh-relaxed);
    color: var(--text);
  }

  .choice {
    display: grid;
    gap: 12px;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--divider);
  }
  .choice__body {
    display: grid;
    gap: 10px;
  }
  /* The measure sits on the paragraph so its em is the paragraph's own size;
     on the wrapper it resolved against the larger card text. */
  .choice__body p {
    max-width: 34em; /* about 70-75 characters in this font; see LegalDocument */
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-relaxed);
    color: var(--text-secondary);
  }
  .choice__notes {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
  }
  .note {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    max-width: 34em; /* about 70-75 characters in this font; see LegalDocument */
    list-style: none;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }
  .note :global(.icon) {
    flex: none;
    margin-top: 2px;
    color: var(--terracotta-500);
  }
  .note--hold {
    color: var(--amber-900);
  }
  .note--hold :global(.icon) {
    color: var(--amber-900);
  }
  /* Inline padding widens the tap area to 44px tall without moving the line:
     vertical padding on an inline box does not change the line box. */
  .note a {
    padding-block: 13px;
    color: var(--text-link);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }

  .error {
    margin: 16px 0 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-danger);
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 20px;
  }
</style>
