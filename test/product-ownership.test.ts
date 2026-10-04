/**
 * P1-T04 — cross-user product poisoning is closed.
 *
 * Any authenticated user could submit a known name/brand through
 * POST /products and replace the shared row's ingredients, changing other
 * users' assessments. Products now carry an owner: NULL means the shared /
 * operator catalogue (including every historical row — ownership is never
 * guessed), otherwise the row belongs to exactly one user.
 *
 * Exercises the real HTTP boundary (requireAuth + apiRouter) against the real
 * repositories on a disposable database, per the body-store pattern: its own
 * schema, created and dropped around the run, so real rows are unreachable.
 * No external services, synthetic data only.
 *
 * Skipped — loudly — when nothing is configured. A test that quietly passes
 * with no database is worse than one that never ran.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";

const BASE_URL = process.env.NETLIFY_DATABASE_URL ?? "";
// Under `npm run test:local` this is always true (the runner injects a disposable PGlite URL), so 0 skipped is the deterministic expectation; bare `vitest run` with no env skips the tests below with a warn.
const configured = BASE_URL.length > 0;

if (!configured) {
  console.warn(
    "[product-ownership] NETLIFY_DATABASE_URL is not set — database tests did not run (use `npm run test:local`).",
  );
}

/** Its own schema, named for this run. */
const SCHEMA = `elohim_test_pown_${process.pid}_${Date.now()}`;

type Users = typeof import("../server/db/users.ts");
type Products = typeof import("../server/db/products.ts");

/** A short-lived connection for the schema itself, outside the app's pool. */
async function admin(sql: string) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: BASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let users: Users;
let productsRepo: Products;
let server: Server | undefined;
let base: string;
let tokenA = "";
let tokenB = "";
let userA = "";
let userB = "";
let productAId = "";
let productBId = "";
let sharedId = "";

const NAME = `Aurora Serum ${stamp()}`;
const BRAND = `Evia Lab ${stamp()}`;
const INGREDIENTS_A = ["Aqua", "Niacinamide", "Glycerin"];
const INGREDIENTS_B = ["Aqua", "Retinol", "Parfum"];
const SHARED_NAME = `Shared Oat Cream ${stamp()}`;
const SHARED_BRAND = `Operator ${stamp()}`;
const SHARED_INGREDIENTS = ["Aqua", "Avena Sativa", "Squalane"];

async function createAccount(
  tag: string,
): Promise<{ userId: string; token: string }> {
  const userId = await users.createUser(
    `${tag}-${stamp()}@test.local`,
    "Password123!",
    tag,
  );
  const token = await users.createSession(userId);
  return { userId, token };
}

const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

const post = (path: string, body: unknown, token: string) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });

const get = (path: string, token: string) =>
  fetch(base + path, { headers: authHeaders(token) });

beforeAll(async () => {
  if (!configured) return;

  await admin(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

  /*
   * Point the app's pool at that schema before anything imports it.
   *
   * `search_path` travels in the connection string rather than being issued as
   * a statement, because a pool opens connections whenever it likes and a `SET`
   * only applies to the one it was sent on.
   */
  process.env.NETLIFY_DATABASE_URL = `${BASE_URL}${BASE_URL.includes("?") ? "&" : "?"}options=-csearch_path%3D${SCHEMA}`;

  const { migrate } = await import("../server/db/index.ts");
  await migrate();
  users = await import("../server/db/users.ts");
  productsRepo = await import("../server/db/products.ts");
  const { apiRouter } = await import("../server/routes/api.ts");

  // Start the HTTP boundary first: the seeding below exercises the real
  // routes (POST /api/products, POST /api/routine), so `base` must exist
  // before the first seeding POST.
  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);
  const listener = createServer(app);
  server = listener;
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("no listener");
  base = `http://127.0.0.1:${address.port}`;

  const a = await createAccount("pown-a");
  const b = await createAccount("pown-b");
  userA = a.userId;
  tokenA = a.token;
  userB = b.userId;
  tokenB = b.token;

  // The operator catalogue row: shared (owner NULL), assessable by everyone,
  // mutable by no ordinary user. Written through the explicit shared path,
  // the way a later admin-caller switch would.
  const shared = await productsRepo.createSharedProduct({
    name: SHARED_NAME,
    brand: SHARED_BRAND,
    ingredients: SHARED_INGREDIENTS,
    source: "catalogue",
  });
  sharedId = shared.id;

  // A's private product, submitted as an ordinary user.
  const created = await post(
    "/api/products",
    { name: NAME, brand: BRAND, ingredients: INGREDIENTS_A },
    tokenA,
  );
  expect(created.status).toBe(200);
  productAId = ((await created.json()) as { product: { id: string } }).product
    .id;

  // A attaches it to her routine.
  const attached = await post(
    "/api/routine",
    { productId: productAId },
    tokenA,
  );
  expect(attached.status).toBe(200);

  // B submits the SAME name/brand with DIFFERENT ingredients.
  const poison = await post(
    "/api/products",
    { name: NAME, brand: BRAND, ingredients: INGREDIENTS_B },
    tokenB,
  );
  expect(poison.status).toBe(200);
  productBId = ((await poison.json()) as { product: { id: string } }).product
    .id;
}, 60_000);

afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (!configured) return;
  process.env.NETLIFY_DATABASE_URL = BASE_URL;
  await admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
});

describe.skipIf(!configured)(
  "P1-T04 user submissions cannot poison each other",
  () => {
    it("gives B a separate row and leaves A's row and routine unchanged", async () => {
      // Two distinct rows for one name/brand — the poisoning attempt forked
      // instead of overwriting.
      expect(productBId).toBeTruthy();
      expect(productBId).not.toBe(productAId);

      // A's row still carries A's ingredients.
      const assess = await post(
        `/api/products/${productAId}/assess`,
        {},
        tokenA,
      );
      expect(assess.status).toBe(200);
      const body = (await assess.json()) as {
        assessment: { product: { id: string; ingredients: string[] } };
      };
      expect(body.assessment.product.id).toBe(productAId);
      expect(body.assessment.product.ingredients).toEqual(INGREDIENTS_A);

      // A's routine still points at her own row with her own ingredients.
      const routine = (await (await get("/api/routine", tokenA)).json()) as {
        usage: { product: { id: string; ingredients: string[] } }[];
      };
      expect(routine.usage).toHaveLength(1);
      expect(routine.usage[0].product.id).toBe(productAId);
      expect(routine.usage[0].product.ingredients).toEqual(INGREDIENTS_A);

      // At the repository level both rows exist side by side.
      const ownA = await productsRepo.listOwnedProducts(userA);
      const ownB = await productsRepo.listOwnedProducts(userB);
      expect(ownA.map((p) => p.id)).toContain(productAId);
      expect(ownB.map((p) => p.id)).toContain(productBId);
      expect(ownA.find((p) => p.id === productAId)?.ingredients).toEqual(
        INGREDIENTS_A,
      );
      expect(ownB.find((p) => p.id === productBId)?.ingredients).toEqual(
        INGREDIENTS_B,
      );
    });

    it("stops B assessing A's private product while A still can", async () => {
      expect(
        (await post(`/api/products/${productAId}/assess`, {}, tokenB)).status,
      ).toBe(404);
      expect(
        (await post(`/api/products/${productAId}/assess`, {}, tokenA)).status,
      ).toBe(200);
    });

    it("stops B attaching A's private product and writes no usage row", async () => {
      const before = (await (await get("/api/routine", tokenB)).json()) as {
        usage: unknown[];
      };
      const res = await post("/api/routine", { productId: productAId }, tokenB);
      expect(res.status).toBe(404);
      const after = (await (await get("/api/routine", tokenB)).json()) as {
        usage: unknown[];
      };
      expect(after.usage).toHaveLength(before.usage.length);
      expect(after.usage).toHaveLength(0);
    });

    it("keeps the shared catalogue row readable and assessable by both, mutable by neither", async () => {
      for (const token of [tokenA, tokenB]) {
        const assess = await post(
          `/api/products/${sharedId}/assess`,
          {},
          token,
        );
        expect(assess.status).toBe(200);
        const body = (await assess.json()) as {
          assessment: { product: { ingredients: string[] } };
        };
        expect(body.assessment.product.ingredients).toEqual(SHARED_INGREDIENTS);
      }

      // Attaching the shared row is allowed for both.
      expect(
        (await post("/api/routine", { productId: sharedId }, tokenA)).status,
      ).toBe(200);
      expect(
        (await post("/api/routine", { productId: sharedId }, tokenB)).status,
      ).toBe(200);

      // But submitting its name/brand as an ordinary user forks a private row
      // instead of rewriting the catalogue ingredients.
      const attempt = await post(
        "/api/products",
        {
          name: SHARED_NAME,
          brand: SHARED_BRAND,
          ingredients: ["Aqua", "Bleach"],
        },
        tokenA,
      );
      expect(attempt.status).toBe(200);
      const forkId = ((await attempt.json()) as { product: { id: string } })
        .product.id;
      expect(forkId).not.toBe(sharedId);

      const shared = await productsRepo.getVisibleProduct(sharedId, userA);
      expect(shared?.ingredients).toEqual(SHARED_INGREDIENTS);
      const reassess = await post(
        `/api/products/${sharedId}/assess`,
        {},
        tokenB,
      );
      expect(reassess.status).toBe(200);
      expect(
        (
          (await reassess.json()) as {
            assessment: { product: { ingredients: string[] } };
          }
        ).assessment.product.ingredients,
      ).toEqual(SHARED_INGREDIENTS);
    });

    it("scopes search to shared rows plus the caller's own", async () => {
      const needle = NAME.slice(0, 12);
      const asA = (await (
        await get(
          `/api/products/search?q=${encodeURIComponent(needle)}`,
          tokenA,
        )
      ).json()) as {
        products: { id: string }[];
      };
      const asB = (await (
        await get(
          `/api/products/search?q=${encodeURIComponent(needle)}`,
          tokenB,
        )
      ).json()) as {
        products: { id: string }[];
      };
      const idsA = asA.products.map((p) => p.id);
      const idsB = asB.products.map((p) => p.id);
      expect(idsA).toContain(productAId);
      expect(idsA).not.toContain(productBId);
      expect(idsB).toContain(productBId);
      expect(idsB).not.toContain(productAId);
    });
  },
);

describe.skipIf(!configured)(
  "P1-T04 export and deletion respect ownership",
  () => {
    it("exports A's owned products and usage without B's rows", async () => {
      const { assembleDataExport } =
        await import("../server/privacy/export.ts");
      const exported = (await assembleDataExport(userA)) as unknown as {
        routine: {
          products: { product: { id: string } }[];
          ownedProducts: { id: string }[];
        };
      };
      const ownedIds = exported.routine.ownedProducts.map((p) => p.id);
      expect(ownedIds).toContain(productAId);
      expect(ownedIds).not.toContain(productBId);
      expect(ownedIds).not.toContain(sharedId);
      const usedIds = exported.routine.products.map((u) => u.product.id);
      expect(usedIds).toContain(productAId);
      expect(usedIds).not.toContain(productBId);
    });

    it("deletes A's owned rows on account deletion and leaves B and the catalogue intact", async () => {
      const { deleteAccount } =
        await import("../server/privacy/delete-account.ts");
      const result = await deleteAccount(userA);
      expect(result.ok).toBe(true);

      // A's owned rows are gone…
      expect(
        await productsRepo.getVisibleProduct(productAId, userA),
      ).toBeNull();
      expect(await productsRepo.listOwnedProducts(userA)).toHaveLength(0);

      // …B's rows and the shared catalogue survive.
      expect(
        await productsRepo.getVisibleProduct(productBId, userB),
      ).not.toBeNull();
      expect(
        await productsRepo.getVisibleProduct(sharedId, userB),
      ).not.toBeNull();
      const shared = await productsRepo.getVisibleProduct(sharedId, userB);
      expect(shared?.ingredients).toEqual(SHARED_INGREDIENTS);
      expect(
        (await productsRepo.listOwnedProducts(userB)).map((p) => p.id),
      ).toContain(productBId);

      // B can still assess and use what survived.
      expect(
        (await post(`/api/products/${productBId}/assess`, {}, tokenB)).status,
      ).toBe(200);
      expect(
        (await post(`/api/products/${sharedId}/assess`, {}, tokenB)).status,
      ).toBe(200);
    });
  },
);
