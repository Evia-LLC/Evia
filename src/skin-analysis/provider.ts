import type { SkinAnalysis } from "../../shared/types.ts";
import { SKIN_METRIC_KEYS } from "../../shared/types.ts";

export class FacialConsentRequired extends Error {}
/**
 * P1-T12 — face-scan client budget: provider 18 s
 * (PERFECTCORP_PROVIDER_TIMEOUT_MS in server/ai/perfectcorp.ts) < client 24 s
 * (here) < host 26 s (Netlify raised) / 30 s (Vercel maxDuration).
 * Arithmetic: the provider deadline leaves 6 s for vendor cleanup, budget
 * settle and response serialization before this client timeout fires, and
 * this timeout leaves 2–6 s for response transfer before the host kills the
 * function. Netlify's stock 10 s default must be raised to 26 s by the
 * operator; until then this aborts first and the backup notice below is the
 * honest answer instead of a hung capture.
 */
export const FACE_CLIENT_TIMEOUT_MS = 24_000;
/** The local reading stays intact unless a complete provider result is available. */
export async function selectAnalysis(
  local: SkinAnalysis,
  providerImage: string | null,
  account: boolean,
): Promise<{ analysis: SkinAnalysis; notice: string }> {
  const backup = (reason: string) => ({
    analysis: local,
    notice: `using backup analysis — ${reason}`,
  });
  let config: { provider: string; available: boolean };
  try {
    const response = await fetch("/api/public/analysis", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return backup("analysis service unavailable");
    config = await response.json();
  } catch {
    return backup("analysis service unavailable");
  }
  if (config.provider === "local")
    return { analysis: local, notice: "Local analysis selected" };
  if (!account)
    return backup("Perfect Corp requires a signed-in sample account");
  if (!config.available) return backup("Perfect Corp is not configured");
  if (!providerImage)
    return backup(
      "Perfect Corp needs a capture at least 480 pixels on its short side",
    );
  try {
    const response = await fetch("/api/analysis/face", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: providerImage }),
      signal: AbortSignal.timeout(FACE_CLIENT_TIMEOUT_MS),
    });
    if (response.status === 403 || response.status === 401)
      throw new FacialConsentRequired(
        "Your facial scan consent must be recorded before analysis. Return to the scan consent screen.",
      );
    if (!response.ok) return backup("Perfect Corp is unavailable");
    const result = await response.json();
    if (result.provider !== "perfectcorp")
      return backup("Perfect Corp is unavailable or has no trial credits");
    if (
      result.modelVersion !== "perfectcorp-v2.1" ||
      !SKIN_METRIC_KEYS.every(
        (key) =>
          typeof result.metrics?.[key] === "number" &&
          Number.isFinite(result.metrics[key]) &&
          result.metrics[key] >= 0 &&
          result.metrics[key] <= 100,
      )
    ) {
      return backup("Perfect Corp returned an incomplete result");
    }
    return {
      analysis: {
        ...local,
        metrics: result.metrics,
        regions: {},
        modelVersion: result.modelVersion,
        notes: result.notes,
      },
      notice: "Perfect Corp analysis",
    };
  } catch (error) {
    if (error instanceof FacialConsentRequired) throw error;
    return backup("Perfect Corp could not complete this capture");
  }
}
