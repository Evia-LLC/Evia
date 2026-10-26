/**
 * P1-T14 — Perfect Corp correctness release gate: polarity evidence matrix.
 *
 * SCOPE (docs/REMEDIATION_PLAN.md P1-T14): reconcile the utilisation audit's
 * contested polarity claims with the current mapper, client, UI and
 * recommendation consumers. New vendor features/masks/geometry are out of
 * scope. No live capture, no paid vendor requests — fixtures only.
 *
 * AUTHORITATIVE VENDOR EVIDENCE (in-repo, not audit headings):
 * - `.spec/current.json → agents.synthesis-perfect-corp → metrics_catalog`:
 *   1-100 concern scores where HIGHER IS BETTER for skin concerns
 *   (research-api-server field semantics: "a low 'acne' score means worse
 *   acne"; FAQ: `all.score` "higher indicates healthier skin"; ui_score is
 *   "calibrated for positive consumer sentiment ... to instill greater
 *   confidence in users").
 * - OPEN QUESTION Q1 (same synthesis, claim_class `conflict`): no per-action
 *   polarity flag exists in any vendor schema, and written per-concern
 *   confirmation from Perfect Corp is still pending. The global direction is
 *   documented; the per-action written confirmation is not.
 *
 * CURRENT IMPLEMENTATION (characterised, not changed, by this file):
 * - `server/ai/perfectcorp.ts → mapPerfectCorpOutput` passes `ui_score`
 *   through unchanged into `SkinAppearanceMetrics`, whose every reader
 *   (`METRIC_HIGHER_IS_BETTER`, `severityFor`, `goodness`, `summarise`
 *   direction, `buildRoutinePlan`, `evaluateRoutine`) treats only hydration
 *   and evenness as higher-is-better.
 * - Therefore for the other SEVEN metrics the stored number carries vendor
 *   polarity but every consumer reads local polarity: an excellent vendor
 *   reading renders as concern and triggers treatment suggestions, and a poor
 *   vendor reading renders as clear/strength.
 *
 * RECONCILIATION VERDICTS (one per metric, asserted below):
 * - LOCKED (hydration, evenness): mapper, audit claim, UI and recommendation
 *   all agree with the vendor evidence. These tests pin correct behaviour.
 * - CONTESTED (oiliness, redness, texture, pores, darkSpots, underEye,
 *   acneIndicators): the audit claims vendor higher-is-better for all nine;
 *   the implementation passes the number through into higher-is-worse
 *   readers. Per the plan ("a contested claim is never marked fixed by
 *   assumption") this file does NOT invert anything: the assertions below
 *   characterise the CURRENT end-to-end direction as evidence for the child
 *   item, and each contested block is marked CONTESTED. If the vendor's
 *   written confirmation (Q1) upholds higher-is-better for these seven, the
 *   child item inverts once at the adapter boundary and rewrites the
 *   CONTESTED assertions; if the vendor contradicts it, the assertions stand
 *   as the locked contract.
 *
 * PROPOSED CHILD ITEM (P1-T14a, not implemented here):
 * owner: backend/skin-integration. (1) Obtain written per-concern polarity
 * confirmation from Perfect Corp (synthesis Q1). (2) If confirmed, restore
 * the adapter-boundary inversion for the seven contested metrics
 * (the `METRIC_HIGHER_IS_BETTER[key] ? raw : 100 - raw` line PR #12 removed
 * from `mapPerfectCorpOutput`), update `test/perfectcorp.test.ts:24` which
 * pins the current pass-through values, and rewrite this file's CONTESTED
 * assertions to the corrected direction. (3) Decide the fate of already
 * stored vendor-polarity scans (re-normalise vs version-gate). Touching
 * `test/perfectcorp.test.ts` belongs to that item, not this one — this gate
 * item changes no product code and no existing test.
 *
 * FIXTURE VALUES: per-metric LOW/HIGH pairs are realistic non-midpoint
 * numbers from the audit's evidence tables — HIGH is the repo fixture
 * `test/fixtures/perfectcorp-sd.json` (vendor mean ~84); LOW mirrors the
 * auditors' all-5/all-95 probes shifted off the PINNED edge (99.5).
 */
import { describe, expect, it } from "vitest";

import {
  mapPerfectCorpOutput,
  PERFECTCORP_MAPPING,
} from "../server/ai/perfectcorp.ts";
import {
  METRIC_HIGHER_IS_BETTER,
  SKIN_METRIC_KEYS,
  type SkinAnalysis,
  type SkinAppearanceMetrics,
  type SkinMetricKey,
  type SkinProfile,
} from "../shared/types.ts";
import { severityFor } from "../src/skin-analysis/observations.ts";
import { averageGoodness, selectFindings } from "../src/holograms/presented.ts";
import { summarise } from "../server/skin/longitudinal.ts";
import { buildRoutinePlan } from "../server/skin/recommend.ts";
import { evaluateRoutine } from "../server/skin/outcomes.ts";

/** Vendor-side ui_score pair per metric: poor skin vs excellent skin. */
const VENDOR_PAIRS: Record<SkinMetricKey, { low: number; high: number }> = {
  // HIGH column == test/fixtures/perfectcorp-sd.json ui_scores verbatim.
  hydration: { low: 22, high: 78 },
  oiliness: { low: 18, high: 85 },
  redness: { low: 15, high: 90 },
  texture: { low: 20, high: 80 },
  pores: { low: 12, high: 85 },
  darkSpots: { low: 25, high: 95 },
  evenness: { low: 22, high: 78 },
  underEye: { low: 28, high: 72 },
  acneIndicators: { low: 15, high: 92 },
};

/** Metrics where mapper, audit, UI and vendor evidence all agree. */
const LOCKED: SkinMetricKey[] = ["hydration", "evenness"];
/** Metrics where the audit claim contradicts the implementation. See header. */
const CONTESTED: SkinMetricKey[] = [
  "oiliness",
  "redness",
  "texture",
  "pores",
  "darkSpots",
  "underEye",
  "acneIndicators",
];

/** One representative routine ingredient per metric with a direct family target. */
const REPRESENTATIVE_INGREDIENT: Partial<Record<SkinMetricKey, string>> = {
  hydration: "Hyaluronic Acid",
  oiliness: "Salicylic Acid",
  redness: "Centella Asiatica",
  texture: "Retinol",
  darkSpots: "Tranexamic Acid",
  evenness: "Ascorbic Acid",
  acneIndicators: "Benzoyl Peroxide",
};
// NOTE: pores has no ingredient family targeting it and underEye products
// (family `hydration`) are graded on hydration — both documented below.

const MODEL_VERSION = "perfectcorp-v2.1";

const PROFILE: SkinProfile = {
  skinType: "normal",
  fitzpatrick: null,
  concerns: [],
  sensitivities: [],
  pregnancyStatus: "unknown",
  updatedAt: "2026-09-24T10:00:00Z",
};

/** Vendor `output[]` payload for a single metric at one ui_score. */
function vendorOutputFor(key: SkinMetricKey, uiScore: number): unknown[] {
  return (Object.keys(PERFECTCORP_MAPPING) as SkinMetricKey[]).map((k) => ({
    type: PERFECTCORP_MAPPING[k],
    raw_score: k === key ? uiScore - 5 : 70,
    ui_score: k === key ? uiScore : 70,
  }));
}

/** Scan reading at `goodness` on every metric's own scale, with overrides. */
function scanAt(
  goodness: number,
  overrides: Partial<SkinAppearanceMetrics> = {},
  capturedAt = "2026-09-24T10:00:00Z",
): SkinAnalysis {
  const metrics = {} as SkinAppearanceMetrics;
  for (const key of SKIN_METRIC_KEYS) {
    metrics[key] = METRIC_HIGHER_IS_BETTER[key] ? goodness : 100 - goodness;
  }
  Object.assign(metrics, overrides);
  return {
    id: `scan-${capturedAt}`,
    capturedAt,
    metrics,
    regions: {},
    quality: {
      verdict: "pass",
      score: 0.9,
      brightness: 0.5,
      sharpness: 0.8,
      faceHeightFraction: 0.6,
      centeringError: 0,
      issues: [],
    },
    confidence: 0.8,
    modelVersion: MODEL_VERSION,
  };
}

function usageFor(ingredient: string, startedAt: string) {
  return {
    id: `use-${ingredient}`,
    product: {
      id: `prod-${ingredient}`,
      name: `${ingredient} product`,
      brand: null,
      category: null,
      ingredients: [ingredient],
      source: "user" as const,
    },
    startedAt,
    endedAt: null,
    frequency: "daily",
    notes: null,
  };
}

describe("P1-T14 polarity evidence matrix (mapper → display → trend → recommendation)", () => {
  it("covers all nine metrics with two distinct non-midpoint vendor values each", () => {
    expect(SKIN_METRIC_KEYS).toHaveLength(9);
    expect([...LOCKED, ...CONTESTED].sort()).toEqual(
      [...SKIN_METRIC_KEYS].sort(),
    );
    for (const key of SKIN_METRIC_KEYS) {
      const { low, high } = VENDOR_PAIRS[key];
      expect(low).not.toBe(high);
      expect(low).not.toBe(50);
      expect(high).not.toBe(50);
    }
  });

  it("mapper writes the vendor ui_score through for every metric (current contract)", () => {
    for (const key of SKIN_METRIC_KEYS) {
      const { low, high } = VENDOR_PAIRS[key];
      expect(mapPerfectCorpOutput(vendorOutputFor(key, low))[key]).toBe(low);
      expect(mapPerfectCorpOutput(vendorOutputFor(key, high))[key]).toBe(high);
    }
  });

  describe.each(LOCKED)(
    "LOCKED metric %s: higher vendor score means better skin end to end",
    (key) => {
      const { low, high } = VENDOR_PAIRS[key];

      it("display: excellent vendor reading bands better than poor vendor reading", () => {
        const poor = severityFor(
          key,
          mapPerfectCorpOutput(vendorOutputFor(key, low))[key],
        );
        const excellent = severityFor(
          key,
          mapPerfectCorpOutput(vendorOutputFor(key, high))[key],
        );
        // Poor vendor skin reads as marked concern; excellent vendor skin reads clear.
        expect(poor.severity).toBe("marked");
        expect(excellent.severity).toBe("clear");
      });

      it("findings: poor vendor reading is a concern, excellent is not", () => {
        const poor = scanAt(80, {
          [key]: low,
        } as Partial<SkinAppearanceMetrics>);
        const excellent = scanAt(80, {
          [key]: high,
        } as Partial<SkinAppearanceMetrics>);
        const poorKinds = selectFindings(poor, null)
          .filter((f) => f.key === key)
          .map((f) => f.kind);
        const excellentKinds = selectFindings(excellent, null)
          .filter((f) => f.key === key)
          .map((f) => f.kind);
        expect(poorKinds).toContain("concern");
        expect(excellentKinds).not.toContain("concern");
      });

      it("composite: excellent vendor reading raises average goodness", () => {
        const poor = scanAt(80, {
          [key]: low,
        } as Partial<SkinAppearanceMetrics>);
        const excellent = scanAt(80, {
          [key]: high,
        } as Partial<SkinAppearanceMetrics>);
        expect(averageGoodness(excellent)).toBeGreaterThan(
          averageGoodness(poor),
        );
      });

      it("trend: poor → excellent classifies as improving", () => {
        const history = [
          scanAt(
            80,
            { [key]: low } as Partial<SkinAppearanceMetrics>,
            "2026-09-01T10:00:00Z",
          ),
          scanAt(
            80,
            { [key]: high } as Partial<SkinAppearanceMetrics>,
            "2026-09-24T10:00:00Z",
          ),
        ];
        const trend = summarise(history).trends.find((t) => t.key === key)!;
        expect(trend.significant).toBe(true);
        expect(trend.direction).toBe("improving");
      });

      it("recommendation: poor vendor reading suggests, excellent does not", () => {
        const poorMetrics = scanAt(80, {
          [key]: low,
        } as Partial<SkinAppearanceMetrics>).metrics;
        const excellentMetrics = scanAt(80, {
          [key]: high,
        } as Partial<SkinAppearanceMetrics>).metrics;
        const poorFires = buildRoutinePlan(
          poorMetrics,
          PROFILE,
          [],
          0.9,
        ).suggestions.some((s) => s.because?.key === key);
        const excellentFires = buildRoutinePlan(
          excellentMetrics,
          PROFILE,
          [],
          0.9,
        ).suggestions.some((s) => s.because?.key === key);
        expect(poorFires).toBe(true);
        expect(excellentFires).toBe(false);
      });

      it("outcomes: poor → excellent on a matching product grades as working", () => {
        const ingredient = REPRESENTATIVE_INGREDIENT[key]!;
        const history = [
          scanAt(
            80,
            { [key]: low } as Partial<SkinAppearanceMetrics>,
            "2026-09-01T10:00:00Z",
          ),
          scanAt(
            80,
            { [key]: high } as Partial<SkinAppearanceMetrics>,
            "2026-09-24T10:00:00Z",
          ),
        ];
        const outcomes = evaluateRoutine(history, [
          usageFor(ingredient, "2026-09-01T10:00:00Z"),
        ]);
        const outcome = outcomes.find((o) => o.metric === key)!;
        expect(outcome).toBeDefined();
        expect(outcome.verdict).toBe("working");
      });
    },
  );

  describe.each(CONTESTED)(
    "CONTESTED metric %s: current end-to-end direction (evidence for child item P1-T14a)",
    (key) => {
      const { low, high } = VENDOR_PAIRS[key];

      it("display: CURRENT behaviour — excellent vendor reading bands as concern", () => {
        // CONTESTED: vendor evidence says higher ui_score is better skin, but
        // the pass-through value is read on the local higher-is-worse scale,
        // so the band worsens as the vendor score improves. Pinned here as
        // evidence; P1-T14a rewrites this if Q1 confirms vendor polarity.
        const poor = severityFor(
          key,
          mapPerfectCorpOutput(vendorOutputFor(key, low))[key],
        );
        const excellent = severityFor(
          key,
          mapPerfectCorpOutput(vendorOutputFor(key, high))[key],
        );
        expect(excellent.severity).not.toBe("clear");
        expect(poor.severity === "clear" || poor.severity === "slight").toBe(
          true,
        );
      });

      it("findings: CURRENT behaviour — excellent vendor reading is a concern", () => {
        // CONTESTED: same inversion as display, via goodness(). See header.
        const poor = scanAt(80, {
          [key]: low,
        } as Partial<SkinAppearanceMetrics>);
        const excellent = scanAt(80, {
          [key]: high,
        } as Partial<SkinAppearanceMetrics>);
        const poorKinds = selectFindings(poor, null)
          .filter((f) => f.key === key)
          .map((f) => f.kind);
        const excellentKinds = selectFindings(excellent, null)
          .filter((f) => f.key === key)
          .map((f) => f.kind);
        expect(excellentKinds).toContain("concern");
        expect(poorKinds).not.toContain("concern");
      });

      it("composite: CURRENT behaviour — excellent vendor reading lowers average goodness", () => {
        // CONTESTED: averageGoodness polarity-normalises, so a vendor-high
        // pass-through value on a higher-is-worse key drags the mean down.
        const poor = scanAt(80, {
          [key]: low,
        } as Partial<SkinAppearanceMetrics>);
        const excellent = scanAt(80, {
          [key]: high,
        } as Partial<SkinAppearanceMetrics>);
        expect(averageGoodness(excellent)).toBeLessThan(averageGoodness(poor));
      });

      it("trend: CURRENT behaviour — poor → excellent classifies as declining", () => {
        // CONTESTED: summarise direction() reads METRIC_HIGHER_IS_BETTER, so
        // skin the vendor rates as improved reads as declined. See header.
        const history = [
          scanAt(
            80,
            { [key]: low } as Partial<SkinAppearanceMetrics>,
            "2026-09-01T10:00:00Z",
          ),
          scanAt(
            80,
            { [key]: high } as Partial<SkinAppearanceMetrics>,
            "2026-09-24T10:00:00Z",
          ),
        ];
        const trend = summarise(history).trends.find((t) => t.key === key)!;
        expect(trend.significant).toBe(true);
        expect(trend.direction).toBe("declining");
      });

      it("recommendation: CURRENT behaviour — excellent vendor reading triggers treatment", () => {
        // CONTESTED: buildRoutinePlan fires "at or beyond threshold in the bad
        // direction", so vendor-excellent values raise suggestions quoting the
        // excellent score in `because`. Pores is the documented exception: no
        // rule is keyed to it, so the engine is blind to pores at any value.
        const poorMetrics = scanAt(80, {
          [key]: low,
        } as Partial<SkinAppearanceMetrics>).metrics;
        const excellentMetrics = scanAt(80, {
          [key]: high,
        } as Partial<SkinAppearanceMetrics>).metrics;
        const poorFires = buildRoutinePlan(
          poorMetrics,
          PROFILE,
          [],
          0.9,
        ).suggestions.some((s) => s.because?.key === key);
        const excellentFires = buildRoutinePlan(
          excellentMetrics,
          PROFILE,
          [],
          0.9,
        ).suggestions.some((s) => s.because?.key === key);
        if (key === "pores") {
          expect(poorFires).toBe(false);
          expect(excellentFires).toBe(false);
        } else {
          expect(excellentFires).toBe(true);
          expect(poorFires).toBe(false);
        }
      });

      it("outcomes: documents how each contested metric is graded over time", () => {
        // Metrics with a direct family target grade the vendor-scale movement
        // against the local polarity table (CONTESTED: improvement reads as
        // `wrong_way`). underEye products map to the `hydration` family, so an
        // underEye-only movement is never directly graded; pores has no target
        // at all, so no outcome ever names it.
        const history = [
          scanAt(
            80,
            { [key]: low } as Partial<SkinAppearanceMetrics>,
            "2026-09-01T10:00:00Z",
          ),
          scanAt(
            80,
            { [key]: high } as Partial<SkinAppearanceMetrics>,
            "2026-09-24T10:00:00Z",
          ),
        ];
        if (key === "pores") {
          const outcomes = evaluateRoutine(history, [
            usageFor("Salicylic Acid", "2026-09-01T10:00:00Z"),
          ]);
          expect(outcomes.some((o) => o.metric === "pores")).toBe(false);
          return;
        }
        if (key === "underEye") {
          const outcomes = evaluateRoutine(history, [
            usageFor("Hyaluronic Acid", "2026-09-01T10:00:00Z"),
          ]);
          const outcome = outcomes.find(
            (o) => o.productId === "prod-Hyaluronic Acid",
          )!;
          // Graded on hydration (unchanged here), never on underEye itself.
          expect(outcome.metric).toBe("hydration");
          expect(outcome.verdict).toBe("no_evidence");
          return;
        }
        const ingredient = REPRESENTATIVE_INGREDIENT[key]!;
        const outcomes = evaluateRoutine(history, [
          usageFor(ingredient, "2026-09-01T10:00:00Z"),
        ]);
        const outcome = outcomes.find((o) => o.metric === key)!;
        expect(outcome).toBeDefined();
        expect(outcome.verdict).toBe("wrong_way");
      });
    },
  );
});
