<!--
  Learn: short routine basics, then the ingredient glossary.

  The basics are evergreen copy (learn/basics.ts, every line general and
  cosmetic per SRS MED-01). The glossary is the server's own ingredient
  knowledge base, read from GET /api/public/ingredients - the same notes the
  routine logic works from, so what Learn says and what the routine does
  cannot drift apart. It needs no account and holds nothing about anyone, so
  it is the same in sample mode, for a guest and for an account.

  Search matches the name, the note and the family; the family chips filter.
  While the list loads there is a quiet placeholder.

  The glossary needs no database and no account, but the API is only there
  when a server is. On a static build with no server, or a deploy with no
  database (where every /api path but health answers 503 - the state in
  which the gate says "Look around"), the page builds the same glossary in
  the browser from the bundled knowledge base, loaded only then. Only if
  that copy cannot load either is there a retry, worded for what is known.
-->
<script module lang="ts">
  import type { IngredientGlossary } from '@shared/ingredient-glossary.ts';

  /** Kept for the visit: the glossary only changes with a deploy. */
  let cache: IngredientGlossary | null = null;
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '@/lib/api.ts';
  import { session } from '@/state/session.svelte.ts';
  import Card from '@/ui/Card.svelte';
  import SectionHeader from '@/ui/SectionHeader.svelte';
  import Chip from '@/ui/Chip.svelte';
  import Button from '@/ui/Button.svelte';
  import Icon from '@/ui/Icon.svelte';
  import EmptyState from '@/ui/EmptyState.svelte';
  import PageFrame from './frame/PageFrame.svelte';
  import { BASICS, LEARN_NOTE } from './learn/basics.ts';
  import type { GlossaryIrritationRisk } from '@shared/ingredient-glossary.ts';

  let glossary = $state<IngredientGlossary | null>(cache);
  let failed = $state(false);
  let query = $state('');
  let family = $state('all');

  /** The API cannot serve anything but health when there is no server or no database. */
  const apiServes = $derived(session.serverReachable && session.databaseAvailable);

  async function load() {
    failed = false;
    if (apiServes) {
      try {
        glossary = cache = await api.ingredients();
        return;
      } catch {
        // Fall through to the bundled copy: same builder, same knowledge base.
      }
    }
    try {
      const { ingredientGlossary } = await import('../../server/skin/glossary.ts');
      glossary = cache = ingredientGlossary();
    } catch {
      failed = true;
    }
  }

  // Loads while the page has no copy yet; untracked so a session flag settling
  // mid-load does not start a second one.
  $effect(() => {
    if (!glossary) untrack(() => void load());
  });

  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const familyLabel = $derived(new Map(glossary?.families.map((f) => [f.id, capital(f.label)]) ?? []));

  const shown = $derived.by(() => {
    if (!glossary) return [];
    const q = query.trim().toLowerCase();
    return glossary.ingredients.filter((entry) => {
      if (family !== 'all' && entry.family !== family) return false;
      if (!q) return true;
      const haystack = `${entry.label} ${entry.note} ${familyLabel.get(entry.family) ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  });

  const RISK: Record<GlossaryIrritationRisk, { label: string; level: number }> = {
    none: { label: 'None known', level: 0 },
    low: { label: 'Low', level: 1 },
    moderate: { label: 'Moderate', level: 2 },
    high: { label: 'High', level: 3 },
  };

  /*
   * Reached only when the bundled copy failed to load too, which means the
   * page could not fetch its own files: a connection problem, or a build
   * replaced mid-visit. Said without blaming the server when it answered.
   */
  const failedBody = $derived(
    session.serverReachable
      ? 'Part of the page could not be fetched. Check the connection, or reload, and try again.'
      : "Evia's server is not answering and part of the page could not be fetched. Check the connection and try again.",
  );

  function clear() {
    query = '';
    family = 'all';
  }
</script>

<PageFrame title="Learn" subtitle="Plain guides to the basics of a routine, and to the ingredients that shape one.">
  <Card aria-labelledby="learn-basics">
    <SectionHeader id="learn-basics" title="Routine basics" icon="sparkle" subtitle="Evergreen habits that suit most routines." />
    <ul class="basics" role="list" aria-label="Routine basics">
      {#each BASICS as basic (basic.title)}
        <li class="basic">
          <span class="basic__icon" aria-hidden="true"><Icon name={basic.icon} size={20} /></span>
          <h3 class="basic__title">{basic.title}</h3>
          <p class="basic__body">{basic.body}</p>
        </li>
      {/each}
    </ul>
    <p class="note"><Icon name="info" size={16} stroke={1.8} /> {LEARN_NOTE}</p>
  </Card>

  <Card aria-labelledby="learn-glossary">
    <SectionHeader
      id="learn-glossary"
      title="Ingredient glossary"
      icon="book-open"
      subtitle={glossary
        ? `What Evia knows about the ${glossary.ingredients.length} ingredients and ingredient groups that shape its routine suggestions.`
        : 'What Evia knows about the ingredients that shape its routine suggestions.'}
    />

    <div class="tools">
      <label class="search">
        <span class="visually-hidden">Search the glossary</span>
        <Icon name="search" size={20} stroke={1.7} class="search__icon" />
        <input
          class="search__input"
          type="search"
          bind:value={query}
          placeholder="Search, e.g. niacinamide"
          autocomplete="off"
          disabled={!glossary}
        />
      </label>

      {#if glossary}
        <div class="families" role="radiogroup" aria-label="Filter by family">
          <Chip size="sm" mode="radio" selected={family === 'all'} onclick={() => (family = 'all')}>All</Chip>
          {#each glossary.families as f (f.id)}
            <Chip size="sm" mode="radio" selected={family === f.id} onclick={() => (family = f.id)}>{capital(f.label)}</Chip>
          {/each}
        </div>
      {/if}
    </div>

    {#if glossary}
      <p class="count" aria-live="polite">
        {shown.length === glossary.ingredients.length
          ? `Showing all ${shown.length}`
          : `Showing ${shown.length} of ${glossary.ingredients.length}`}
      </p>
      {#if shown.length}
        <ul class="entries" role="list">
          {#each shown as entry (entry.label)}
            {@const risk = RISK[entry.irritationRisk]}
            <li class="entry">
              <div class="entry__head">
                <h3 class="entry__name">{entry.label}</h3>
                <span class="entry__family">{familyLabel.get(entry.family)}</span>
              </div>
              <p class="entry__note">{entry.note}</p>
              <p class="entry__risk" data-level={risk.level}>
                <span class="meter" aria-hidden="true">
                  {#each [1, 2, 3] as step (step)}<span class="meter__dot" class:is-on={risk.level >= step}></span>{/each}
                </span>
                <span>Irritation risk: <strong>{risk.label}</strong></span>
              </p>
            </li>
          {/each}
        </ul>
      {:else}
        <EmptyState compact icon="search" title="Nothing matches" body="Try another word, or show every family.">
          {#snippet action()}
            <Button variant="secondary" size="sm" onclick={clear}>Clear the search</Button>
          {/snippet}
        </EmptyState>
      {/if}
    {:else if failed}
      <EmptyState compact icon="book-open" title="The glossary did not load" body={failedBody}>
        {#snippet action()}
          <Button variant="secondary" size="sm" onclick={load}>Try again</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="entries entries--loading" aria-busy="true" aria-label="Loading the glossary" role="list">
        {#each [1, 2, 3, 4, 5, 6] as n (n)}<li class="entry entry--ghost"></li>{/each}
      </ul>
    {/if}

    <p class="note"><Icon name="info" size={16} stroke={1.8} /> {LEARN_NOTE} Read product labels and patch test anything new.</p>
  </Card>
</PageFrame>

<style>
  /* ---- basics ---- */
  .basics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 20px 0 0;
    padding: 0;
  }
  @media (max-width: 1279px) {
    .basics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  /* Phones: one swipeable row, so the glossary is not eight cards down. */
  @media (max-width: 559px) {
    .basics {
      grid-template-columns: none;
      grid-auto-flow: column;
      grid-auto-columns: 78%;
      overflow-x: auto;
      margin-inline: calc(-1 * var(--card-pad, 18px));
      padding: 2px var(--card-pad, 18px) 6px;
      scroll-snap-type: x mandatory;
      scroll-padding-inline: var(--card-pad, 18px);
      scrollbar-width: none;
    }
    .basics::-webkit-scrollbar {
      display: none;
    }
    .basic {
      scroll-snap-align: start;
    }
  }
  .basic {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    gap: 4px 14px;
    padding: 16px;
    border: 1px solid var(--card-rim-raised);
    border-radius: var(--r-md);
    background: var(--surface-card-raised);
    list-style: none;
  }
  .basic__icon {
    grid-row: 1 / span 2;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--disc-pink);
    color: var(--terracotta-500);
  }
  .basic__title {
    margin: 0;
    align-self: center;
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    line-height: var(--lh-snug);
    color: var(--text-strong);
  }
  .basic__body {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }

  .note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 18px 0 0;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text-secondary);
  }
  .note :global(.icon) {
    flex: none;
    margin-top: 2px;
    color: var(--terracotta-500);
  }

  /* ---- glossary tools ---- */
  .tools {
    display: grid;
    gap: 14px;
    margin-top: 20px;
  }
  .search {
    position: relative;
    display: block;
    max-width: 560px;
  }
  .search :global(.search__icon) {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-secondary);
    pointer-events: none;
  }
  .search__input {
    box-sizing: border-box;
    width: 100%;
    min-height: 48px;
    padding: 0 16px 0 48px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-pill);
    background: var(--cream-0);
    color: var(--text-strong);
    font-family: var(--font-sans);
    font-size: var(--fs-label);
  }
  .search__input::placeholder {
    color: var(--text-muted);
    opacity: 1;
  }
  .search__input:focus-visible {
    outline: var(--focus-width) solid var(--focus-ring);
    outline-offset: 1px;
    border-color: var(--focus-ring);
  }
  .families {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  /* Phones: one scrolling row rather than a wall of chips. */
  @media (max-width: 819px) {
    .families {
      flex-wrap: nowrap;
      overflow-x: auto;
      margin: 0 calc(-1 * var(--card-pad, 18px));
      padding: 4px var(--card-pad, 18px) 6px;
      scrollbar-width: none;
      scroll-padding-inline: 18px;
    }
    .families::-webkit-scrollbar {
      display: none;
    }
    .families :global(.ev-chip) {
      flex: none;
    }
  }

  .count {
    margin: 16px 0 0;
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    color: var(--text-muted);
  }

  /* ---- entries ---- */
  .entries {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin: 10px 0 0;
    padding: 0;
  }
  @media (max-width: 1279px) {
    .entries {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 559px) {
    .entries {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 18px;
    border: 1px solid var(--card-rim-raised);
    border-radius: var(--r-md);
    background: var(--surface-card-raised);
    list-style: none;
  }
  .entry--ghost {
    height: 150px;
    background: linear-gradient(90deg, var(--blush-100), var(--cream-50), var(--blush-100));
    background-size: 200% 100%;
    animation: shimmer 1.4s var(--ease-in-out) infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .entry--ghost {
      animation: none;
    }
  }
  .entry__head {
    display: grid;
    gap: 2px;
  }
  .entry__name {
    margin: 0;
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    line-height: var(--lh-snug);
    color: var(--text-strong);
  }
  .entry__family {
    font-size: var(--fs-meta);
    font-weight: var(--fw-medium);
    color: var(--terracotta-500);
  }
  .entry__note {
    flex: 1;
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: var(--lh-normal);
    color: var(--text);
  }
  .entry__risk {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 4px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
    font-size: var(--fs-meta);
    color: var(--text-secondary);
  }
  .entry__risk strong {
    font-weight: var(--fw-semibold);
    color: var(--text-strong);
  }
  .meter {
    display: inline-flex;
    gap: 3px;
  }
  .meter__dot {
    width: 14px;
    height: 6px;
    border-radius: 3px;
    background: var(--bar-track);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  [data-level='1'] .meter__dot.is-on {
    background: var(--sage-500);
    box-shadow: none;
  }
  [data-level='2'] .meter__dot.is-on {
    background: var(--amber-500);
    box-shadow: none;
  }
  [data-level='3'] .meter__dot.is-on {
    background: var(--rose-700);
    box-shadow: none;
  }
</style>
