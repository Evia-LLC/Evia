<!--
  The detail panel (products.md 2.8): gallery with thumbnails, brand, the
  name in the display serif, rating (sample only), price and stock, the
  description, the benefit or "Contains" icons, "Shop at {retailer} ↗", the
  affiliate disclosure, and the accordion rows.

  Rendered from `ProductDetailView`, so real mode's missing parts are simply
  absent: one picture means no thumbnails, no rating row, no "In stock" for
  a search link, and only the accordion rows that have something behind them.
  The same component is the docked panel on wide screens and the sheet's
  content on phones and tablets.
-->
<script lang="ts">
  import Badge from '@/ui/Badge.svelte';
  import Icon from '@/ui/Icon.svelte';
  import IconButton from '@/ui/IconButton.svelte';
  import type { ProductCardView } from '@/view/products.ts';
  import Bottle from './Bottle.svelte';
  import GalleryStill from './GalleryStill.svelte';
  import Glyph from './Glyph.svelte';
  import ShopButton from './ShopButton.svelte';
  import Stars from './Stars.svelte';

  interface Props {
    product: ProductCardView;
    saved: boolean;
    disclosure: string;
    /** The id the sheet labels itself by. */
    headingId?: string;
    ontogglesave: () => void;
    onsample?: () => void;
  }

  const { product, saved, disclosure, headingId, ontogglesave, onsample }: Props = $props();

  const detail = $derived(product.detail);
  const fullName = $derived(product.a11yName);

  let shown = $state(0);
  let open = $state<string[]>([]);
  let imageFailed = $state(false);

  /* A different product starts at its first picture with every row closed. */
  let lastId = '';
  $effect.pre(() => {
    if (product.id !== lastId) {
      lastId = product.id;
      shown = 0;
      open = [];
      imageFailed = false;
    }
  });

  const main = $derived(detail.gallery[Math.min(shown, detail.gallery.length - 1)]);

  function toggle(id: string) {
    open = open.includes(id) ? open.filter((x) => x !== id) : [...open, id];
  }

  const uid = `pd-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="pdetail">
  <div class="pdetail__gallery" class:has-thumbs={detail.gallery.length > 1}>
    <div class="pdetail__main">
      {#if main.kind === 'image' && !imageFailed}
        <img src={main.src} alt={main.label} decoding="async" onerror={() => (imageFailed = true)} />
      {:else if main.kind === 'still'}
        <GalleryStill still={main.still} bottle={main.bottle} />
        <span class="visually-hidden">{main.label}</span>
      {:else}
        <div class="pdetail__package"><Bottle kind={main.kind === 'bottle' ? main.bottle : product.bottle} /></div>
      {/if}
      {#if product.badge}
        <Badge variant={product.badge.variant} class="pdetail__badge">{product.badge.label}</Badge>
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
          class="pdetail__heart"
        />
      {/if}
    </div>
    {#if detail.gallery.length > 1}
      <div class="pdetail__thumbs" role="group" aria-label="Pictures">
        {#each detail.gallery as item, i (i)}
          <button
            type="button"
            class="pdetail__thumb"
            aria-pressed={shown === i}
            aria-label={`Show picture ${i + 1}: ${item.label}`}
            onclick={() => (shown = i)}
          >
            {#if item.kind === 'still'}
              <GalleryStill still={item.still} bottle={item.bottle} />
            {:else if item.kind === 'image'}
              <img src={item.src} alt="" />
            {:else}
              <Bottle kind={item.bottle} />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="pdetail__head">
    {#if detail.brand}<p class="pdetail__brand">{detail.brand}</p>{/if}
    <h2 class="pdetail__name" id={headingId}>{detail.name}</h2>
    {#if detail.rating}
      <p class="pdetail__rating">
        <Stars stars={detail.rating.stars} size={13} />
        <span aria-hidden="true">{detail.rating.value} {detail.rating.count}</span>
        <span class="visually-hidden">Sample rating {detail.rating.value} out of 5, {detail.rating.count.replace(/[()]/g, '')}</span>
      </p>
    {/if}
  </div>

  {#if detail.price || detail.stock}
    <div class="pdetail__buy">
      {#if detail.price}<p class="pdetail__price t-num">{detail.price}</p>{/if}
      {#if detail.stock}
        <p class="pdetail__stock" class:is-out={detail.stock === 'out'}>
          <span class="pdetail__dot" aria-hidden="true"></span>
          {detail.stock === 'in' ? 'In stock' : 'Out of stock'}
        </p>
      {/if}
    </div>
  {/if}
  {#if detail.priceNote}<p class="pdetail__note">{detail.priceNote}</p>{/if}

  {#if detail.description}<p class="pdetail__desc">{detail.description}</p>{/if}

  {#if detail.features.length}
    <div class="pdetail__features">
      {#if detail.featuresTitle}<p class="pdetail__features-title t-eyebrow">{detail.featuresTitle}</p>{/if}
      <ul>
        {#each detail.features as feature (feature.label)}
          <li><Glyph name={feature.icon} size={20} stroke={1.5} />{feature.label}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if detail.shop}
    <ShopButton shop={detail.shop} product={fullName} size="md" full {onsample} class="pdetail__shop" />
  {/if}
  {#if detail.alsoAt.length}
    <p class="pdetail__also">
      <span>{detail.shop ? 'Also:' : 'Look at:'}</span>
      {#each detail.alsoAt as link, i (link.label + i)}
        {#if link.url}
          <a
            href={link.url}
            target="_blank"
            rel="sponsored noopener noreferrer"
            aria-label={`${link.name ?? `${link.label}: ${fullName}`} (opens in a new tab)`}
          >
            {link.label}<Icon name="arrow-up-right" size={14} />
          </a>
        {:else}
          <span>{link.label}</span>
        {/if}
      {/each}
    </p>
  {/if}
  <p class="pdetail__disclosure">
    <Icon name="info" size={16} />
    <span>{disclosure}</span>
  </p>

  {#if detail.rows.length}
    <ul class="pdetail__rows">
      {#each detail.rows as row (row.id)}
        {@const isOpen = open.includes(row.id)}
        <li class="prow" class:is-highlight={row.highlight} class:is-open={isOpen}>
          <button
            type="button"
            class="prow__head"
            aria-expanded={isOpen}
            aria-controls="{uid}-{row.id}"
            id="{uid}-{row.id}-head"
            onclick={() => toggle(row.id)}
          >
            <span class="prow__icon"><Glyph name={row.icon} size={20} stroke={1.5} /></span>
            <span class="prow__label">{row.label}</span>
            {#if row.trailing}
              <span class="prow__trail">
                {#if row.trailing.star}<Icon name="star" size={13} filled class="prow__star" />{/if}
                {row.trailing.text}
              </span>
            {/if}
            <Icon name="chevron-right" size={16} stroke={1.6} class="prow__chev" />
          </button>
          <div class="prow__body" id="{uid}-{row.id}" role="region" aria-labelledby="{uid}-{row.id}-head" hidden={!isOpen}>
            {#each row.body as para, i (i)}<p>{para}</p>{/each}
            {#if row.list?.length}
              <ul>{#each row.list as item, i (i)}<li>{item}</li>{/each}</ul>
            {/if}
            {#if row.note}<p class="prow__note">{row.note}</p>{/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .pdetail {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }

  /* Gallery: the main picture and a column of thumbnails. */
  .pdetail__gallery {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  .pdetail__gallery.has-thumbs {
    grid-template-columns: minmax(0, 1fr) 60px;
  }
  .pdetail__main {
    position: relative;
    aspect-ratio: 240 / 237;
    overflow: hidden;
    border-radius: var(--r-md);
    background: linear-gradient(180deg, var(--blush-100), var(--blush-200));
  }
  .pdetail__main > img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: var(--cream-0);
  }
  .pdetail__package {
    position: absolute;
    inset: 14% 25% 6%;
    display: flex;
    justify-content: center;
  }
  .pdetail__main :global(.pdetail__badge) {
    position: absolute;
    top: 10px;
    left: 10px;
  }
  .pdetail__main :global(.pdetail__heart) {
    position: absolute;
    top: 4px;
    right: 4px;
  }
  .pdetail__thumbs {
    display: grid;
    grid-auto-rows: 1fr;
    gap: 6px;
  }
  .pdetail__thumb {
    position: relative;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--glass-light-rim-hi);
    border-radius: 10px;
    background: var(--blush-100);
    cursor: pointer;
    min-height: 44px;
  }
  .pdetail__thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .pdetail__thumb[aria-pressed='true'] {
    box-shadow: 0 0 0 2px var(--card-selected-rim);
  }
  .pdetail__thumb:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }

  .pdetail__head {
    display: grid;
    gap: 4px;
  }
  .pdetail__brand {
    margin: 0;
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-medium);
    color: var(--text-strong);
  }
  .pdetail__name {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--fs-title);
    font-weight: var(--fw-regular);
    line-height: 1.18;
    letter-spacing: -0.01em;
    color: var(--text-strong);
  }
  .pdetail__rating {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 2px 0 0;
    font-size: var(--fs-meta);
    color: var(--text-muted);
  }

  .pdetail__buy {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .pdetail__price {
    margin: 0;
    font-size: var(--fs-title-sm);
    font-weight: var(--fw-bold);
    color: var(--text-strong);
  }
  .pdetail__stock {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    color: var(--text-success);
  }
  .pdetail__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success);
  }
  .pdetail__stock.is-out {
    color: var(--text-secondary);
  }
  .pdetail__stock.is-out .pdetail__dot {
    background: var(--border-strong);
  }
  .pdetail__note {
    margin: -6px 0 0;
    font-size: var(--fs-meta);
    line-height: var(--lh-normal);
    color: var(--text-muted);
  }
  .pdetail__desc {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .pdetail__features ul {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pdetail__features-title {
    margin: 0 0 8px;
    color: var(--text-muted);
  }
  .pdetail__features li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-small);
    color: var(--text-secondary);
  }
  .pdetail__features li :global(.icon) {
    color: var(--choc-900);
  }

  .pdetail__also {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    margin: -4px 0 0;
    font-size: var(--fs-small);
    color: var(--text-muted);
  }
  .pdetail__also a {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-height: 32px;
    color: var(--text-link);
    font-weight: var(--fw-medium);
    text-underline-offset: 3px;
  }
  .pdetail__disclosure {
    display: flex;
    gap: 8px;
    margin: -2px 0 0;
    font-size: var(--fs-small);
    line-height: 1.45;
    color: var(--text-muted);
  }
  .pdetail__disclosure :global(.icon) {
    flex: none;
    margin-top: 1px;
  }

  /* Accordion rows. */
  .pdetail__rows {
    display: grid;
    gap: 6px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }
  .prow {
    border: 1px solid var(--divider);
    border-radius: var(--r-md);
    background: var(--cream-0);
    overflow: hidden;
  }
  .prow.is-highlight {
    background: var(--rose-300);
    border-color: var(--soft-border);
  }
  .prow__head {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 46px;
    padding: 6px 12px 6px 10px;
    border: 0;
    background: none;
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    font-weight: var(--fw-regular);
    color: var(--text-strong);
    text-align: left;
    cursor: pointer;
  }
  .prow__head:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: -2px;
    border-radius: var(--r-md);
  }
  @media (hover: hover) {
    .prow:not(.is-highlight) .prow__head:hover {
      background: var(--tint-hover);
    }
  }
  .prow__icon {
    display: grid;
    place-items: center;
    flex: none;
    color: var(--choc-800);
  }
  .is-highlight .prow__icon {
    color: var(--terracotta-600);
  }
  .is-highlight .prow__head {
    font-weight: var(--fw-medium);
    color: var(--chip-selected-ink);
  }
  .prow__label {
    flex: 1;
    min-width: 0;
  }
  .prow__trail {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-small);
    font-weight: var(--fw-medium);
    color: var(--text);
  }
  .prow__trail :global(.prow__star) {
    color: var(--star);
  }
  .prow__head :global(.prow__chev) {
    flex: none;
    color: var(--text-muted);
    transition: transform var(--dur-base) var(--ease-out);
  }
  .is-open .prow__head :global(.prow__chev) {
    transform: rotate(90deg);
  }
  .prow__body {
    padding: 0 14px 14px 42px;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .prow__body p {
    margin: 0 0 8px;
  }
  .prow__body ul {
    margin: 0 0 8px;
    padding-left: 18px;
  }
  .prow__body li {
    margin-bottom: 4px;
  }
  .prow__note {
    font-size: var(--fs-meta);
    color: var(--text-muted);
  }
  .is-highlight .prow__body,
  .is-highlight .prow__note {
    color: var(--chip-selected-ink);
  }
</style>
