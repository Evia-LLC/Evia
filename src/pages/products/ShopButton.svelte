<!--
  "Shop at {retailer} ↗" (BUILD-PLAN decision 11): the only way a product
  leaves the page. There is no cart and no checkout here.

  A real link opens the retailer in a new tab with rel="sponsored noopener
  noreferrer" - sponsored because it may carry an affiliate tag, noreferrer so
  the retailer is not told which page of Evia sent them. The URL is used
  exactly as the server sent it: nothing is added to it here, and nothing
  about the user or their reading ever is (SRS ADS-01).

  In sample mode there is no URL: the button says so when pressed instead of
  sending anyone to a real shop with a sample price.

  The retailer is the point of the button, so it is never cut off with an
  ellipsis: in a narrow product card (the card foot is a size container) the
  name sits on its own line under "Shop at", the same in every card of the
  grid; elsewhere a name too long for the line wraps whole onto the next.
-->
<script lang="ts">
  import Button from '@/ui/Button.svelte';
  import type { ShopLinkView } from '@/view/products.ts';

  interface Props {
    shop: ShopLinkView;
    /** What the link is for, for screen readers ("CeraVe Hydrating Facial Cleanser"), unless the link names itself. */
    product: string;
    size?: 'sm' | 'md';
    variant?: 'soft' | 'secondary';
    full?: boolean;
    onsample?: () => void;
    class?: string;
  }

  const { shop, product, size = 'sm', variant = 'soft', full = true, onsample, class: className = '' }: Props =
    $props();

  /* A search names its own term (the words it actually searches for). */
  const label = $derived(shop.name ?? `${shop.label}: ${product}`);
  /* "Shop at {retailer}" is drawn as two parts so the retailer can take its own line. */
  const split = $derived(shop.kind === 'product' && shop.label === `Shop at ${shop.retailer}`);
</script>

{#snippet text()}
  {#if split}<span class="shop-btn__lead">Shop at</span> <span class="shop-btn__who">{shop.retailer}</span>{:else}{shop.label}{/if}
{/snippet}

{#if shop.url}
  <Button
    {variant}
    {size}
    shape="rounded"
    {full}
    href={shop.url}
    external
    rel="sponsored noopener noreferrer"
    iconEnd="arrow-up-right"
    label={`${label} (opens in a new tab)`}
    class="shop-btn {className}"
  >
    {@render text()}
  </Button>
{:else}
  <Button
    {variant}
    {size}
    shape="rounded"
    {full}
    iconEnd="arrow-up-right"
    label={`${label} (sample: shop links are off in the preview)`}
    onclick={() => onsample?.()}
    class="shop-btn {className}"
  >
    {@render text()}
  </Button>
{/if}

<style>
  /* The doubled class outranks the Button's own scoped size rules. */
  :global(.ev-btn.shop-btn.shop-btn) {
    white-space: normal;
    padding-block: 5px;
  }
  :global(.shop-btn .ev-btn__label) {
    text-align: center;
  }
  .shop-btn__who {
    display: inline-block;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  /* A narrow product card: "Shop at" over the retailer, in every card alike. */
  @container pcard-foot (max-width: 239px) {
    :global(.ev-btn.shop-btn.shop-btn) {
      --btn-px: 10px;
      gap: 6px;
      line-height: 1.15;
    }
    .shop-btn__who {
      display: block;
    }
  }
</style>
