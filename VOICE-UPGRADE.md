# Voice privacy upgrade

OpenAI speech now starts off for guests and requires explicit opt-in in Profile. Account speech requires cloud-processing consent; turning that consent off stops audio and clears the browser's decoded audio cache. Voice is AI-generated. Word timing is estimated from clip duration; the waveform gates mouth movement.

Only exact public scripted lines from `src/lib/lines.ts` may enter the shared durable `voice_lines` cache. Personal replies bypass both reads and writes to that table. Concurrent requests may share an in-flight synthesis; decoded personal audio is held only in the browser session and cleared on identity changes, voice-off, consent withdrawal, sign-out, or account deletion.

Existing deployments need a deliberate cleanup before relying on the new retention behavior. Earlier versions stored arbitrary reply text and audio in `voice_lines`, without user ownership; account deletion cannot identify those old rows. Review and remove the legacy voice cache from the deployed database and address retained backups under the deployment's retention policy. Clearing the whole voice cache is the simplest option: public scripted audio will regenerate. This code change does not delete any existing database rows or backups.

Opt-in still sends the reply text to OpenAI. This application cache policy does not change OpenAI's service-side retention settings or the separate storage of account chat and scans. No API key belongs in browser code or committed environment files.
