<!--
  Settings: the hub for the pages that used to hang off the old rail - your
  profile, privacy, your data and the legal documents - in the Progress
  dashboard's language (two columns of cards, one on a phone).

  It also carries the switches that are not pages: Evia's voice and the room's
  sound (without them a guest had no way to turn the voice off at all - the
  profile page's switch saves to an account, and a guest has none), the
  sample-data switch and the character prototype's (src/character3d, off by
  default: a stand-in mannequin on the Scan page).

  The SRS section 11 controls that do not exist yet (withdrawing scan consent,
  marketing and cookie preferences, the history of accepted policy versions,
  subscription and cancellation) are listed where they will live, each marked
  "Coming soon" as plain text. None of them is a button, so nothing here
  pretends to do what the app cannot (BUILD-PLAN decision 2).

  Nothing on this page is sample data: sample mode changes only the header's
  profile pill (the shell's), and the switch that turns it off. With sample
  data on, a signed-in account is set aside (BUILD-PLAN 3.1): the account card
  shows no email or date, only the note that brings the account back, and the
  voice switch holds for the visit instead of being saved to the account.
-->
<script lang="ts">
  import { ROUTES, isLegalRoute, type RouteId } from '@/router/router.svelte.ts';
  import { session } from '@/state/session.svelte.ts';
  import { setGuestVoice, setVoiceEnabled, signOut, stopSpeaking } from '@/state/controller.ts';
  import { setSoundEnabled, soundEnabled } from '@/lib/sound.ts';
  import { sample, setSample } from '@/sample/mode.svelte.ts';
  import { characterProto, setCharacterProto } from '@/character3d/switch.svelte.ts';
  import { LEGAL_CONTENT, type LegalContentId } from '@shared/legal-content.ts';
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import Toggle from '@/ui/Toggle.svelte';
  import Button from '@/ui/Button.svelte';
  import PageFrame from './frame/PageFrame.svelte';
  import SettingsRow from './frame/SettingsRow.svelte';
  import SampleAccountNote from './frame/SampleAccountNote.svelte';

  /** Which legal record each legal address shows. */
  const LEGAL_RECORD: Partial<Record<RouteId, LegalContentId>> = {
    'legal-terms': 'terms',
    'legal-privacy': 'privacy-policy',
    'legal-facial-scan': 'facial-scan-consent',
    'legal-health': 'health-consent',
    'legal-safety-lifestyle': 'safety-lifestyle-consent',
    'legal-progress-photo': 'progress-photo-consent',
    'legal-subscription': 'subscription-disclosure',
    'legal-cancellation': 'cancellation',
  };

  const legal = ROUTES.filter((r) => isLegalRoute(r.id)).map((route) => {
    const record = LEGAL_RECORD[route.id];
    const content = record ? LEGAL_CONTENT[record] : null;
    return {
      route,
      title: content?.title ?? route.label,
      audience: content?.applicability.audience,
      draft: content ? content.status !== 'approved' : true,
    };
  });

  // What is actually true right now: on, and able to speak.
  const voiceOn = $derived(Boolean(session.user?.preferences.voiceEnabled) && session.canSpeak);
  let sound = $state(soundEnabled());

  /** A signed-in account while sample data is on: set aside, not shown. */
  const setAside = $derived(sample.on && !session.guest);

  const since = $derived(
    session.user?.createdAt
      ? new Date(session.user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : null,
  );

  /** A preference on an account, a session flag for a guest; off stops her mid-sentence. */
  function setVoice(on: boolean) {
    if (session.guest) setGuestVoice(on);
    else void setVoiceEnabled(on);
    if (!on) stopSpeaking();
  }

  function setSound(on: boolean) {
    sound = on;
    setSoundEnabled(on);
  }

  const voiceNote = $derived(
    !session.canSpeak
      ? 'This browser cannot speak and no voice is configured, so Evia stays quiet here.'
      : session.guest
        ? 'For this visit only. Nothing is saved while you are looking around.'
        : sample.on
          ? 'For this visit only. Nothing is saved while sample data is on.'
          : 'Remembered on your account.',
  );
</script>

<PageFrame title="Settings" subtitle="Your profile, your privacy choices and your data, in one place.">
  <div class="settings">
    <div class="settings__col">
      <Card aria-labelledby="set-account">
        <SectionHeader id="set-account" title="Account" icon="user" />
        {#if setAside}
          <SampleAccountNote class="account-note" action="see your account or sign out" />
        {:else}
          <div class="account">
            {#if session.guest}
              <p class="account__who">{sample.on ? 'Sample preview' : 'Looking around'}</p>
              <p class="account__meta">No account. Nothing is saved when you leave.</p>
            {:else}
              <p class="account__who">{session.user?.email}</p>
              {#if since}<p class="account__meta">Member since {since}</p>{/if}
            {/if}
            <Button variant="secondary" size="sm" onclick={() => signOut()}>
              {session.guest ? 'Leave' : 'Sign out'}
            </Button>
          </div>
        {/if}
        <ul class="rows" role="list">
          <SettingsRow
            href="/profile"
            icon="user"
            title="Profile"
            description="Your skin, the pregnancy question, how Evia explains things, and what it remembers."
          />
          <SettingsRow
            status="soon"
            icon="calendar"
            title="Subscription and billing"
            description="There is no subscription yet. Plans, billing and cancellation will be managed here."
          />
        </ul>
      </Card>

      <Card aria-labelledby="set-voice">
        <SectionHeader id="set-voice" title="Voice, sound and display" icon="messages" />
        <div class="toggles">
          <!-- When the switch is disabled it dims its own row, so the reason
               is said beside it instead, at full contrast. -->
          <div class="toggle-with-note">
            <Toggle
              label="Evia's voice"
              description={session.canSpeak ? voiceNote : undefined}
              checked={voiceOn}
              disabled={!session.canSpeak}
              onchange={setVoice}
            />
            {#if !session.canSpeak}<p class="toggle-note">{voiceNote}</p>{/if}
          </div>
          <Toggle
            label="Room sound"
            description="The room tone and the small cues. Remembered on this device."
            checked={sound}
            onchange={setSound}
          />
          <Toggle
            label="Sample data"
            description="Fill every page with the design's sample data, labelled on screen the whole time. While it is on, no account data is shown and nothing is saved."
            checked={sample.on}
            onchange={(on) => setSample(on)}
          />
          <Toggle
            label="Character prototype"
            description="A prototype stand-in (a plain mannequin, not Evia) beside the Scan hologram, looking at and pointing to each region. Off by default; large screens only. Remembered on this device when Functional cookies are allowed, otherwise for this visit."
            checked={characterProto.on}
            onchange={(on) => setCharacterProto(on)}
          />
        </div>
      </Card>
    </div>

    <div class="settings__col">
      <Card aria-labelledby="set-privacy">
        <SectionHeader id="set-privacy" title="Privacy and your data" icon="shield" />
        <ul class="rows" role="list">
          <SettingsRow
            href="/privacy"
            icon="lock"
            title="Privacy"
            description="Progress photos and cloud reasoning: two separate choices, both off by default."
          />
          <SettingsRow
            href="/settings/data"
            icon="droplet"
            title="Your data"
            description="Download a copy of your data, or delete your account."
          />
          <SettingsRow
            status="soon"
            icon="camera"
            title="Withdraw facial-scan consent"
            description="Turn scanning off, with a clear account of which features stop and what is deleted, and when."
          />
          <SettingsRow
            status="soon"
            icon="bell"
            title="Marketing preferences"
            description="Choose what, if anything, Evia may send you."
          />
          <SettingsRow
            status="soon"
            icon="sliders"
            title="Cookie preferences"
            description="Accept, reject or manage non-essential cookies."
          />
          <SettingsRow
            status="soon"
            icon="clipboard-list"
            title="Policy history"
            description="The policy and consent versions you have accepted, with their dates."
          />
        </ul>
      </Card>

      <Card aria-labelledby="set-legal">
        <SectionHeader
          id="set-legal"
          title="Legal documents"
          icon="book-open"
          subtitle="Drafts for review. None of them is accepted by using the app."
        />
        <ul class="rows" role="list">
          {#each legal as doc (doc.route.id)}
            <SettingsRow href={doc.route.path} title={doc.title} description={doc.audience} tag={doc.draft ? 'Draft' : undefined} />
          {/each}
        </ul>
      </Card>
    </div>
  </div>
</PageFrame>

<style>
  .settings {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }
  .settings__col {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  @media (max-width: 1023px) {
    .settings {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .rows {
    margin: 12px 0 0;
    padding: 0;
  }

  .settings :global(.account-note) {
    margin: 18px 0 4px;
  }
  .account {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 2px 16px;
    margin: 18px 0 4px;
    padding: 14px 16px;
    border-radius: var(--r-md);
    background: var(--surface-sunken);
  }
  .account__who {
    grid-column: 1;
    margin: 0;
    font-size: var(--fs-label);
    font-weight: var(--fw-semibold);
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }
  .account__meta {
    grid-column: 1;
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }
  .account :global(.ev-btn) {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  .toggles {
    display: grid;
    gap: 14px;
    margin-top: 18px;
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
</style>
