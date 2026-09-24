/**
 * The Home tip card's tips, for real mode.
 *
 * There is no tip service (specs/data-map.md section 2): the app has no
 * content feed and nothing personalised from a reading may be shown here. So
 * the card draws from this short, fixed list - general, cosmetic habits with
 * no efficacy claim, no condition named and nothing read off the user's own
 * skin (SRS MED-01, sections 5 and 10). One tip a day, the same one all day,
 * picked by the local date so it does not change on every visit.
 *
 * Every line here is listed for counsel in design/counsel/home.md; add to it
 * there as well as here. The play button speaks the tip with her voice
 * (text-to-speech), never a recording.
 */

export const TIP_TITLE = 'A quick tip from Evia';

export const TIPS: readonly string[] = [
  'Your evening routine matters too — consistency is key.',
  'Put sunscreen on every morning, even when it’s cloudy.',
  'Pat your skin dry after cleansing rather than rubbing it.',
  'Try one new product at a time, so you can tell what suits you.',
  'Patch-test a new product on a small area before using it all over.',
  'Lukewarm water is gentler than hot when you wash your face.',
  'Give a new routine a few weeks before you judge it.',
  'Wash your pillowcases and make-up brushes regularly.',
];

/** The tip for a given day: stable through the day, the next one tomorrow. */
export function tipFor(date: Date, tips: readonly string[] = TIPS): string {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfYear = Math.round((today - start) / 86_400_000);
  const index = (dayOfYear + date.getFullYear()) % tips.length;
  return tips[index];
}
