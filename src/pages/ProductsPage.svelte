<!--
  Products (ref3.png, products.md; BUILD-PLAN decision 11).

  The hero over the campaign set (the products-hero room: its Blender plate,
  drawn at the mockup's scale - its ref3 hero frame covers the hero box, the
  plate's safe margin falls outside - over its CSS stand-in until it has
  decoded) with the search, the bell and
  the profile pill floating on it, the headline, the trust line, and an
  unbranded still life where the mockup had its character (decision 3). Then
  the category chips, the grid, and the detail panel - docked beside the grid
  when the page is wide enough, otherwise a sheet (full screen on a phone).

  Everything shown comes from `productsView` (src/view/products.ts): the
  mockup's shelf in sample mode, the user's picks and the shop's catalogue in
  real mode, with designed empty states where the app honestly has nothing.
  No cart, no checkout: each product ends in "Shop at {retailer} ↗".
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { session } from '@/state/session.svelte.ts';
  import { refreshPicks } from '@/state/controller.ts';
  import { sample } from '@/sample/mode.svelte.ts';
  import { SAMPLE_PRODUCTS } from '@/sample/fixtures/products.ts';
  import { productsView, type CategoryKey, type ProductCardView } from '@/view/products.ts';
  import type { CatalogueCategory } from '@/lib/api.ts';
  import {
    loadMoreShelf,
    loadSavedShelf,
    loadShelf,
    loadShelfDetail,
    loadShelfStatus,
    resetShelf,
    shelf,
  } from '@/products/catalogue.svelte.ts';
  import { saved, toggleSaved, useSavedScope } from '@/products/saved.svelte.ts';
  import Room from '@/stage/Room.svelte';
  import NotificationBell from '@/shell/NotificationBell.svelte';
  import ProfilePill from '@/shell/ProfilePill.svelte';
  import Button from '@/ui/Button.svelte';
  import Card from '@/ui/Card.svelte';
  import Chip from '@/ui/Chip.svelte';
  import EmptyState from '@/ui/EmptyState.svelte';
  import Icon from '@/ui/Icon.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import DetailSheet from './products/DetailSheet.svelte';
  import Glyph from './products/Glyph.svelte';
  import HeroStill from './products/HeroStill.svelte';
  import ProductCard from './products/ProductCard.svelte';
  import ProductDetail from './products/ProductDetail.svelte';

  const SHELF_KEYS: readonly CategoryKey[] = [
    'cleansers',
    'toners',
    'serums',
    'moisturisers',
    'sunscreens',
    'treatments',
    'makeup',
  ];
  const isShelfCategory = (key: CategoryKey): key is CatalogueCategory => SHELF_KEYS.includes(key);

  let category = $state<CategoryKey>('recommended');
  let query = $state('');
  let settledQuery = $state('');
  let selectedId = $state<string | null>(null);
  let sheetOpen = $state(false);
  let width = $state(0);
  let picksLoading = $state(false);
  let sampleNote = $state(false);

  /* The panel docks beside the grid once there is room for both. */
  const docked = $derived(width >= 960);
  const signedIn = $derived(Boolean(session.user) && !session.guest);

  const view = $derived(
    productsView(sample.on, SAMPLE_PRODUCTS, {
      guest: session.guest,
      signedIn,
      hasScan: Boolean(session.latestScan),
      picks: session.picks,
      picksLoading,
      storeName: shelf.storeName,
      shelfCount: shelf.shelfCount,
      catalogue: {
        status: shelf.status,
        items: shelf.items,
        total: shelf.total,
        nextCursor: shelf.nextCursor,
        loadingMore: shelf.loadingMore,
      },
      savedItems: shelf.savedItems,
      extras: shelf.extras,
      category,
      query: sample.on ? query : settledQuery,
      savedIds: saved.ids,
      savedKept: saved.kept,
    }),
  );

  /* Nothing to show in any section (real mode before a scan, an empty shelf):
     the empty states sit side by side instead of down the left half. */
  const allEmpty = $derived(view.sections.length > 1 && view.sections.every((s) => !s.loading && !s.products.length));

  const everything = $derived(
    view.sections.flatMap((s) => s.products).filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i),
  );
  /* The affiliate disclosure sits over the first grid that has shop links in it. */
  const disclosureAt = $derived(view.sections.findIndex((s) => s.products.some((p) => p.shop)));
  /* Docked, the panel always shows something: the picked product, or the first. */
  const selected = $derived<ProductCardView | null>(
    everything.find((p) => p.id === selectedId) ?? (docked ? (everything[0] ?? null) : null),
  );

  /* The Saved list that belongs to whoever is here: the preview, this account, or a guest (tab only). */
  $effect.pre(() => {
    useSavedScope(sample.on ? 'sample' : signedIn && session.user ? `account:${session.user.id}` : 'guest');
  });
  const isSaved = (p: ProductCardView) => Boolean(p.saveId && saved.ids.includes(p.saveId));
  const toggle = (p: ProductCardView) => p.saveId && toggleSaved(p.saveId);

  /* Typing settles for a moment before the shelf is asked again. */
  $effect(() => {
    const q = query;
    const timer = setTimeout(() => (settledQuery = q), 280);
    return () => clearTimeout(timer);
  });

  /*
   * The shelf for the chip and search in view (real mode only). A different
   * account (or a guest) never sees the last one's assessments: the shelf is
   * forgotten first and then loaded again for whoever is here now - in one
   * effect, so the reset can never land after the new load and leave it idle.
   */
  let lastUser: string | null | undefined;
  $effect(() => {
    if (sample.on) return;
    const cat = category;
    const q = settledQuery;
    const who = signedIn;
    const id = session.user?.id ?? null;
    untrack(() => {
      if (lastUser !== undefined && id !== lastUser) resetShelf();
      lastUser = id;
      /* Saved products are fetched by id instead (they may be on any page of the shelf). */
      if (cat === 'saved') return;
      void loadShelf({ category: isShelfCategory(cat) ? cat : null, q, limit: cat === 'recommended' ? 12 : 60 }, who);
    });
  });

  /* The saved shelf products, when the Saved chip is open. */
  $effect(() => {
    if (sample.on || !signedIn || category !== 'saved') return;
    const ids = saved.ids.filter((x) => x.startsWith('shelf:')).map((x) => x.slice('shelf:'.length));
    untrack(() => loadSavedShelf(ids));
  });

  /* The picks for the latest reading, when they have not been read yet. */
  let picksAskedFor: string | null = null;
  $effect(() => {
    const id = session.user?.id ?? null;
    if (sample.on || !signedIn || !session.latestScan || session.picks.length || picksAskedFor === id) return;
    picksAskedFor = id;
    picksLoading = true;
    void refreshPicks().finally(() => (picksLoading = false));
  });

  /* What an opened shelf product's ingredient list says. */
  $effect(() => {
    const id = selected?.catalogueId;
    if (!sample.on && signedIn && id) untrack(() => void loadShelfDetail(id));
  });

  /* The shop's name and size (public), once real mode is on. */
  $effect(() => {
    if (!sample.on) untrack(() => void loadShelfStatus());
  });

  let sheetTrigger = $state<HTMLElement | null>(null);
  function pick(product: ProductCardView, trigger: HTMLElement) {
    selectedId = product.id;
    if (!docked) {
      sheetTrigger = trigger;
      sheetOpen = true;
    }
  }

  function choose(key: CategoryKey) {
    category = key;
    selectedId = null;
  }

  /*
   * The chip row scrolls sideways when the chips do not fit (the shared
   * sidebar leaves less room than the mockup had). Touch swipes it and Tab
   * brings a chip into view; for a mouse there are arrow buttons at the ends,
   * shown only while there is more to that side.
   */
  let chipRow = $state<HTMLElement | null>(null);
  let chipMore = $state({ start: false, end: false });
  function measureChips() {
    const el = chipRow;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft > 2;
    const end = el.scrollLeft < max - 2;
    if (start !== chipMore.start || end !== chipMore.end) chipMore = { start, end };
  }
  $effect(() => {
    const el = chipRow;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureChips);
    ro.observe(el);
    return () => ro.disconnect();
  });
  /* The Saved chip comes and goes. */
  $effect(() => {
    void view.categories.length;
    void tick().then(measureChips);
  });
  function nudgeChips(direction: 1 | -1) {
    const el = chipRow;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: reduce ? 'auto' : 'smooth' });
  }

  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  function showSampleNote() {
    sampleNote = true;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (sampleNote = false), 4200);
  }
</script>

{#snippet viewAll()}
  <Button variant="ghost" size="sm" iconEnd="arrow-right" onclick={() => choose('all')}>View all</Button>
{/snippet}

<div class="products" class:is-sample={sample.on} bind:clientWidth={width}>
  <header class="phero">
    <Room room="products-hero" layout="fill" fit="ref" />

    <div class="phero__bar">
      <form class="search" role="search" onsubmit={(e) => e.preventDefault()}>
        <label class="visually-hidden" for="products-search">Search products, ingredients or brands</label>
        <Icon name="search" size={20} class="search__icon" />
        <input
          id="products-search"
          class="search__input"
          type="search"
          placeholder={view.searchPlaceholder}
          autocomplete="off"
          enterkeyhint="search"
          bind:value={query}
        />
        {#if query}
          <button type="button" class="search__clear" aria-label="Clear the search" onclick={() => (query = '')}>
            <Icon name="x" size={18} />
          </button>
        {/if}
      </form>
      <div class="phero__actions">
        <NotificationBell />
        <ProfilePill tone="light" compact={width < 700} class="phero__profile" />
      </div>
    </div>

    <div class="phero__copy">
      <h1 class="phero__title">
        <span>{view.hero.headline[0]}</span>
        <span>{view.hero.headline[1]}</span>
      </h1>
      <p class="phero__sub">{view.hero.subtitle}</p>
      {#if view.hero.trust.length}
        <ul class="phero__trust">
          {#each view.hero.trust as claim (claim)}
            <li><Glyph name="check-disc" size={18} class="phero__check" />{claim}</li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="phero__still"><HeroStill /></div>

    <blockquote class="phero__quote">
      {#each view.hero.quote as line, i (i)}
        <span class="phero__quote-line" class:is-sign={i === view.hero.quote.length - 1}>
          {line}{#if i === view.hero.quote.length - 1}<Icon name="heart" size={15} stroke={1.3} class="phero__quote-heart" />{/if}
        </span>
      {/each}
    </blockquote>
  </header>

  <nav class="chips" aria-label="Product categories" class:has-start={chipMore.start} class:has-end={chipMore.end}>
    <!-- Toggle buttons (aria-pressed): one is on at a time, and each is its own Tab stop. -->
    <div
      class="chips__row"
      class:is-many={view.categories.length > 8}
      style:--chip-cols2={Math.ceil(view.categories.length / 2)}
      style:--chip-cols3={Math.ceil(view.categories.length / 3)}
      role="group"
      aria-label="Show"
      bind:this={chipRow}
      onscroll={measureChips}
    >
      {#each view.categories as chip (chip.key)}
        <Chip selected={category === chip.key} onclick={() => choose(chip.key)} class="chips__chip">
          <span class="chip-in" class:is-two={chip.lines}>
            <Glyph name={chip.icon} size={20} filled={chip.iconFilled} class="ev-chip__icon" />
            {#if chip.lines}
              <span class="chip-in__two">{chip.lines[0]}<br />{chip.lines[1]}</span>
            {:else}
              <span>{chip.label}</span>
            {/if}
          </span>
        </Chip>
      {/each}
    </div>
    <!-- A mouse convenience only: keyboard users Tab along the chips, touch swipes. -->
    {#if chipMore.start}
      <button type="button" class="chips__nudge is-start" tabindex="-1" aria-hidden="true" onclick={() => nudgeChips(-1)}>
        <Icon name="chevron-left" size={20} />
      </button>
    {/if}
    {#if chipMore.end}
      <button type="button" class="chips__nudge is-end" tabindex="-1" aria-hidden="true" onclick={() => nudgeChips(1)}>
        <Icon name="chevron-right" size={20} />
      </button>
    {/if}
  </nav>

  <div class="body" class:is-docked={docked && selected}>
    <div class="list" class:is-empty={allEmpty}>
      {#each view.sections as section, si (section.id)}
        <section class="section" aria-labelledby="products-sec-{section.id}">
          <SectionHeader
            id="products-sec-{section.id}"
            title={section.title}
            accent={section.accent}
            subtitle={section.subtitle}
            size="lg"
            action={section.viewAll ? viewAll : undefined}
            class="section__head"
          />
          {#if si === disclosureAt}
            <p class="disclosure"><Icon name="info" size={16} />{view.disclosure}</p>
          {/if}

          {#if section.loading}
            <ul class="grid" aria-hidden="true">
              {#each [0, 1, 2] as i (i)}<li class="skeleton"></li>{/each}
            </ul>
            <p class="visually-hidden" role="status">Loading products</p>
          {:else if section.products.length}
            <ul class="grid">
              {#each section.products as product (product.id)}
                <li>
                  <ProductCard
                    {product}
                    selected={docked && selected?.id === product.id}
                    saved={isSaved(product)}
                    opensSheet={!docked}
                    onselect={(trigger) => pick(product, trigger)}
                    ontogglesave={() => toggle(product)}
                    onsample={showSampleNote}
                  />
                </li>
              {/each}
            </ul>
            {#if section.more}
              <div class="more">
                <p class="more__count" aria-live="polite">Showing {section.more.shown} of {section.more.total}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  iconEnd="chevron-down"
                  disabled={section.more.loading}
                  onclick={() => void loadMoreShelf()}
                >
                  {section.more.loading ? 'Loading…' : 'Show more'}
                </Button>
              </div>
            {/if}
          {:else if section.empty}
            {@const empty = section.empty}
            <Card tone="sunken" padding="sm" class="pempty">
              <EmptyState title={empty.title} body={empty.body} icon={empty.icon} level={3}>
                {#snippet action()}
                  {#if empty.action}
                    <Button variant="primary" href={empty.action.href} iconStart={empty.action.icon}>{empty.action.label}</Button>
                  {/if}
                {/snippet}
              </EmptyState>
            </Card>
          {/if}
        </section>
      {/each}
    </div>

    {#if docked && selected}
      <aside class="detail" aria-label="Product details">
        <div class="detail__inner">
          <ProductDetail
            product={selected}
            saved={isSaved(selected)}
            disclosure={view.disclosure}
            ontogglesave={() => toggle(selected)}
            onsample={showSampleNote}
          />
        </div>
      </aside>
    {/if}
  </div>
</div>

{#if !docked && sheetOpen && selected}
  <DetailSheet labelledby="products-sheet-title" returnFocus={sheetTrigger} onclose={() => (sheetOpen = false)}>
    <ProductDetail
      product={selected}
      saved={isSaved(selected)}
      disclosure={view.disclosure}
      headingId="products-sheet-title"
      ontogglesave={() => toggle(selected)}
      onsample={showSampleNote}
    />
  </DetailSheet>
{/if}

{#if sampleNote}
  <p class="sample-note" role="status">
    <Icon name="info" size={18} />Sample data: shop links are switched off in the preview.
  </p>
{/if}

<style>
  .products {
    container: products / inline-size;
    min-height: 100%;
    color: var(--text);
  }

  /* ---- hero -------------------------------------------------------------- */
  .phero {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    min-height: clamp(300px, 29.3cqw, 400px);
    padding: var(--topbar-top) var(--topbar-right) 26px 28px;
    border-bottom: 1px solid var(--glass-light-rim-hi);
  }
  .phero > :global(.ev-room) {
    z-index: -1;
  }

  .phero__bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 16px;
    padding-top: var(--safe-t);
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 1 380px;
    min-width: 0;
    height: 50px;
    padding: 0 8px 0 18px;
    border-radius: var(--r-pill);
    background: var(--glass-light);
    box-shadow:
      inset 0 0 0 1px var(--glass-light-rim-hi),
      var(--shadow-xs);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
  }
  .search :global(.search__icon) {
    color: var(--ink-800);
  }
  .search__input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 8px 0 12px;
    border: 0;
    background: none;
    font-family: var(--font-sans);
    font-size: var(--fs-body-sm);
    color: var(--text-strong);
    text-overflow: ellipsis;
    outline: none;
  }
  .search__input::placeholder {
    color: var(--text-muted);
    opacity: 1;
  }
  .search__input::-webkit-search-cancel-button {
    display: none;
  }
  .search:focus-within {
    box-shadow:
      inset 0 0 0 1px var(--glass-light-rim-hi),
      0 0 0 var(--focus-width) var(--focus-ring);
  }
  .search__clear {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .search__clear:hover {
    background: var(--tint-hover);
  }
  .search__clear:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
  }
  .phero__actions {
    display: flex;
    align-items: center;
    gap: var(--topbar-gap);
    margin-left: auto;
  }

  .phero__copy {
    position: relative;
    max-width: 470px;
    padding: 14px 0 0 16px;
  }
  .phero__title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--fs-display);
    font-weight: var(--fw-regular);
    line-height: 0.99;
    letter-spacing: var(--tr-display);
    color: var(--text-strong);
    font-optical-sizing: auto;
  }
  .phero__title span {
    display: block;
  }
  .phero__sub {
    margin: 14px 0 0;
    font-size: var(--fs-body);
    line-height: 1.4;
    color: var(--text);
  }
  .phero__trust {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin: 18px 0 0;
    padding: 0;
    list-style: none;
  }
  .phero__trust li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-small);
    line-height: 1.3;
    color: var(--text);
  }
  .phero__trust :global(.phero__check) {
    color: var(--terracotta-500);
  }

  .phero__still {
    position: absolute;
    right: 210px;
    bottom: 0;
    height: 84%;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .phero__quote {
    position: absolute;
    right: 3%;
    top: 30%;
    display: grid;
    justify-items: center;
    margin: 0;
    font-family: var(--font-script);
    font-size: max(20px, var(--fs-script));
    line-height: 1.12;
    color: var(--choc-900);
    transform: rotate(-10deg);
    transform-origin: 50% 50%;
  }
  .phero__quote-line.is-sign {
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* Narrower pages tighten the set, then drop the quote, then the still life. */
  @container products (max-width: 1099px) {
    .phero__still {
      right: 186px;
      height: 80%;
    }
    .phero__quote {
      right: 2.5%;
      font-size: max(20px, calc(var(--fs-script) - 2px));
    }
  }
  @container products (max-width: 939px) {
    .phero__quote {
      display: none;
    }
    .phero__still {
      right: 24px;
      height: 78%;
    }
  }
  @container products (max-width: 759px) {
    .phero__still {
      height: 62%;
      right: 8px;
      opacity: 0.9;
    }
    .phero__copy {
      max-width: 62%;
    }
  }
  @container products (max-width: 599px) {
    .phero {
      min-height: 0;
      padding: calc(12px + var(--sample-space)) 16px 22px;
    }
    .phero__bar {
      gap: 8px;
    }
    .search {
      flex: 1 1 auto;
      height: 46px;
      padding-left: 14px;
    }
    .phero__actions {
      gap: 4px;
    }
    .phero__copy {
      max-width: none;
      padding: 22px 0 0;
    }
    .phero__still {
      display: none;
    }
    .phero__sub {
      margin-top: 10px;
    }
    .phero__trust {
      margin-top: 16px;
      gap: 8px 16px;
    }
  }

  /* ---- chips ------------------------------------------------------------- */
  .chips {
    position: relative;
    background: var(--blush-100);
    border-bottom: 1px solid var(--divider);
  }
  .chips__row {
    display: flex;
    gap: 10px;
    padding: 12px 20px;
    overflow-x: auto;
    scrollbar-width: none;
    scroll-padding-inline: 56px;
  }
  .chips__row::-webkit-scrollbar {
    display: none;
  }
  /* A soft fade at an edge with more chips beyond it says the row scrolls. */
  .chips::before,
  .chips::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 36px;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .chips::before {
    left: 0;
    z-index: 1;
    background: linear-gradient(270deg, transparent, var(--blush-100) 70%);
  }
  .chips::after {
    right: 0;
    background: linear-gradient(90deg, transparent, var(--blush-100) 70%);
  }
  .chips.has-start::before,
  .chips.has-end::after {
    opacity: 1;
  }
  .chips__nudge {
    position: absolute;
    top: 50%;
    z-index: 2;
    display: none;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid var(--chip-border);
    border-radius: 50%;
    background: var(--surface-card);
    box-shadow: var(--shadow-sm);
    color: var(--text-strong);
    cursor: pointer;
    transform: translateY(-50%);
  }
  .chips__nudge:hover {
    background: var(--blush-50);
  }
  .chips__nudge.is-start {
    left: 8px;
  }
  .chips__nudge.is-end {
    right: 8px;
  }
  /* The arrows are for a mouse; a touch screen swipes the row. */
  @media (hover: hover) and (pointer: fine) {
    .chips__nudge {
      display: grid;
    }
    .chips::before,
    .chips::after {
      width: 72px;
    }
  }
  .chips__row :global(.chips__chip) {
    flex: none;
    min-height: 52px;
    padding: 0 16px 0 14px;
  }
  .chip-in {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }
  /*
   * On a desktop or tablet page every chip stays in view. Where the shared
   * sidebar (248px against the mockup's 160) leaves too little room for one
   * row (the mockup's 1222 and 1280), the chips form an even grid of two rows
   * (three on a tablet) rather than hiding "Treatments" and "Makeup" behind a
   * scroll arrow or leaving one chip alone on a second row. A phone keeps the
   * swipeable row.
   */
  @container products (min-width: 600px) {
    .chips__row {
      flex-wrap: wrap;
      overflow-x: visible;
    }
  }
  @container products (min-width: 600px) and (max-width: 1119px) {
    .chips__row {
      display: grid;
      grid-template-columns: repeat(var(--chip-cols3), minmax(0, 1fr));
    }
    .chips__row :global(.chips__chip) {
      justify-content: center;
    }
  }
  @container products (min-width: 900px) and (max-width: 1119px) {
    .chips__row {
      grid-template-columns: repeat(var(--chip-cols2), minmax(0, 1fr));
    }
  }
  /* With the Saved chip there are nine: one row needs about 120px more. */
  @container products (min-width: 1120px) and (max-width: 1239px) {
    .chips__row.is-many {
      display: grid;
      grid-template-columns: repeat(var(--chip-cols2), minmax(0, 1fr));
    }
    .chips__row.is-many :global(.chips__chip) {
      justify-content: center;
    }
  }
  /* Where the shared sidebar takes the mockup's room, the chips tighten a little first. */
  @container products (max-width: 1239px) {
    .chips__row {
      gap: 8px;
      padding-inline: 16px;
    }
    .chips__row :global(.chips__chip) {
      padding: 0 13px 0 11px;
    }
    .chip-in {
      gap: 9px;
    }
  }
  .chip-in__two {
    line-height: 1.2;
  }
  @container products (max-width: 599px) {
    .chips__row {
      padding: 10px 16px;
      gap: 8px;
    }
    .chips__row :global(.chips__chip) {
      min-height: 46px;
    }
  }

  /* ---- body: the grid and the panel -------------------------------------- */
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  /* 350px at least, so the panel's benefit line and its longest row label
     ("How to use (with demonstration)") each stay on one line. */
  .body.is-docked {
    grid-template-columns: minmax(0, 1fr) clamp(350px, 32%, 400px);
  }
  .list {
    container: plist / inline-size;
    display: grid;
    gap: 36px;
    align-content: start;
    min-width: 0;
    padding: 22px 20px 48px;
  }
  .section {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .disclosure {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: -6px 0 2px;
    max-width: 75ch;
    font-size: var(--fs-small);
    line-height: 1.45;
    color: var(--text-muted);
  }
  .disclosure :global(.icon) {
    flex: none;
  }
  /*
   * Cards are at least 178px wide and at most four to a row, the mockup's
   * rhythm: on a very wide screen the cards grow rather than a fifth and
   * sixth column leaving a ragged last row.
   */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(max(178px, calc((100% - 30px) / 4)), 1fr));
    gap: 16px 10px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
  .grid > li {
    min-width: 0;
  }
  /*
   * Beside the docked panel at the mockup's size (1222) and at 1280 the list
   * has 580-650px. The mockup fits four 166px cards there, but with its 5-10px
   * text; at the readable sizes (decision 8) four cards of about 145px broke
   * their badges, ratings and blurbs over extra lines. So the base rule above
   * gives three cards of 185-210px there (3 + 3 + 2), and four from about
   * 1440 up, where each is 200px or more.
   */
  .more {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px 16px;
    margin-top: 6px;
  }
  .more__count {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }
  @container products (max-width: 599px) {
    .list {
      padding: 18px 16px 32px;
      gap: 28px;
    }
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 10px;
    }
    /*
     * Two cards abreast leave "Search Amazon ↗" little room: less padding,
     * and on the narrowest phones the label wraps rather than being cut.
     */
    .grid :global(.pcard__shop.ev-btn) {
      --btn-px: 8px;
      gap: 4px;
      padding-block: 4px;
    }
    .grid :global(.pcard__shop .ev-btn__label) {
      white-space: normal;
      text-align: center;
      line-height: 1.15;
    }
  }
  .skeleton {
    height: 360px;
    border-radius: var(--r-lg);
    background: linear-gradient(100deg, var(--blush-100) 30%, var(--cream-50) 50%, var(--blush-100) 70%);
    background-size: 300% 100%;
    animation: shimmer 1.6s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -150% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
    }
  }
  .list :global(.pempty) {
    max-width: 640px;
  }
  @container products (min-width: 820px) {
    .list.is-empty {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 28px 20px;
    }
    .list.is-empty .section {
      grid-template-rows: auto 1fr;
    }
    .list.is-empty :global(.pempty) {
      max-width: none;
    }
  }

  .detail {
    min-width: 0;
    background: var(--surface-card);
    border-left: 1px solid var(--card-rim);
    box-shadow: var(--shadow-sm);
    border-bottom-left-radius: var(--r-md);
  }
  .detail__inner {
    position: sticky;
    top: 0;
    max-height: calc(var(--vvh) - var(--sample-band, 0px));
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px 18px 32px;
    scrollbar-width: thin;
  }

  .sample-note {
    position: fixed;
    left: 50%;
    bottom: calc(24px + var(--tabbar-h) + var(--safe-b));
    z-index: var(--z-badge);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 32px);
    margin: 0;
    padding: 10px 16px;
    border-radius: var(--r-pill);
    background: var(--sample-bg);
    box-shadow: inset 0 0 0 1px var(--sample-rim), var(--shadow-md);
    color: var(--sample-ink);
    font-size: var(--fs-body-sm);
    transform: translateX(-50%);
  }
  @media (min-width: 820px) {
    .sample-note {
      bottom: 28px;
    }
  }
</style>
