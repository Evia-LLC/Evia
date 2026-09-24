<!--
  Your products: everything the Routine page did before the rebuild, kept
  reachable under the plan (real mode only; the sample has no products).

  - In use, with Stop using.
  - Is it working?: each product against the one reading it is meant to move.
    A change smaller than the measurement noise is "no evidence", never a
    small win, and `wrong_way` is never softened into a neutral colour.
  - What I notice: doubled-up families, conflicts, gaps, and how much of the
    routine's ingredient list was not recognised (a partial read says so).
  - Check a product (search, assess, "I use this"), and add one by hand or by
    scanning its label.

  A guest has no account to keep a product list against, so the section says
  that instead of offering controls that could only fail.
-->
<script lang="ts">
  import Button from '@/ui/Button.svelte';
  import Card from '@/ui/Card.svelte';
  import EmptyState from '@/ui/EmptyState.svelte';
  import Pill from '@/ui/Pill.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import LabelScanner from '@/products/LabelScanner.svelte';
  import type { ProductAssessment, RoutineOutcome } from '@shared/types.ts';
  import type { RoutineData } from './routine-data.svelte.ts';

  interface Props {
    data: RoutineData;
  }

  const { data }: Props = $props();
  const id = $props.id();

  let tool = $state<'none' | 'check' | 'add'>('none');
  let scanning = $state(false);
  let query = $state('');
  let newName = $state('');
  let newBrand = $state('');
  let newIngredients = $state('');

  const VERDICT: Record<RoutineOutcome['verdict'], { label: string; tone: 'sage' | 'amber' | 'neutral' }> = {
    working: { label: 'Working', tone: 'sage' },
    wrong_way: { label: 'Went the wrong way', tone: 'amber' },
    no_evidence: { label: 'No evidence', tone: 'neutral' },
    too_early: { label: 'Too early', tone: 'neutral' },
    not_scored: { label: 'Not scored', tone: 'neutral' },
    unrecognised: { label: 'Unknown', tone: 'neutral' },
  };

  const FIT: Record<ProductAssessment['verdict'], string> = {
    good_fit: 'Looks like a good fit',
    probably_fine: 'Probably fine',
    be_cautious: 'Be cautious',
    not_now: 'Not right now',
  };

  const since = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

  async function add() {
    if (!newName.trim()) return;
    await data.add({
      name: newName.trim(),
      brand: newBrand.trim() || undefined,
      ingredients: newIngredients
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (!data.actionError) {
      newName = '';
      newBrand = '';
      newIngredients = '';
      tool = 'check';
    }
  }

  const review = $derived(data.review);
  const noticed = $derived(
    Boolean(review && (review.stacked.length || review.conflicts.length || review.missing.length || review.unrecognisedCount)),
  );
</script>

<section class="rt-prod" aria-labelledby="{id}-title">
  <SectionHeader id="{id}-title" title="Your products" subtitle="What you use, and whether it is earning its place." size="sm" />

  {#if !data.account}
    <EmptyState
      icon="shopping-bag"
      title="Tracking products needs an account"
      body="Signed in, you can keep a list of what you use, and each new scan shows whether a product is moving the reading it is meant to."
      compact
    />
  {:else}
    <Card padding="sm" as="div" class="rt-prod__card">
      <h3 class="rt-prod__h">In use</h3>
      {#if data.productsStatus === 'loading' && !data.inUse.length}
        <p class="rt-prod__quiet" role="status">Loading your products…</p>
      {:else if data.productsStatus === 'error'}
        <p class="rt-prod__quiet" role="status">Your products could not be loaded just now.</p>
      {:else if data.inUse.length}
        <ul class="rt-prod__list" role="list">
          {#each data.inUse as item (item.id)}
            <li class="rt-prod__line">
              <span class="rt-prod__main">
                <span class="rt-prod__name">{item.product.brand ? `${item.product.brand} ` : ''}{item.product.name}</span>
                <span class="rt-prod__sub">Since {since(item.startedAt)}{item.frequency ? ` · ${item.frequency}` : ''}</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.busy}
                label="Stop using {item.product.name}"
                onclick={() => data.stop(item.id)}
              >
                Stop using
              </Button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="rt-prod__quiet">
          Nothing tracked yet. Check or add a product below and mark it as in use; from then on the dates are kept
          and your scans do the judging.
        </p>
      {/if}
    </Card>

    {#if data.outcomes.length}
      <Card padding="sm" as="div" class="rt-prod__card">
        <h3 class="rt-prod__h">Is it working?</h3>
        <p class="rt-prod__lede">
          Each product against the one reading it is meant to move. A change smaller than the measurement noise is
          reported as no evidence, not as a small win.
        </p>
        <ul class="rt-prod__list" role="list">
          {#each data.outcomes as outcome (outcome.productId)}
            <li class="rt-out" data-tone={VERDICT[outcome.verdict].tone}>
              <span class="rt-out__head">
                <span class="rt-prod__name">{outcome.productName}</span>
                <Pill tone={VERDICT[outcome.verdict].tone} size="sm">{VERDICT[outcome.verdict].label}</Pill>
              </span>
              {#if outcome.metricLabel && outcome.valueAtStart !== null && outcome.valueNow !== null}
                <span class="rt-prod__sub t-num">
                  {outcome.metricLabel}: {Math.round(outcome.valueAtStart)} → {Math.round(outcome.valueNow)}
                  {#if outcome.noiseFloor !== null}(noise floor ±{outcome.noiseFloor}){/if}
                </span>
              {/if}
              <span class="rt-out__statement">{outcome.statement}</span>
            </li>
          {/each}
        </ul>
      </Card>
    {/if}

    {#if review && noticed}
      <Card padding="sm" as="div" class="rt-prod__card">
        <h3 class="rt-prod__h">What I notice</h3>
        <ul class="rt-prod__notes" role="list">
          {#each review.stacked as stack (stack.family)}
            <li><strong>Two things doing the same job</strong> ({stack.label}): {stack.products.join(', ')}.</li>
          {/each}
          {#each review.conflicts as conflict (conflict)}<li>{conflict}</li>{/each}
          {#each review.missing as gap (gap)}<li>Nothing here covers <strong>{gap}</strong>.</li>{/each}
          {#if review.unrecognisedCount}
            <li class="rt-prod__quiet">
              {review.unrecognisedCount} ingredient{review.unrecognisedCount === 1 ? '' : 's'} across your routine
              {review.unrecognisedCount === 1 ? 'falls' : 'fall'} outside what I recognise, so this is a partial read.
            </li>
          {/if}
        </ul>
      </Card>
    {/if}

    <div class="rt-prod__tools">
      <Button
        variant={tool === 'check' ? 'soft' : 'secondary'}
        size="sm"
        iconStart="search"
        pressed={tool === 'check'}
        onclick={() => (tool = tool === 'check' ? 'none' : 'check')}
      >
        Check a product
      </Button>
      <Button
        variant={tool === 'add' ? 'soft' : 'secondary'}
        size="sm"
        iconStart="plus"
        pressed={tool === 'add'}
        onclick={() => (tool = tool === 'add' ? 'none' : 'add')}
      >
        Add a product
      </Button>
    </div>

    {#if data.actionError}<p class="rt-prod__error" role="alert">{data.actionError}</p>{/if}

    {#if tool === 'check'}
      <Card padding="sm" as="div" class="rt-prod__card">
        <form
          class="rt-prod__search"
          onsubmit={(e) => {
            e.preventDefault();
            void data.search(query);
          }}
        >
          <label class="visually-hidden" for="{id}-q">Search products by name or brand</label>
          <input id="{id}-q" class="rt-input" bind:value={query} placeholder="Search by name or brand" />
          <Button type="submit" variant="soft" size="sm" disabled={data.busy || !query.trim()}>Search</Button>
        </form>
        {#if data.searched && !data.results.length}
          <p class="rt-prod__quiet" role="status">Nothing found. Try another name, or add it yourself.</p>
        {/if}
        {#if data.results.length}
          <ul class="rt-prod__list" role="list">
            {#each data.results as product (product.id)}
              <li class="rt-prod__line">
                <span class="rt-prod__main">
                  <span class="rt-prod__name">{product.brand ? `${product.brand} ` : ''}{product.name}</span>
                  <span class="rt-prod__sub">
                    {product.ingredients.length} ingredient{product.ingredients.length === 1 ? '' : 's'} on file
                  </span>
                </span>
                <span class="rt-prod__acts">
                  <Button variant="secondary" size="sm" disabled={data.busy} onclick={() => data.assess(product)}>Assess</Button>
                  <Button variant="secondary" size="sm" disabled={data.busy} onclick={() => data.start(product)}>I use this</Button>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if data.assessment}
          <div class="rt-fit" aria-live="polite">
            <p class="rt-fit__title">{FIT[data.assessment.verdict]}</p>
            <p class="rt-fit__why">{data.assessment.rationale}</p>
            {#each data.assessment.findings as finding (finding.ingredient)}
              <p class="rt-fit__finding">
                <span class="rt-fit__ingredient" data-severity={finding.severity}>{finding.ingredient}</span>
                <span> — {finding.reason}</span>
              </p>
            {/each}
          </div>
        {/if}
      </Card>
    {:else if tool === 'add'}
      <Card padding="sm" as="div" class="rt-prod__card">
        <div class="rt-prod__switch">
          <Button variant="ghost" size="sm" iconStart={scanning ? 'clipboard-list' : 'camera'} onclick={() => (scanning = !scanning)}>
            {scanning ? 'Enter it by hand instead' : 'Scan the label instead'}
          </Button>
        </div>
        {#if scanning}
          <div class="rt-scanner on-dark">
            <LabelScanner
              onSaved={() => {
                scanning = false;
                tool = 'none';
                void data.loadProducts();
              }}
            />
          </div>
        {:else}
          <form
            class="rt-form"
            onsubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <label class="rt-field">
              <span>Name</span>
              <input class="rt-input" bind:value={newName} placeholder="Niacinamide 10% + Zinc" required />
            </label>
            <label class="rt-field">
              <span>Brand</span>
              <input class="rt-input" bind:value={newBrand} placeholder="Optional" />
            </label>
            <label class="rt-field">
              <span>Ingredients, comma separated</span>
              <textarea class="rt-input" bind:value={newIngredients} rows="3" placeholder="Niacinamide, Zinc PCA, Glycerin"></textarea>
            </label>
            <Button type="submit" variant="primary" size="sm" disabled={data.busy || !newName.trim()}>Add product</Button>
          </form>
        {/if}
      </Card>
    {/if}

    <p class="rt-prod__legal">
      Correlation, not proof: a product is never said to have caused a change. Steady means steady; a change smaller
      than the noise floor is not a change.
    </p>
  {/if}
</section>

<style>
  .rt-prod {
    display: grid;
    gap: 12px;
  }
  .rt-prod :global(.rt-prod__card) {
    display: grid;
    gap: 10px;
  }
  .rt-prod__h {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--fs-label);
    font-weight: var(--fw-medium);
  }
  .rt-prod__lede,
  .rt-prod__quiet {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
  }
  .rt-prod__list {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rt-prod__line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 10px 0;
    border-top: 1px solid var(--divider);
  }
  .rt-prod__line:first-child {
    border-top: 0;
    padding-top: 2px;
  }
  .rt-prod__main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .rt-prod__name {
    color: var(--text-strong);
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
  }
  .rt-prod__sub {
    color: var(--text-muted);
    font-size: var(--fs-meta);
  }
  .rt-prod__acts {
    display: flex;
    gap: 8px;
  }

  .rt-out {
    display: grid;
    gap: 4px;
    padding: 10px 0 10px 12px;
    border-left: 3px solid var(--border-strong);
  }
  .rt-out + .rt-out {
    margin-top: 8px;
  }
  .rt-out[data-tone='sage'] {
    border-left-color: var(--sage-600);
  }
  .rt-out[data-tone='amber'] {
    border-left-color: var(--text-danger);
  }
  .rt-out__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .rt-out__statement {
    color: var(--text);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
  }

  .rt-prod__notes {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
  }
  .rt-prod__notes strong {
    color: var(--text-strong);
    font-weight: var(--fw-medium);
  }

  .rt-prod__tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .rt-prod__error {
    margin: 0;
    color: var(--text-danger);
    font-size: var(--fs-body-sm);
  }

  .rt-prod__search {
    display: flex;
    gap: 8px;
  }
  .rt-input {
    flex: 1;
    width: 100%;
    min-height: 44px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--cream-0);
    color: var(--text-strong);
    font: inherit;
    font-size: var(--fs-body);
  }
  textarea.rt-input {
    resize: vertical;
  }
  .rt-input::placeholder {
    color: var(--text-muted);
  }
  .rt-input:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 1px;
  }
  .rt-form {
    display: grid;
    gap: 12px;
    justify-items: start;
  }
  .rt-field {
    display: grid;
    gap: 6px;
    width: 100%;
    color: var(--text);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
  }
  .rt-prod__switch {
    display: flex;
    justify-content: flex-end;
  }
  /* The label scanner is still drawn in the old dark style (src/products is
     restyled by the Products page); it sits on the dark ground it was made for. */
  .rt-scanner {
    padding: 12px 14px 16px;
    border-radius: var(--r-md);
    background: var(--bg);
  }

  .rt-fit {
    padding-top: 12px;
    border-top: 1px solid var(--divider);
  }
  .rt-fit__title {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--fs-label);
    font-weight: var(--fw-medium);
  }
  .rt-fit__why,
  .rt-fit__finding {
    margin: 6px 0 0;
    color: var(--text);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
  }
  .rt-fit__ingredient {
    color: var(--text-strong);
    font-weight: var(--fw-medium);
  }
  .rt-fit__ingredient[data-severity='avoid'] {
    color: var(--text-danger);
  }
  .rt-fit__ingredient[data-severity='caution'] {
    color: var(--terracotta-600);
  }

  /* Two sentences of explanation: body copy, so the body floor (decision 8). */
  .rt-prod__legal {
    max-width: 75ch;
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
  }
</style>
