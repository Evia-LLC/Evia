import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { api } from "../src/lib/api.ts";
import { session } from "../src/state/session.svelte.ts";
import type { SkinAnalysis } from "../shared/types.ts";

const root = join(import.meta.dirname, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");


const analysis: SkinAnalysis = {
  capturedAt: "2026-09-23T12:00:00.000Z",
  metrics: {
    hydration: 50,
    oiliness: 50,
    redness: 50,
    texture: 50,
    darkSpots: 50,
    pores: 50,
    eyeArea: 50,
    firmness: 50,
    uniformity: 50,
  },
  regions: {},
  quality: { verdict: "good", issues: [] },
  confidence: 0.9,
  modelVersion: "test",
};

afterEach(() => vi.restoreAllMocks());

describe("facial geometry privacy boundary", () => {
  it("sends a scan request without face landmarks", async () => {
    let sent: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ scan: analysis, summary: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await api.saveScan(analysis);
    expect(sent).toEqual({ analysis });
    expect(JSON.stringify(sent)).not.toContain("landmarks");
  });

  it("rejects unexpected facial geometry and never hydrates it into API responses", () => {
    const route = source("server/routes/api.ts");
    const repository = source("server/db/scans.ts");
    expect(route).toContain("hasOwnProperty.call(analysis, 'landmarks')");
    expect(route).toContain("error: 'Facial landmarks are not accepted.'");
    expect(repository).not.toContain("landmarks_json");
    expect(repository).not.toMatch(/\blandmarks\b/);
  });

  it('defines the fresh skin schema without persisted facial landmarks', () => {
    const schema = source('supabase/migrations/20261013000000_application.sql');
    const table = schema.slice(schema.indexOf('CREATE TABLE skin_scans'), schema.indexOf('CREATE INDEX idx_scans'));
    expect(table).not.toContain('landmarks');
  });

  it("clears the in-memory mesh on reset", () => {
    session.lastMesh = {
      points: new Float32Array([0, 0, 0]),
      count: 1,
      aspect: 1,
      tessellation: new Uint16Array(),
      contours: [],
      oval: new Uint16Array(),
    };
    session.reset();
    expect(session.lastMesh).toBeNull();
  });

  it("covers cancellation, route departure, completion, failure and logout cleanup", () => {
    const controller = source("src/state/controller.ts");
    expect(controller.match(/session\.clearScanArtifacts\(\)/g)).toHaveLength(
      5,
    );
    expect(controller).not.toContain("meshInCrop");
    expect(controller).not.toContain("analysis.landmarks");
    expect(source("src/history/CompareFaces.svelte")).not.toContain(
      ".landmarks",
    );
    expect(() => source("src/history/align.ts")).toThrow();
  });
});
