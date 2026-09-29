/**
 * P1-T03 — async password derivation bridge.
 *
 * Proves the minimal contract, nothing more (no pepper/argon2 — P3-T08 owns
 * removal of this bridge):
 *
 * 1. New hashes round-trip, and a hash produced by the LEGACY sync parameters
 *    (N=16384, r=8, p=1, keylen=64, 16-byte hex salt) still verifies unchanged.
 * 2. Wrong and unknown credentials both fail, and unknown costs ~one scrypt
 *    like a wrong password (fixed dummy derivation — no enumeration timing).
 * 3. Derivation does not block the event loop (a timer fires first).
 * 4. Oversized input is rejected before any derivation with a generic error.
 *
 * DB-free: crypto is exercised directly and `authenticate` runs against a
 * stubbed `server/db/index.ts` row lookup, so no database is needed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { scrypt, scryptSync } from "node:crypto";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt: vi.fn(actual.scrypt) };
});

const dbState = vi.hoisted(() => ({
  rowsByEmail: new Map<string, Record<string, string>>(),
}));

vi.mock("../server/db/index.ts", () => ({
  row: vi.fn(async (sql: string, ...args: unknown[]) => {
    if (String(sql).includes("FROM users WHERE email")) {
      return dbState.rowsByEmail.get(String(args[0])) ?? null;
    }
    return null;
  }),
  rows: vi.fn(async () => []),
  run: vi.fn(async () => 0),
  transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
    fn({ run: vi.fn(async () => 0) }),
  ),
}));

const { hashPassword, verifyPassword, MAX_PASSWORD_BYTES } =
  await import("../server/lib/crypto.ts");
const { authenticate } = await import("../server/db/users.ts");

// A hash produced by the LEGACY sync derivation — computed once with
// scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }) — so this test
// fails if the async bridge ever changes parameters or encoding.
const LEGACY_PASSWORD = "legacy-compat-probe-password";
const LEGACY_SALT = "0123456789abcdef0123456789abcdef";
const LEGACY_HASH =
  "27204922f22d57dd87570db41a067d0c4a290101bb3958cd64d6123e31c08ddd06d92e366a939ada6bf2a8ca9a93d433042d84162a9d33790e17d092fcfef0ab";

beforeEach(() => {
  vi.mocked(scrypt).mockClear();
  dbState.rowsByEmail.clear();
  dbState.rowsByEmail.set("legacy@example.test", {
    id: "legacy-id",
    email: "legacy@example.test",
    password_hash: LEGACY_HASH,
    password_salt: LEGACY_SALT,
  });
});

describe("password derivation (P1-T03 async bridge)", () => {
  it("round-trips a fresh hash and rejects a wrong password", async () => {
    const { hash, salt } = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^[0-9a-f]{128}$/);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    await expect(
      verifyPassword("correct horse battery staple", hash, salt),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash, salt)).resolves.toBe(
      false,
    );
  });

  it("still verifies a hash produced by the legacy sync parameters", async () => {
    // Sanity: the inline fixture really is what scryptSync with the legacy
    // parameters produces — guards against a stale copy-paste, not the impl.
    expect(
      scryptSync(LEGACY_PASSWORD, LEGACY_SALT, 64, {
        N: 16384,
        r: 8,
        p: 1,
      }).toString("hex"),
    ).toBe(LEGACY_HASH);
    // The new async verifier accepts that legacy hash unchanged.
    await expect(
      verifyPassword(LEGACY_PASSWORD, LEGACY_HASH, LEGACY_SALT),
    ).resolves.toBe(true);
    await expect(
      verifyPassword("not the password", LEGACY_HASH, LEGACY_SALT),
    ).resolves.toBe(false);
  });

  it("authenticates a legacy hash, and fails wrong/unknown credentials", async () => {
    await expect(
      authenticate("legacy@example.test", LEGACY_PASSWORD),
    ).resolves.toBe("legacy-id");
    await expect(
      authenticate("legacy@example.test", "wrong-password"),
    ).resolves.toBeNull();
    await expect(
      authenticate("nobody-here@example.test", "any-password"),
    ).resolves.toBeNull();
  });

  it("performs one identical-parameter derivation for unknown and known accounts", async () => {
    await authenticate("legacy@example.test", "wrong-password");
    await authenticate("nobody@example.test", "wrong-password");
    const calls = vi.mocked(scrypt).mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call[0]).toBe("wrong-password");
      expect(call[2]).toBe(64);
      expect(call[3]).toMatchObject({ N: 16384, r: 8, p: 1 });
    }
  });

  it("yields the event loop while deriving (non-blocking)", async () => {
    const pending = Promise.all(Array.from({ length: 4 }, (_, i) => hashPassword(`event-loop-probe-${i}`)));
    const order: string[] = [];
    void pending.then(() => {
      order.push("scrypt");
    });
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        order.push("timer");
        resolve();
      }, 0);
    });
    await pending;
    // A sync derivation would block the timer until it finished (and a sync
    // wrapper would resolve before the timer even scheduled).
    expect(order).toEqual(["timer", "scrypt"]);
  });

  it("rejects oversized input before derivation with a generic error", async () => {
    expect(MAX_PASSWORD_BYTES).toBe(128);
    const tooBig = "x".repeat(MAX_PASSWORD_BYTES + 1);
    await expect(hashPassword(tooBig)).rejects.toThrow("Invalid credentials.");
    await expect(
      verifyPassword(tooBig, "00".repeat(64), "00".repeat(32)),
    ).rejects.toThrow("Invalid credentials.");
    // Multibyte input is measured in bytes, not chars: 65 × 2-byte é = 130.
    await expect(hashPassword("é".repeat(65))).rejects.toThrow(
      "Invalid credentials.",
    );
    // No elapsed-time heuristic: rejected inputs never enter the KDF.
    expect(scrypt).not.toHaveBeenCalled();
    // Unknown accounts reject identically (no oracle), and the error leaks nothing.
    const err = await authenticate("nobody-here@example.test", tooBig).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Invalid credentials.");
    expect(scrypt).not.toHaveBeenCalled();
  });

  it("accepts a password exactly at the cap", async () => {
    const atCap = "x".repeat(MAX_PASSWORD_BYTES);
    const { hash, salt } = await hashPassword(atCap);
    await expect(verifyPassword(atCap, hash, salt)).resolves.toBe(true);
  });
});
