import { asyncRouter } from '../lib/async-router.ts';
import { requireAuth } from './auth.ts';

export const avatarLabRouter = asyncRouter();
avatarLabRouter.use(requireAuth);

avatarLabRouter.post('/session-token', async (_req, res) => {
  const apiKey = process.env.ANAM_API_KEY;
  const avatarId = process.env.ANAM_AVATAR_ID;
  const voiceId = process.env.ANAM_VOICE_ID;

  if (!apiKey || !avatarId || !voiceId) {
    res.status(503).json({
      error: 'Anam avatar lab is not configured. Set ANAM_API_KEY, ANAM_AVATAR_ID and ANAM_VOICE_ID.',
    });
    return;
  }

  try {
    const response = await fetch('https://api.anam.ai/v1/auth/session-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personaConfig: {
          name: 'Elohim avatar lab',
          avatarId,
          avatarModel: process.env.ANAM_AVATAR_MODEL || 'cara-4',
          voiceId,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('Anam session token failed', response.status, detail.slice(0, 500));
      res.status(502).json({ error: 'Anam session token creation failed.' });
      return;
    }

    const body = (await response.json()) as { sessionToken?: string };
    if (!body.sessionToken) {
      res.status(502).json({ error: 'Anam returned no session token.' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({ sessionToken: body.sessionToken });
  } catch (error) {
    console.error('Anam session token network error', error);
    res.status(502).json({ error: 'Could not reach Anam.' });
  }
});
