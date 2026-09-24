<!--
  One legal record, typeset for reading: the placeholder notice first (in
  review builds), the title in the display serif, the wording version and
  effective date, the body at a long-form size and measure, and who and where
  it applies to. The text is the record's own, shown exactly as stored -
  paragraphs keep their line breaks.
-->
<script lang="ts">
  import type { LegalContentRecord } from '../../../shared/legal-content.ts';
  import LegalPlaceholderNotice from './LegalPlaceholderNotice.svelte';
  import PolicyVersion from './PolicyVersion.svelte';
  let { content }: { content: LegalContentRecord } = $props();

  const kind = $derived(content.acceptLabel ? 'Consent' : 'Legal document');
</script>

<article class="legal-document" aria-labelledby={`legal-${content.id}`}>
  <LegalPlaceholderNotice {content} />
  <p class="legal-document__eyebrow">{kind}</p>
  <h1 id={`legal-${content.id}`}>{content.title}</h1>
  <PolicyVersion {content} />
  <div class="legal-copy">
    {#each content.body as paragraph}<p>{paragraph}</p>{/each}
  </div>
  <dl>
    <dt>Applies to</dt><dd>{content.applicability.audience}</dd>
    <dt>Jurisdictions</dt><dd>{content.applicability.jurisdictions.join(', ')}</dd>
  </dl>
</article>

<style>
  .legal-document {
    display: grid;
    gap: 16px;
    padding: 36px 40px 32px;
    border: 1px solid var(--card-rim);
    border-radius: var(--r-lg);
    background: var(--surface-card);
    box-shadow: var(--shadow-sm);
    color: var(--text);
  }
  .legal-document__eyebrow {
    margin: 8px 0 -8px;
    font-size: var(--fs-micro);
    font-weight: var(--fw-semibold);
    letter-spacing: var(--tr-micro);
    text-transform: uppercase;
    color: var(--terracotta-500);
  }
  h1 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: clamp(34px, 5vw, 48px);
    font-weight: var(--fw-regular);
    line-height: 1.08;
    letter-spacing: var(--tr-title);
    color: var(--text-strong);
  }
  .legal-copy {
    display: grid;
    gap: 14px;
    margin: 8px 0 4px;
    /* About 70-75 characters a line (decision 8). Set in em, not the
       --measure token's ch: ch is the width of "0", which in Google Sans Flex
       is wider than the average letter, so 68ch ran to about 92 characters
       here. An average letter is about 0.46-0.48em, so 34em holds 71-74. */
    max-width: 34em;
    font-size: 17px;
    line-height: 1.65;
    color: var(--text);
    white-space: pre-wrap;
  }
  .legal-copy p {
    margin: 0;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 20px;
    margin: 0;
    padding-top: 16px;
    border-top: 1px solid var(--divider);
    font-size: var(--fs-body-sm);
  }
  dt {
    font-weight: var(--fw-semibold);
    color: var(--text-strong);
  }
  dd {
    margin: 0;
    color: var(--text-secondary);
  }
  @media (max-width: 819px) {
    .legal-document {
      padding: 24px 18px 22px;
    }
    .legal-copy {
      font-size: 16px;
    }
  }
</style>
