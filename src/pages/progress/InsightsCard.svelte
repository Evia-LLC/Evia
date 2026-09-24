<!--
  Evia's insights (progress.md 2.16).

  The mockup's portrait tile keeps its shape and pink ground but holds only
  the wordmark: no character for now (BUILD-PLAN decision 3). Real mode's text
  is the trend summary's own sentence, any "while you were using" correlation
  (stated as a correlation), and a routine outcome statement - general,
  non-diagnostic, and nothing that was not measured. The signature and the
  caps tagline are sample-only (listed for counsel).
-->
<script lang="ts">
  import Card from '@/ui/Card.svelte';
  import Icon from '@/ui/Icon.svelte';
  import Button from '@/ui/Button.svelte';
  import type { InsightsView } from '@/view/progress.ts';
  import { tapSize } from './tap.svelte.ts';

  interface Props {
    view: InsightsView;
    onask?: (question: string) => void;
    class?: string;
  }

  const { view, onask, class: className = '' }: Props = $props();
  const id = $props.id();
</script>

<Card as="section" padding="none" class="pg-card pg-ins {className}" aria-labelledby="{id}-title">
  <div class="pg-ins__inner">
    <span class="pg-ins__tile" aria-hidden="true"><span class="pg-ins__mark">evia</span></span>
    <div class="pg-ins__main">
      <h2 class="pg-ins__title" id="{id}-title">Evia&rsquo;s insights</h2>
      <div class="pg-ins__row">
        <span class="pg-ins__disc" aria-hidden="true"><Icon name="shield" size={20} filled /></span>
        <div class="pg-ins__text">
          {#if view.paragraphs.length}
            {#each view.paragraphs as paragraph, i (i)}
              <p>{paragraph}</p>
            {/each}
          {:else if view.empty}
            <p class="pg-ins__empty">{view.empty}</p>
          {/if}
        </div>
        {#if view.signature}
          <span class="pg-ins__chev" aria-hidden="true"><Icon name="chevron-right" size={18} stroke={1.5} /></span>
        {/if}
      </div>
      {#if view.signature || view.tagline}
        <div class="pg-ins__foot">
          {#if view.signature}
            <span class="pg-ins__sig" aria-label="Evia">
              <span class="t-script">Evia</span>
              <Icon name="heart" size={17} stroke={1.3} />
            </span>
          {/if}
          {#if view.tagline}
            <span class="pg-ins__tag">{view.tagline[0]}<br />{view.tagline[1]}</span>
          {/if}
        </div>
      {:else if view.ask && onask}
        <div class="pg-ins__foot pg-ins__foot--ask">
          <Button variant="ghost" size={tapSize()} iconEnd="chevron-right" onclick={() => onask?.(view.ask!)}>
            Ask Evia about your progress
          </Button>
        </div>
      {/if}
    </div>
  </div>
</Card>

<style>
  .pg-ins__inner {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    column-gap: 21px;
    height: 100%;
    padding: 13px 22px 12px 17px;
  }
  .pg-ins__tile {
    display: grid;
    place-items: center;
    width: 64px;
    height: 67px;
    border-radius: 24px;
    background: linear-gradient(160deg, var(--portrait-pink-hi), var(--portrait-pink));
    box-shadow: inset 0 0 0 1px var(--portrait-rim);
  }
  .pg-ins__mark {
    font-family: var(--font-serif);
    font-size: 20px;
    font-weight: 380;
    letter-spacing: -0.03em;
    color: #7a3e36;
  }
  .pg-ins__main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .pg-ins__title {
    margin: 2px 0 8px;
    font-size: var(--fs-lead);
    font-weight: var(--fw-medium);
    line-height: 1.3;
    color: var(--text-strong);
  }
  .pg-ins__row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    column-gap: 16px;
    align-items: start;
  }
  .pg-ins__disc {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-top: 2px;
    border-radius: 50%;
    background: var(--sage-green-disc);
    color: var(--cream-0);
  }
  .pg-ins__text p {
    margin: 0;
    max-width: 62ch;
    font-size: var(--fs-body-sm);
    line-height: 1.32;
    color: var(--text);
  }
  .pg-ins__text p + p {
    margin-top: 6px;
  }
  .pg-ins__text .pg-ins__empty {
    color: var(--text-secondary);
  }
  .pg-ins__chev {
    align-self: center;
    color: var(--text-muted);
  }
  .pg-ins__foot {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-top: auto;
    padding: 6px 0 0 56px;
  }
  .pg-ins__foot--ask {
    padding-left: 44px;
  }
  .pg-ins__sig {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-800);
  }
  .pg-ins__sig .t-script {
    font-size: 32px;
    line-height: 1;
  }
  .pg-ins__tag {
    font-size: var(--fs-small);
    line-height: 16px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  @container card (max-width: 460px) {
    .pg-ins__inner {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 10px;
      padding: 16px 18px;
    }
    .pg-ins__tile {
      display: none;
    }
    .pg-ins__foot,
    .pg-ins__foot--ask {
      padding-left: 0;
    }
  }
</style>
