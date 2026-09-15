<script lang="ts">
  /**
   * What she would get, and where.
   *
   * One card per suggestion: the reading that asked for it, the ingredient
   * she wants, the product that carries it, the price as it was fetched, and
   * the link. The price line is written by the server from what was actually
   * compared, and is shown verbatim - this component never turns "one price"
   * into "the best price".
   *
   * Links open the shop in a new tab. Nothing is bought here; the app is the
   * consultant, not the till.
   */
  import type { ProductPick } from '@shared/types.ts';

  interface Props {
    picks: ProductPick[];
    /** Compact, for the dock under a reading; full for the routine page. */
    compact?: boolean;
    title?: string;
  }

  let { picks, compact = false, title = 'What I would get' }: Props = $props();

  const STEP_LABEL: Record<string, string> = {
    cleanse: 'Cleanse',
    treat: 'Treat',
    hydrate: 'Hydrate',
    protect: 'Protect',
  };

  function money(cents: number | null, currency: string | null): string {
    if (cents === null || !currency) return '';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  }

  const shown = $derived(compact ? picks.slice(0, 2) : picks);
</script>

{#if shown.length}
  <section class="picks" class:picks--compact={compact} aria-label={title}>
    {#if !compact}
      <div class="picks__head">
        <h2 class="picks__title">{title}</h2>
        <span class="picks__meta">ingredient first, product second</span>
      </div>
    {/if}
    <div class="picks__grid">
      {#each shown as pick (pick.suggestion.step + pick.suggestion.title)}
        {@const offers = pick.offers.slice(0, compact ? 1 : 3)}
        <article class="pick" class:pick--bare={!(pick.product?.imageUrl && !compact)}>
          {#if pick.product?.imageUrl && !compact}
            <a class="pick__image" href={pick.product.url} target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">
              <img src={pick.product.imageUrl} alt="" loading="lazy" />
            </a>
          {/if}
          <div class="pick__body">
            <p class="pick__because">
              <span class="pick__step">{STEP_LABEL[pick.suggestion.step]}</span>
              {#if pick.suggestion.because}
                · because your {pick.suggestion.because.label.toLowerCase()} read
                <span class="pick__n">{pick.suggestion.because.value}</span>
              {:else}
                · every day, whatever the reading
              {/if}
            </p>
            <h3 class="pick__want">{pick.suggestion.title}</h3>
            {#if pick.product}
              <p class="pick__product">
                <span class="pick__name">
                  {pick.product.brand ? `${pick.product.brand} ` : ''}{pick.product.name}
                </span>
                {#if pick.product.priceCents !== null}
                  <span class="pick__price">{money(pick.product.priceCents, pick.product.currency)}</span>
                {/if}
                {#if !pick.product.inStock}<span class="tag">Out of stock</span>{/if}
              </p>
              {#if pick.matched.length && !compact}
                <p class="pick__matched">carries {pick.matched.slice(0, 3).join(', ')}</p>
              {/if}
            {:else}
              <p class="pick__product pick__product--none">Not on the {pick.from ?? 'Ese'} shelf yet</p>
            {/if}
            <p class="pick__note">{pick.priceNote}</p>
            {#if !compact}
              <p class="pick__why">{pick.suggestion.why}</p>
              {#each pick.suggestion.cautions as caution (caution)}
                <p class="pick__caution">{caution}</p>
              {/each}
            {/if}
            {#if pick.product || offers.length}
              <div class="pick__actions">
                {#if pick.product}
                  <a class="btn btn--mini pick__buy" href={pick.product.url} target="_blank" rel="noopener noreferrer">
                    Get it{pick.from ? ` at ${pick.from}` : ''}
                  </a>
                {/if}
                {#if offers.length}
                  <span class="pick__also">
                    Also at
                    {#each offers as offer, i (offer.url)}
                      <a class="linkish" href={offer.url} target="_blank" rel="noopener noreferrer">{offer.merchant}</a>{offer.priceCents !== null ? ` (${money(offer.priceCents, offer.currency)})` : ''}{i < offers.length - 1 ? ', ' : ''}
                    {/each}
                  </span>
                {/if}
              </div>
            {/if}
          </div>
        </article>
      {/each}
    </div>
    {#if !compact}
      <p class="legal picks__legal">
        Prices are read from the shop and any marketplace I could actually check, at the time of
        the reading. I say when I have not compared. Ingredients matter more than the label.
      </p>
    {/if}
  </section>
{/if}

<style>
  .picks__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
    margin-bottom: var(--s-3);
  }
  .picks__title {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: var(--w-medium);
    letter-spacing: 0;
  }
  .picks__meta {
    font-size: var(--t-sm);
    letter-spacing: 0;
    text-transform: none;
    color: var(--quiet);
  }
  .picks__grid,
  .picks--compact .picks__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
  }

  .pick {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: var(--s-4);
    align-items: start;
    padding: var(--s-4) 0;
    border: 0;
    border-top: var(--hair) solid var(--line);
    border-radius: 0;
    background: none;
    box-shadow: none;
  }
  .pick:first-child {
    border-top: 0;
  }
  /* No image column when there is no image to put in it. */
  .pick--bare,
  .picks--compact .pick {
    grid-template-columns: 1fr;
  }
  .picks--compact .pick {
    padding: var(--s-3) 0;
  }
  .pick__image {
    width: 56px;
    aspect-ratio: 1;
    height: auto;
    border-radius: var(--radius);
    border: var(--hair) solid var(--line);
    overflow: hidden;
    background: var(--surface-raised);
  }
  .pick__image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .pick__body {
    min-width: 0;
  }
  .pick__because {
    margin: 0 0 var(--s-1);
    font-size: var(--t-md);
    letter-spacing: 0;
    text-transform: none;
    color: var(--ink-soft);
    max-width: 48ch;
  }
  .pick__step {
    color: var(--quiet);
  }
  .pick__n {
    font-family: var(--font);
    font-feature-settings: var(--num);
    color: var(--ink-soft);
  }
  .pick__want {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: var(--w-medium);
    color: var(--ink);
  }
  .pick__product {
    margin: var(--s-1) 0 0;
    font-size: var(--t-body);
    color: var(--ink-soft);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-2) var(--s-3);
  }
  .pick__product--none {
    color: var(--quiet);
    font-style: normal;
  }
  .pick__name {
    color: var(--ink);
    font-weight: var(--w-medium);
  }
  .pick__price {
    margin-left: auto;
    font-family: var(--font);
    font-weight: var(--w-light);
    color: var(--ink);
    font-feature-settings: var(--num);
  }
  .pick__matched,
  .pick__note,
  .pick__why,
  .pick__caution {
    margin: var(--s-1) 0 0;
    max-width: var(--measure);
    font-size: var(--t-md);
    line-height: var(--lh-body);
    color: var(--quiet);
  }
  .pick__note,
  .pick__why {
    color: var(--ink-soft);
  }
  .pick__caution {
    color: var(--bad);
  }
  .pick__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-2) var(--s-4);
    margin-top: var(--s-2);
  }
  .pick__also {
    font-size: var(--t-sm);
    color: var(--quiet);
  }
  .picks__legal {
    margin-top: var(--s-3);
  }
</style>
