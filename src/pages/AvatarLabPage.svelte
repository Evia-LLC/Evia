<script lang="ts">
  import { onDestroy } from 'svelte';

  type TalkMessageStream = {
    streamMessageChunk(content: string, endOfSpeech: boolean): Promise<void>;
    endMessage(): Promise<void>;
    isActive(): boolean;
  };

  type AnamClient = {
    streamToVideoElement(elementId: string): Promise<void>;
    createTalkMessageStream(correlationId?: string): TalkMessageStream;
    stopStreaming(): Promise<void>;
    isStreaming(): boolean;
  };

  type AnamSdk = {
    createClient(
      sessionToken: string,
      options?: { disableInputAudio?: boolean },
    ): AnamClient;
  };

  let client: AnamClient | null = null;
  let status = $state<'idle' | 'connecting' | 'ready' | 'speaking' | 'error'>('idle');
  let text = $state('Hello — this is Elohim speaking live through Anam.');
  let error = $state('');

  async function loadAnamSdk(): Promise<AnamSdk> {
    // Official Anam quickstart uses esm.sh for a no-install browser experiment.
    // Pin this to an npm dependency before production rollout.
    const sdkUrl = 'https://esm.sh/@anam-ai/js-sdk@latest';
    return (await import(/* @vite-ignore */ sdkUrl)) as AnamSdk;
  }

  async function start(): Promise<void> {
    if (client?.isStreaming()) return;
    status = 'connecting';
    error = '';

    try {
      const response = await fetch('/api/avatar-lab/session-token', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = (await response.json()) as { sessionToken?: string; error?: string };
      if (!response.ok || !body.sessionToken) {
        throw new Error(body.error || 'Could not create an avatar session.');
      }

      const { createClient } = await loadAnamSdk();
      client = createClient(body.sessionToken, { disableInputAudio: true });
      await client.streamToVideoElement('avatar-lab-video');
      status = 'ready';
    } catch (cause) {
      status = 'error';
      error = cause instanceof Error ? cause.message : 'Avatar connection failed.';
    }
  }

  /**
   * Replace this generator with your real LLM stream (SSE/fetch reader/WebSocket).
   * The avatar plumbing below already accepts incremental text chunks.
   */
  async function* streamLlmReply(prompt: string): AsyncGenerator<string> {
    for (const chunk of prompt.match(/\S+\s*/g) ?? [prompt]) {
      await new Promise((resolve) => setTimeout(resolve, 45));
      yield chunk;
    }
  }

  async function speak(): Promise<void> {
    const line = text.trim();
    if (!line) return;
    if (!client?.isStreaming()) await start();
    if (!client?.isStreaming()) return;

    status = 'speaking';
    error = '';

    try {
      const stream = client.createTalkMessageStream(crypto.randomUUID());
      for await (const chunk of streamLlmReply(line)) {
        if (!stream.isActive()) break;
        await stream.streamMessageChunk(chunk, false);
      }
      if (stream.isActive()) await stream.endMessage();
      status = 'ready';
    } catch (cause) {
      status = 'error';
      error = cause instanceof Error ? cause.message : 'Could not send text to the avatar.';
    }
  }

  onDestroy(() => {
    if (client?.isStreaming()) void client.stopStreaming();
  });
</script>

<section class="avatar-lab">
  <header>
    <p class="eyebrow">EXPERIMENT · ANAM LIVE AVATAR</p>
    <h1>Text → live talking avatar</h1>
    <p>Server-issued session token, WebRTC video, and chunked text input for an LLM stream.</p>
  </header>

  <div class="stage">
    <video id="avatar-lab-video" autoplay playsinline></video>
    {#if status === 'idle'}
      <button class="start" onclick={start}>Start live session</button>
    {/if}
  </div>

  <form onsubmit={(event) => { event.preventDefault(); void speak(); }}>
    <label for="avatar-text">Text to speak</label>
    <textarea id="avatar-text" bind:value={text} rows="4"></textarea>
    <div class="controls">
      <button type="button" onclick={start} disabled={status === 'connecting' || status === 'ready' || status === 'speaking'}>
        {status === 'connecting' ? 'Connecting…' : 'Connect'}
      </button>
      <button type="submit" disabled={status === 'connecting' || status === 'speaking'}>
        {status === 'speaking' ? 'Speaking…' : 'Speak'}
      </button>
      <span class="status" data-state={status}>{status}</span>
    </div>
    {#if error}<p class="error">{error}</p>{/if}
  </form>
</section>

<style>
  .avatar-lab {
    position: fixed;
    inset: 0;
    z-index: 40;
    overflow: auto;
    padding: clamp(72px, 8vw, 108px) clamp(20px, 5vw, 72px) 48px;
    background: rgba(9, 11, 14, 0.94);
    color: #f7f4ef;
  }
  header, form, .stage { width: min(760px, 100%); margin-inline: auto; }
  header { margin-bottom: 22px; }
  h1 { margin: 4px 0 8px; font-size: clamp(30px, 5vw, 54px); }
  header p { max-width: 680px; color: #c7cbd0; }
  .eyebrow { letter-spacing: .14em; font-size: 12px; }
  .stage {
    position: relative;
    aspect-ratio: 3 / 2;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,.16);
    border-radius: 18px;
    background: #050607;
  }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .start { position: absolute; inset: auto 50% 24px auto; transform: translateX(50%); }
  form { margin-top: 20px; display: grid; gap: 10px; }
  label { font-size: 13px; color: #c7cbd0; }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    border: 1px solid rgba(255,255,255,.16);
    border-radius: 12px;
    padding: 14px;
    background: rgba(255,255,255,.06);
    color: inherit;
    font: inherit;
  }
  .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  button {
    border: 0;
    border-radius: 999px;
    padding: 10px 18px;
    font: inherit;
    cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: default; }
  .status { margin-left: auto; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #aeb4bb; }
  .error { color: #ffb5b5; margin: 0; }
</style>
