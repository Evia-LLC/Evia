<script lang="ts">
  /**
   * Routine: what is in use, whether it is working, and the deterministic
   * ingredient read (Phase 5).
   *
   * The assessment is honest about its own coverage — it names how many
   * ingredients it did not recognise rather than implying a complete read, and
   * `wrong_way` is never softened into a neutral colour.
   */
  import Page from '@/components/Page.svelte';
  import LabelScanner from '@/products/LabelScanner.svelte';
  import Picks from '@/products/Picks.svelte';
  import { api } from '@/lib/api.ts';
  import { link } from '@/router/router.svelte.ts';
  import { session } from '@/state/session.svelte.ts';
  import { refreshPicks } from '@/state/controller.ts';
  import type {
    Product,
    ProductAssessment,
    ProductUsage,
    RoutineOutcome,
    RoutineReview,
  } from '@shared/types.ts';

  let usage = $state<ProductUsage[]>([]);
  let review = $state<RoutineReview | null>(null);
  let outcomes = $state<RoutineOutcome[]>([]);
  let scanning = $state(false);
  let query = $state('');
  let results = $state<Product[]>([]);
  let assessment = $state<ProductAssessment | null>(null);
  let busy = $state(false);
  let loaded = $state(false);

  let newName = $state('');
  let newBrand = $state('');
  let newIngredients = $state('');

  const inUse = $derived(usage.filter((u) => !u.endedAt));

  const title = $derived.by(() => {
    if (!loaded) return 'Your routine.';
    if (inUse.length === 0) return 'Tell me what you put on your face.';
    return 'What you use, and whether it is earning its place.';
  });

  const lede = $derived.by(() => {
    if (inUse.length === 0) {
      return 'Once I know what is in your routine, I can line each product up against the reading it is meant to move — and say so when one is not moving it.';
    }
    const n = inUse.length;
    return `${n} product${n === 1 ? '' : 's'} in use. I read the overlap between these and your scans when I talk about what changed.`;
  });

  const VERDICT_LABEL: Record<ProductAssessment['verdict'], string> = {
    good_fit: 'Looks like a good fit',
    probably_fine: 'Probably fine',
    be_cautious: 'Be cautious',
    not_now: 'Not right now',
  };

  const VERDICT: Record<RoutineOutcome['verdict'], { label: string; tone: string }> = {
    working: { label: 'Working', tone: 'good' },
    wrong_way: { label: 'Went the wrong way', tone: 'bad' },
    no_evidence: { label: 'No evidence', tone: 'flat' },
    too_early: { label: 'Too early', tone: 'flat' },
    not_scored: { label: 'Not scored', tone: 'flat' },
    unrecognised: { label: 'Unknown', tone: 'flat' },
  };

  async function load() {
    const result = await api.routine();
    usage = result.usage;
    review = result.review;
    outcomes = (await api.routineOutcomes()).outcomes;
    loaded = true;
    void refreshPicks();
  }

  async function search() {
    if (!query.trim()) return;
    results = (await api.searchProducts(query)).products;
  }

  async function add() {
    if (!newName.trim()) return;
    busy = true;
    try {
      const { product } = await api.addProduct({
        name: newName,
        brand: newBrand || undefined,
        ingredients: newIngredients
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      newName = '';
      newBrand = '';
      newIngredients = '';
      results = [product];
    } finally {
      busy = false;
    }
  }

  async function assess(product: Product) {
    assessment = (await api.assessProduct(product.id)).assessment;
  }

  async function start(product: Product) {
    await api.startRoutine(product.id);
    await load();
  }

  async function stop(id: string) {
    await api.stopRoutine(id);
    await load();
  }

  $effect(() => {
    void load();
  });
</script>

<Page eyebrow="Routine" {title} {lede}>
  {#snippet actions()}
    <button class="cta" type="button" onclick={() => (scanning = true)}>Scan a label</button>
    <a class="cta cta--quiet" href="/progress" use:link>See what changed</a>
  {/snippet}

  {#if session.picks.length}
    <section class="sec" aria-label="What I would get">
      <Picks picks={session.picks} title="What I would get for your last reading" />
    </section>
  {/if}

  <section class="sec" aria-labelledby="inuse">
    <div class="sec__head">
      <h2 class="sec__title" id="inuse">In use</h2>
      {#if inUse.length}<span class="sec__meta">{inUse.length}</span>{/if}
    </div>
    {#if inUse.length}
      <div class="card">
        {#each inUse as item (item.id)}
          <div class="line">
            <div class="line__main">
              <span class="line__title">
                {item.product.brand ? `${item.product.brand} ` : ''}{item.product.name}
              </span>
              <span class="line__sub">
                since {item.startedAt.slice(0, 10)}{item.frequency ? ` · ${item.frequency}` : ''}
              </span>
            </div>
            <div class="line__end">
              <button
                class="btn btn--mini"
                onclick={() => stop(item.id)}
                aria-label={`Stop using ${item.product.name}`}
              >
                Stop using
              </button>
            </div>
          </div>
        {/each}
      </div>
    {:else if loaded}
      <div class="empty">
        <p class="empty__title">Nothing tracked yet.</p>
        <p class="empty__text">
          Scan a label or search below, then tell me you are using it. From then on I keep
          the dates, and your scans do the judging.
        </p>
      </div>
    {/if}
  </section>

  {#if outcomes.length}
    <section class="sec" aria-labelledby="working">
      <div class="sec__head">
        <h2 class="sec__title" id="working">Is it working?</h2>
      </div>
      <p class="sec__lede">
        Each product against the one reading it is meant to move. A change smaller than the
        measurement noise is reported as no evidence — not as a small win.
      </p>
      <div class="outcomes">
        {#each outcomes as outcome (outcome.productId)}
          <div class="outcome outcome--{VERDICT[outcome.verdict].tone}">
            <div class="outcome__head">
              <span class="outcome__name">{outcome.productName}</span>
              <span class="tag tag--{VERDICT[outcome.verdict].tone === 'flat' ? '' : VERDICT[outcome.verdict].tone}">
                {VERDICT[outcome.verdict].label}
              </span>
            </div>
            {#if outcome.metricLabel && outcome.valueAtStart !== null && outcome.valueNow !== null}
              <div class="outcome__numbers">
                {outcome.metricLabel}
                <span class="outcome__range">
                  {Math.round(outcome.valueAtStart)} → {Math.round(outcome.valueNow)}
                </span>
                <span class="outcome__floor">noise floor ±{outcome.noiseFloor}</span>
              </div>
            {/if}
            <p class="outcome__statement">{outcome.statement}</p>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if review && (review.stacked.length || review.conflicts.length || review.missing.length)}
    <section class="sec sec--prose" aria-labelledby="notice">
      <div class="sec__head">
        <h2 class="sec__title" id="notice">What I notice</h2>
      </div>
      <div class="aside">
        {#each review.stacked as stack (stack.family)}
          <p><strong>Two things doing the same job</strong> — {stack.label}: {stack.products.join(', ')}.</p>
        {/each}
        {#each review.conflicts as conflict (conflict)}
          <p>{conflict}</p>
        {/each}
        {#each review.missing as gap (gap)}
          <p>Nothing here covers <strong>{gap}</strong>.</p>
        {/each}
        {#if review.unrecognisedCount}
          <p class="aside__caveat">
            {review.unrecognisedCount} ingredient{review.unrecognisedCount === 1 ? '' : 's'} across
            your routine fall outside what I recognise, so this is a partial read.
          </p>
        {/if}
      </div>
    </section>
  {/if}

  <section class="sec" aria-labelledby="check">
    <div class="sec__head">
      <h2 class="sec__title" id="check">Check a product</h2>
    </div>
    <div class="card">
      <form class="search" onsubmit={(e) => { e.preventDefault(); void search(); }}>
        <input
          class="text-input"
          bind:value={query}
          placeholder="Search by name or brand"
          aria-label="Search products"
        />
        <button class="btn" type="submit">Search</button>
      </form>

      {#each results as product (product.id)}
        <div class="line">
          <div class="line__main">
            <span class="line__title">
              {product.brand ? `${product.brand} ` : ''}{product.name}
            </span>
            <span class="line__sub">
              {product.ingredients.length} ingredient{product.ingredients.length === 1 ? '' : 's'} on file
            </span>
          </div>
          <div class="line__end">
            <button class="btn btn--mini" onclick={() => assess(product)}>Assess</button>
            <button class="btn btn--mini" onclick={() => start(product)}>Using it</button>
          </div>
        </div>
      {/each}

      {#if assessment}
        <div class="verdict">
          <strong class="verdict__title">{VERDICT_LABEL[assessment.verdict]}</strong>
          <p class="verdict__why">{assessment.rationale}</p>
          {#each assessment.findings as finding (finding.ingredient)}
            <div class="verdict__finding">
              <span
                class="verdict__ingredient"
                data-severity={finding.severity}
              >
                {finding.ingredient}
              </span>
              <span class="verdict__reason"> — {finding.reason}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <section class="sec" aria-labelledby="add">
    <div class="sec__head">
      <h2 class="sec__title" id="add">Add a product</h2>
      <button class="btn btn--mini" onclick={() => (scanning = !scanning)}>
        {scanning ? 'Enter it by hand instead' : 'Scan the label'}
      </button>
    </div>
    <div class="card">
      {#if scanning}
        <LabelScanner
          onSaved={() => {
            scanning = false;
            void load();
          }}
        />
      {:else}
        <label class="field">
          <span>Name</span>
          <input bind:value={newName} placeholder="Niacinamide 10% + Zinc" />
        </label>
        <label class="field">
          <span>Brand</span>
          <input bind:value={newBrand} placeholder="The Ordinary" />
        </label>
        <label class="field">
          <span>Ingredients, comma separated</span>
          <textarea bind:value={newIngredients} rows="3" placeholder="Niacinamide, Zinc PCA, Glycerin"
          ></textarea>
        </label>
        <button class="btn btn--primary" onclick={add} disabled={busy || !newName.trim()}>Add</button>
      {/if}
    </div>
    <p class="legal">
      Correlation, not proof — I will never tell you a product caused something. Steady means
      steady; a change smaller than the noise floor is not a change.
    </p>
  </section>
</Page>

<style>
  .search {
    display: flex;
    gap: var(--s-2);
    margin-bottom: var(--s-1);
  }
  .search .text-input {
    flex: 1;
  }

  .outcomes {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .outcome {
    padding: var(--s-3) 0 var(--s-3) var(--s-4);
    border: 0;
    /* A colour down the leading edge only. A whole tinted card for a bad result
       reads as an alarm; a rule reads as a fact. */
    border-left: 3px solid var(--line-strong);
    border-radius: 0;
    background: none;
  }
  .outcome--good {
    border-left-color: var(--good);
  }
  .outcome--bad {
    border-left-color: var(--bad);
  }
  .outcome--flat {
    border-left-color: var(--line-strong);
  }

  .outcome__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .outcome__name {
    font-size: var(--t-lg);
    font-weight: var(--w-medium);
    color: var(--ink);
  }
  .outcome__numbers {
    margin-top: var(--s-1);
    font-size: var(--t-sm);
    color: var(--quiet);
  }
  .outcome__range,
  .outcome__floor {
    margin-left: var(--s-2);
    font-family: var(--font);
    font-feature-settings: var(--num);
    color: var(--ink-soft);
  }
  .outcome__statement {
    margin: var(--s-2) 0 0;
    max-width: var(--measure);
    font-size: var(--t-body);
    line-height: var(--lh-body);
    color: var(--ink-soft);
  }

  .aside p {
    margin: 0 0 var(--s-2);
  }
  .aside p:last-child {
    margin-bottom: 0;
  }
  /* The caveat inside her pull quote drops back to the sans. */
  .aside__caveat {
    font-family: var(--font);
    font-style: normal;
    font-size: var(--t-md);
    color: var(--quiet);
  }

  .verdict {
    margin-top: var(--s-4);
    padding: var(--s-4) 0 0;
    border: 0;
    border-top: var(--hair) solid var(--line);
    border-radius: 0;
    background: none;
  }
  .verdict__title {
    font-size: var(--t-lg);
    font-weight: var(--w-medium);
  }
  .verdict__why {
    margin: var(--s-2) 0 0;
    max-width: var(--measure);
    font-size: var(--t-body);
    line-height: var(--lh-body);
    color: var(--ink-soft);
  }
  .verdict__finding {
    margin-top: var(--s-2);
    font-size: var(--t-md);
    line-height: var(--lh-body);
  }
  .verdict__ingredient {
    color: var(--quiet);
  }
  .verdict__ingredient[data-severity='avoid'] {
    color: var(--bad);
  }
  .verdict__ingredient[data-severity='caution'] {
    color: var(--metal);
  }
  .verdict__reason {
    color: var(--quiet);
  }
</style>
