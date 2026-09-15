/**
 * The model budget.
 *
 * Cloud reasoning costs money per token and the app has a public front door.
 * Without a ledger the only limit on spend is how fast people can type, which
 * is not a limit. This keeps one row per user per day and answers two
 * questions before any call is made: has this person had their share today,
 * and has everyone.
 *
 * Over budget is not an error. She keeps talking, from the local engine, and
 * the turn is marked `demo` the same way it is when there is no key at all -
 * the interface already knows how to say she is answering locally. What must
 * never happen is a silent bill, so the check runs before the call and the
 * usage is recorded after it, from the numbers the API actually reported.
 *
 * Limits come from the environment and have conservative defaults:
 *
 *   ELOHIM_USER_DAILY_TURNS   turns per user per day            (default 80)
 *   ELOHIM_DAILY_TURNS        turns across everyone per day     (default 2000)
 *   ELOHIM_DAILY_TOKENS       tokens across everyone per day    (default 4,000,000)
 *
 * Prices are estimates for the cost line in the health report, not the source
 * of truth for any decision - the token counts are.
 */
import { row, run } from '../db/index.ts';
import { log } from '../lib/log.ts';

function limit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export interface BudgetVerdict {
  ok: boolean;
  /** Why not, in a form the log can carry. Empty when ok. */
  reason: '' | 'user_turns' | 'global_turns' | 'global_tokens';
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Whether a model call may be made right now for this user. */
export async function allowance(userId: string): Promise<BudgetVerdict> {
  const day = today();
  try {
    const [mine, everyone] = await Promise.all([
      row<{ turns: number }>(
        'SELECT turns FROM usage_ledger WHERE day = ? AND user_id = ?',
        day,
        userId,
      ),
      row<{ turns: string | number; tokens: string | number }>(
        `SELECT coalesce(sum(turns), 0) AS turns,
                coalesce(sum(input_tokens + output_tokens), 0) AS tokens
           FROM usage_ledger WHERE day = ?`,
        day,
      ),
    ]);
    if ((mine?.turns ?? 0) >= limit('ELOHIM_USER_DAILY_TURNS', 80)) {
      return { ok: false, reason: 'user_turns' };
    }
    if (Number(everyone?.turns ?? 0) >= limit('ELOHIM_DAILY_TURNS', 2000)) {
      return { ok: false, reason: 'global_turns' };
    }
    if (Number(everyone?.tokens ?? 0) >= limit('ELOHIM_DAILY_TOKENS', 4_000_000)) {
      return { ok: false, reason: 'global_tokens' };
    }
    return { ok: true, reason: '' };
  } catch (err) {
    // A ledger that cannot be read must not become an open tab. Deny.
    log.error('budget', 'ledger unreadable; denying the model call', {
      error: (err as Error).message,
    });
    return { ok: false, reason: 'global_tokens' };
  }
}

/** Records what a call actually cost, from the usage the API reported. */
export async function record(
  userId: string,
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): Promise<void> {
  const input = usage.input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  try {
    await run(
      `INSERT INTO usage_ledger (day, user_id, turns, input_tokens, output_tokens, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT (day, user_id) DO UPDATE SET
         turns = usage_ledger.turns + 1,
         input_tokens = usage_ledger.input_tokens + EXCLUDED.input_tokens,
         output_tokens = usage_ledger.output_tokens + EXCLUDED.output_tokens,
         updated_at = EXCLUDED.updated_at`,
      today(),
      userId,
      input,
      usage.output,
      new Date().toISOString(),
    );
  } catch (err) {
    log.error('budget', 'could not record usage', { error: (err as Error).message });
  }
}

/** Today so far, for the health report. */
export async function todaySummary(): Promise<{
  turns: number;
  tokens: number;
  limits: { userTurns: number; turns: number; tokens: number };
}> {
  const found = await row<{ turns: string | number; tokens: string | number }>(
    `SELECT coalesce(sum(turns), 0) AS turns,
            coalesce(sum(input_tokens + output_tokens), 0) AS tokens
       FROM usage_ledger WHERE day = ?`,
    today(),
  ).catch(() => undefined);
  return {
    turns: Number(found?.turns ?? 0),
    tokens: Number(found?.tokens ?? 0),
    limits: {
      userTurns: limit('ELOHIM_USER_DAILY_TURNS', 80),
      turns: limit('ELOHIM_DAILY_TURNS', 2000),
      tokens: limit('ELOHIM_DAILY_TOKENS', 4_000_000),
    },
  };
}
