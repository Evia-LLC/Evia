# Counsel review: Home page and the chat drawer

Page: `/` (`src/pages/HomePage.svelte`, `src/pages/home/*`, `src/view/home.ts`,
`src/sample/fixtures/home.ts`) and the conversation drawer opened from it (`src/chat/*`).
Reference: `ref1.png`, left-hand panel (specs/home.md sections 7-8, data-map.md section 2).

Two modes:

- **Sample mode** (`?sample=1` or "Preview with sample data"): the mockup's own words, verbatim, with
  the "Sample data" badge pinned top-centre the whole time. No person anywhere: the tip card's
  portrait tile shows the "evia" wordmark, the avatar is initials, the armchair is empty
  (BUILD-PLAN decision 3).
- **Real mode**: only what the app has. The account's display name as typed at sign-up (or no name),
  the local clock's salutation, no membership line, no notification badge, and a tip from the short
  fixed list in section 4. Home shows no score, measurement or analysis value in either mode.

Nothing below has been reworded silently. Every flagged string is shown as it appears, and where real
mode shows something else, that wording is listed too so counsel can approve or change it.

## 1. Fixed brand and decor copy (the same in both modes)

| Element | Shown (both modes) | SRS / concern |
|---|---|---|
| Bottom tagline | "WELLNESS \| CONFIDENCE \| LONG-TERM SKIN HEALTH" (desktop and tablet; left out on phones for space) | MED-01, §10, checklist #13: "skin health" positions a cosmetic service on a health outcome. Swap for non-health wording if counsel prefers (e.g. "WELLNESS \| CONFIDENCE \| CONSISTENT CARE"). |
| Wall niche text, drawn on the room render | "REAL INSIGHTS" / "REAL PROGRESS" / "A BRIGHTER YOU" | §5 ("no arbitrary scores", findings are cosmetic observations): "real insights" suggests evidential analysis. "Progress" depends on repeat scans, and on progress photos only if the user opts in (CNS-04). Checklist #13. |
| Acrylic sign text, drawn on the room render | "CONFIDENCE" / "LOOKS GOOD" / "ON YOU" | Checklist #13 (marketing copy). Low risk. |
| "A BRIGHTER YOU" (wall) and the sidebar logo line "YOUR SKIN. A BRIGHTER YOU." (shell, shown on Home) | as written | Cosmetic efficacy claim. "Brighter" can also be read as skin lightening. Brand and counsel review (checklist #13). The logo line belongs to the shared sidebar (`src/shell/Logo.svelte`). |
| Question under the greeting | "How’s your skin" / "feeling today?" | §9, ADS-01: whatever the user answers in chat is consultation data. It goes only to the conversation. Home loads no analytics or advertising technology. MED-01: replies must stay non-diagnostic. Today that rests on her instructions (`server/ai/persona.ts`, `server/ai/claude.ts`), not on a separate output filter; MED-01 asks for safety tests. |

The wall and sign text is HTML placed on the render's blank niche and acrylic surfaces
(`public/env/lounge/anchors.json`), so it can be changed or removed without re-rendering the room.

## 2. Greeting and header

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Salutation | "Good afternoon," (fixed, the mockup's) | From the local clock: "Good morning," / "Good afternoon," / "Good evening," / "Still up," (00:00-04:59). With no name, it ends with a full stop and stands alone ("Good evening."). | none |
| Name, large serif | "Destiny." | The account's display name as typed at sign-up, plus a full stop. No name is shown for a guest or for an account that left the name empty (the app stores "friend" / "there" for those). | none (data-map §2: no separate first-name field) |
| Profile pill name | "Destiny" | Display name; "Guest" for a guest; "Your profile" when there is no name | none |
| Membership line | "Premium Member" | **Hidden.** The app has no subscription data. | §8 / PAY-01: there is a single paid plan with no free tier or trial, so "Premium" implies a tier that does not exist. A real status label needs counsel-approved wording before it is added. |
| Avatar | Initials "D" on the pink tile, no photo | Initials of the display name, no photo | CNS-04, RET-01, AI-01: never a scan frame. No profile-photo upload exists. |
| Notification bell | No badge | No badge (the app has no notification feed) | none |

## 3. "Talk to Evia" and the AI disclosure

| Element | Both modes | SRS |
|---|---|---|
| CTA | "Talk to Evia" opens the conversation drawer. When she has said something the user has not seen, a dot appears and the accessible name becomes "Talk to Evia, new message". | §6 |
| Disclosure on Home | Directly under the CTA: "Evia is an AI. General skincare guidance, not medical advice." | §6: persistent consultation disclosure |
| Disclosure in the drawer | The same sentence under the drawer's title, visible for as long as the drawer is open, on every screen size | §6 |
| Real-mode shortcuts (not in the mockup) | Real mode only: "Start a scan" (goes to `/scan`, where the existing age, guardian and consent gates apply) and, once a scan exists, "See what changed" (goes to `/progress`). These replace the old Home's "Let me look" and "What changed". | AGE-01, GDN-01, CNS-01/02 (applied on the Scan page) |

## 4. Tip card

| Element | Sample mode shows | Real mode shows instead | SRS |
|---|---|---|---|
| Title | "A quick tip from Evia" | the same | none |
| Tip | "Your evening routine matters too — consistency is key." | One line a day from the fixed list below (`src/pages/home/tips.ts`), picked by date, the same all day. The list is general and cosmetic. It names no condition, makes no efficacy claim and is not personalised from any reading. | MED-01, §10 |
| Portrait tile | The pink tile with the "evia" wordmark, no face | the same | decision 3 |
| Play button | Speaks the tip with her voice through the voice controller (text-to-speech), the same way her replies are spoken. It is never a recording. When her voice is off, the card says "Voice is off." with a "Turn it on" button, in place of the title line. When nothing can speak it, the card says "Evia can’t read this tip aloud right now." | the same | §6: "dynamic TTS ... rather than prerecorded conversational clips" |

The real-mode tip list, verbatim (please approve, change or strike lines):

1. Your evening routine matters too — consistency is key.
2. Put sunscreen on every morning, even when it’s cloudy.
3. Pat your skin dry after cleansing rather than rubbing it.
4. Try one new product at a time, so you can tell what suits you.
5. Patch-test a new product on a small area before using it all over. (echoes §10's "patch test")
6. Lukewarm water is gentler than hot when you wash your face.
7. Give a new routine a few weeks before you judge it.
8. Wash your pillowcases and make-up brushes regularly.

Line 2 is sun-protection advice. It is general, but please confirm it is acceptable wording for a
non-medical service.

## 5. Chat drawer copy

| Element | Both modes | SRS |
|---|---|---|
| Title | "Talk to Evia" | none |
| Empty conversation | "Ask me anything about your skin or your routine." with three starters: "What should my evening routine look like?", "How do I choose a sunscreen?" and "Can you take a look at my skin?" | MED-01: the starters are general. The third leads to her offering a scan. |
| Scan offer (existing) | "Want me to take a proper look?" with a "Start a scan" button, which goes to the Scan page and its consent gates | CNS-01/02 |
| Speaking strip | "Evia is speaking" with a "Stop" button | none |
| "New from Evia" | A button that appears when she replies while you are reading further up the conversation; it jumps to the end | none |
| Sample mode | With an account signed in and sample mode on, the conversation does not show that account's stored transcript. It starts empty (the starters above), and only lines said since sample mode came on are shown. Nothing is deleted: the stored transcript returns when sample mode goes off. | none (see section 6) |
| Composer | Placeholder "Message Evia…", or "Listening…" while the microphone is on. The live transcript shows in the box before it is sent. | §9: speech-to-text content is consultation data (not sent to analytics) |
| Errors | The server's own message, shown as an alert in the transcript | none |

## 6. For the lead (not a counsel item)

Fixed in this lane: when a signed-in account turns sample mode on, the drawer no longer shows that
account's stored transcript beside the "Destiny" sample greeting (`src/chat/transcript.ts`,
`shownMessages()` in `src/chat/drawer.svelte.ts`).

Still open, outside this lane: her replies in a sample visit come from the controller's local engine,
and it reads the signed-in account's real context (`guestContext()` in `src/lib/local-engine.ts` uses
`session.user`, `session.latestScan` and `session.scans`). So a sample-mode reply can quote the
account's real readings, for example "hydration's sitting at 64", and mention its real concerns. That
is real data, not invented data, but it sits beside the sample screen. Whether a sample visit should
answer from the sample fixtures, or from no readings at all, is a controller decision
(`src/state/controller.ts` / `src/lib/local-engine.ts`).
