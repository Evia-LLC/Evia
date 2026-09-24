/**
 * What the Routine page reads from the server, and when it may ask.
 *
 * Sample mode asks for nothing: the fixture is the whole page. A guest has no
 * account for the server to answer for (every /api/routine* route is behind
 * sign-in, so asking only produced an unhandled 401); a guest's plan, if they
 * scanned in this tab, is the one the scan already put on the session. A
 * signed-in account gets its plan, its products in use, their outcomes and
 * the whole-routine review - each fetched on its own, so one failing leaves
 * the rest standing.
 */
import { api } from '@/lib/api.ts';
import { refreshPicks } from '@/state/controller.ts';
import { session } from '@/state/session.svelte.ts';
import type {
  Product,
  ProductAssessment,
  ProductUsage,
  RoutineOutcome,
  RoutinePlan,
  RoutineReview,
} from '@shared/types.ts';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export class RoutineData {
  plan = $state<RoutinePlan | null>(null);
  planStatus = $state<Status>('idle');

  usage = $state<ProductUsage[]>([]);
  review = $state<RoutineReview | null>(null);
  outcomes = $state<RoutineOutcome[]>([]);
  productsStatus = $state<Status>('idle');

  results = $state<Product[]>([]);
  assessment = $state<ProductAssessment | null>(null);
  searched = $state(false);
  busy = $state(false);
  actionError = $state<string | null>(null);

  inUse = $derived(this.usage.filter((u) => !u.endedAt));

  /** Whether this visit can talk to the routine endpoints at all. */
  get account(): boolean {
    return session.signedIn && !session.guest;
  }

  async loadPlan(): Promise<void> {
    if (!this.account) {
      // A guest's reading was never stored; its plan came back with the scan.
      this.plan = session.plan;
      this.planStatus = 'ready';
      return;
    }
    this.planStatus = 'loading';
    try {
      this.plan = (await api.routinePlan()).plan;
      this.planStatus = 'ready';
    } catch {
      this.planStatus = 'error';
    }
    // The shelf for the same reading, for the rows' images and the Products link.
    void refreshPicks();
  }

  async loadProducts(): Promise<void> {
    if (!this.account) return;
    this.productsStatus = 'loading';
    try {
      const result = await api.routine();
      this.usage = result.usage;
      this.review = result.review;
      this.productsStatus = 'ready';
    } catch {
      this.productsStatus = 'error';
    }
    try {
      this.outcomes = (await api.routineOutcomes()).outcomes;
    } catch {
      this.outcomes = [];
    }
  }

  async load(): Promise<void> {
    await Promise.all([this.loadPlan(), this.loadProducts()]);
  }

  /** Runs a change against the server, then re-reads what it changed. */
  private async act(run: () => Promise<void>, fail: string): Promise<void> {
    if (!this.account) return;
    this.busy = true;
    this.actionError = null;
    try {
      await run();
    } catch {
      this.actionError = fail;
    } finally {
      this.busy = false;
    }
  }

  search(query: string): Promise<void> {
    return this.act(async () => {
      if (!query.trim()) return;
      this.assessment = null;
      this.results = (await api.searchProducts(query)).products;
      this.searched = true;
    }, 'The search did not go through. Try again in a moment.');
  }

  assess(product: Product): Promise<void> {
    return this.act(async () => {
      this.assessment = (await api.assessProduct(product.id)).assessment;
    }, 'That product could not be assessed just now.');
  }

  add(input: { name: string; brand?: string; ingredients: string[] }): Promise<void> {
    return this.act(async () => {
      const { product } = await api.addProduct(input);
      this.results = [product];
      this.searched = true;
    }, 'The product was not saved. Try again in a moment.');
  }

  start(product: Product): Promise<void> {
    return this.act(async () => {
      await api.startRoutine(product.id);
      // Adding a product changes what the plan counts as covered.
      await Promise.all([this.loadProducts(), this.loadPlan()]);
    }, 'It could not be added to your routine just now.');
  }

  stop(id: string): Promise<void> {
    return this.act(async () => {
      await api.stopRoutine(id);
      await Promise.all([this.loadProducts(), this.loadPlan()]);
    }, 'It could not be taken out of your routine just now.');
  }
}
