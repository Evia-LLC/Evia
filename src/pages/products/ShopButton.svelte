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
</script>

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
    {shop.label}
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
    {shop.label}
  </Button>
{/if}
