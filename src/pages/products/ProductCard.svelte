<!--
  One product in the grid (products.md 2.6): the package on a soft ground, a
  badge and a heart over it (a product only - a suggestion is not saved), then brand, name, a two-line blurb, the rating
  (sample only), the price and "Shop at {retailer} ↗".

  The whole card picks the product for the panel: the name is the real button
  and its hit area is stretched over the card, so the heart and the shop link
  above it stay their own controls (no buttons inside buttons).
-->
<script lang="ts">
  import Badge from '@/ui/Badge.svelte';
  import Card from '@/ui/Card.svelte';
  import IconButton from '@/ui/IconButton.svelte';
  import type { ProductCardView } from '@/view/products.ts';
  import Bottle from './Bottle.svelte';
  import ShopButton from './ShopButton.svelte';
  import Stars from './Stars.svelte';

  interface Props {
    product: ProductCardView;
    selected?: boolean;
    saved?: boolean;
    /** The panel is a sheet (phone, tablet): picking opens it. */
    opensSheet?: boolean;
    onselect: (trigger: HTMLElement) => void;
    ontogglesave: () => void;
    onsample?: () => void;
  }

  const { product, selected = false, saved = false, opensSheet = false, onselect, ontogglesave, onsample }: Props =
    $props();

  const fullName = $derived(product.a11yName);
  let imageFailed = $state(false);
</script>

<Card as="article" tone="raised" padding="none" {selected} interactive class="pcard">
  <div class="pcard__media" class:is-selected={selected}>
    <div class="pcard__art">
      {#if product.imageUrl && !imageFailed}
        <img src={product.imageUrl} alt="" loading="lazy" decoding="async" onerror={() => (imageFailed = true)} />
      {:else}
        <Bottle kind={product.bottle} />
      {/if}
    </div>
    {#if product.badge}
      <Badge variant={product.badge.variant} class="pcard__badge">{product.badge.label}</Badge>
    {/if}
    {#if product.saveId}
      <IconButton
        icon="heart"
        variant="glass"
        size="sm"
        iconSize={17}
        filled={saved}
        pressed={saved}
        label={saved ? `Remove ${fullName} from Saved` : `Save ${fullName}`}
        onclick={ontogglesave}
        class="pcard__heart"
      />
    {/if}
  </div>

  <div class="pcard__body">
    {#if product.brand}<p class="pcard__brand">{product.brand}</p>{/if}
    <h3 class="pcard__name">
      <button
        type="button"
        class="pcard__pick"
        aria-pressed={opensSheet ? undefined : selected}
        aria-haspopup={opensSheet ? 'dialog' : undefined}
        onclick={(e) => onselect(e.currentTarget)}
      >
        {product.name}
      </button>
    </h3>
    {#if product.blurb}<p class="pcard__blurb">{product.blurb}</p>{/if}
    {#if product.rating}
      <p class="pcard__rating">
        <Stars stars={product.rating.stars} />
        <span aria-hidden="true">{product.rating.value} {product.rating.count}</span>
        <span class="visually-hidden">Sample rating {product.rating.value} out of 5, {product.rating.count.replace(/[()]/g, '')} reviews</span>
      </p>
    {/if}
    <div class="pcard__foot">
      {#if product.price}<p class="pcard__price t-num">{product.price}</p>{/if}
      {#if product.shop}
        <ShopButton shop={product.shop} product={fullName} {onsample} class="pcard__shop" />
      {/if}
    </div>
  </div>
</Card>

<style>
  :global(.pcard) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
  }

  /* The mockup's near-square art box, capped on wide cards (1920) so the
     first row's prices and shop links stay above the fold. */
  .pcard__media {
    position: relative;
    /* A definite width: with only aspect-ratio, the height cap would narrow the box too. */
    width: 100%;
    aspect-ratio: 166 / 170;
    max-height: 232px;
    background: linear-gradient(180deg, var(--blush-50) 0%, var(--blush-100) 100%);
  }
  .pcard__media.is-selected {
    background: radial-gradient(ellipse at 50% 55%, var(--disc-pink) 0%, var(--rose-100) 60%, var(--blush-50) 100%);
  }
  .pcard__art {
    position: absolute;
    inset: 16% 18% 3%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    transition: transform var(--dur-base) var(--ease-out);
  }
  .pcard__art img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    mix-blend-mode: multiply;
  }
  @media (hover: hover) {
    :global(.pcard:hover) .pcard__art {
      transform: scale(1.03);
    }
  }
  /* A long badge wraps before it can run under the heart on a slim card. */
  .pcard__media :global(.pcard__badge) {
    position: absolute;
    top: 10px;
    left: 10px;
    max-width: calc(100% - 56px);
    padding-block: 3px;
    white-space: normal;
    text-wrap: balance;
  }
  .pcard__media :global(.pcard__heart) {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 1;
  }

  .pcard__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    padding: 12px 12px 12px;
  }
  .pcard__brand {
    margin: 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    line-height: 1.3;
    color: var(--text-strong);
  }
  .pcard__name {
    margin: 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    line-height: 1.3;
    color: var(--text-strong);
  }
  .pcard__pick {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  /* The name's hit area covers the whole card. */
  .pcard__pick::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .pcard__pick:focus-visible {
    outline: none;
  }
  .pcard__pick:focus-visible::after {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: -3px;
    border-radius: var(--r-lg);
  }
  .pcard__blurb {
    margin: 2px 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.4;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  /* Stars, value and count stay on one line; on a very slim card the whole
     "4.8 (12.4k)" moves under the stars rather than splitting. */
  .pcard__rating {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
    margin: 6px 0 0;
    font-size: var(--fs-meta);
    line-height: 1.2;
    color: var(--text-muted);
  }
  .pcard__rating > span[aria-hidden] {
    white-space: nowrap;
  }
  .pcard__foot {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: auto;
    padding-top: 10px;
    /* The shop button sets the retailer on its own line when the card is narrow (ShopButton). */
    container: pcard-foot / inline-size;
  }
  .pcard__price {
    margin: 0;
    font-size: var(--fs-lead);
    font-weight: var(--fw-bold);
    line-height: 1.2;
    color: var(--text-strong);
  }
  .pcard__foot :global(.pcard__shop) {
    position: relative;
    z-index: 1;
  }
</style>
