# Counsel review: Products page

Page: `/products` (`src/pages/ProductsPage.svelte`, `src/pages/products/*`, `src/view/products.ts`,
`src/sample/fixtures/products.ts`, `src/products/*`). Backend: `GET /api/catalogue`, `GET /api/catalogue/:id`
(`server/routes/api.ts`, `server/catalogue/browse.ts`) and affiliate tagging (`server/catalogue/offers.ts`).
Reference: `ref3.png` (specs/products.md section 8, data-map.md sections 5 and 9).

Two modes:

- **Sample mode** (`?sample=1` or "Preview with sample data"): the mockup's shelf, verbatim - eight products
  under real third-party brand names, with the mockup's prices, star ratings, review counts and badges -
  under the always-visible "Sample data" badge. Nothing is read from or written to the server. Every
  "Shop at {retailer}" button names that sample product's own illustrative retailer (the brand's own site,
  e.g. "Shop at CeraVe", or a major beauty retailer, e.g. "Shop at Ulta Beauty") and is switched off (it
  shows "Sample data: shop links are switched off in the preview" instead of leaving the app), so a sample
  price never sends anyone to a real shop. The mockup's
  character is not drawn (BUILD-PLAN decision 3); an unbranded still life of three bottles sits in her place.
- **Real mode**: only what the app has - the user's picks for their latest scan (`/api/routine/picks`, or
  the guest's in-tab reading), each with the server's own reason, reading and price sentence, and the
  operator's catalogue (`/api/catalogue`), which is empty by default. With an empty shelf the page says
  "The shop shelf is empty for now. Products appear here when a shop catalogue is connected..." rather
  than filling the grid. Every "Shop at ..." names that product's own retailer; there is no house or
  default shop name anywhere. No ratings, review counts, "Trending", "Popular" or "Best Match" ever appear.

Nothing below has been reworded silently: every flagged sample-mode string is shown verbatim, and the
real-mode wording that replaces or accompanies it is listed so counsel can approve or change it.

## 1. Commerce model (BUILD-PLAN decision 11)

| Element | Sample mode shows | Real mode shows instead | SRS / issue |
|---|---|---|---|
| Cart icon with badge "2" | Removed | Removed | No retail checkout exists; SRS v2 defines only the subscription (PAY-01) |
| "Add to cart" (cards and panel) | "Shop at {retailer} ↗" (switched off), each sample product with its own illustrative retailer: CeraVe, YesStyle, Ulta Beauty, La Roche-Posay, Stylevana, Paula’s Choice, Target, Amazon | "Shop at {retailer} ↗" to the catalogue product URL, naming **that product's own retailer**: the catalogue import's `retailer` field when given; else the configured store's name (`ELOHIM_STORE_NAME`) only for products synced from that store (`ELOHIM_STORE_URL`); else a retailer known by the link's site (Amazon, Sephora, Ulta Beauty, Boots, Target, Walmart, LOOKFANTASTIC, Cult Beauty, YesStyle, Stylevana, eBay); else the brand's name when the link is the brand's own site; else the site's address (e.g. "Shop at cerave.com"). Accessible name: "Shop at {retailer}: {product} (opens in a new tab)"; for a pick with no shelf product, "Search Amazon ↗" / "Search Google Shopping ↗" search links (no price fetched, and the panel says so in the server's words: "No prices fetched — these are places to look.") | Affiliate relationship needs disclosure; links are `rel="sponsored noopener noreferrer"`, new tab |
| **Affiliate disclosure** (new, over the first grid with shop links and in the detail panel) | "Evia may earn a commission when you buy through these links. It never changes what we recommend." | Same words | Decision 11 wording, **for counsel approval**. Note: it shows even when no affiliate tag is configured ("may"); "It never changes what we recommend" is a promise about the picker (`server/catalogue/picks.ts` ranks by ingredient fit and never reads commission data - true today, must stay true) |
| Retailer names on sample products (new) | Real retailers' names next to the mockup's sample prices: "Shop at CeraVe", "Shop at YesStyle", "Shop at Ulta Beauty", "Shop at La Roche-Posay", "Shop at Stylevana", "Shop at Paula’s Choice", "Shop at Target", "Shop at Amazon" - all switched off, under the Sample data badge | n/a (real mode names only the retailer the product link actually goes to) | For review: the pairings are illustrative (no retailer has confirmed stocking the product at that price). Acceptable in a labelled, link-less preview, or should the preview name only each brand's own site? |
| Affiliate link contents | n/a (no links) | The retailer URL plus only the operator's static affiliate parameters for that retailer (`ELOHIM_AFFILIATE_AMAZON_TAG`, `ELOHIM_AFFILIATE_EBAY_PARAMS`, `ELOHIM_AFFILIATE_STORE_PARAMS`, `ELOHIM_AFFILIATE_LINKS`). A configured parameter whose name looks meant for personal data (skin, scan, concern, score, email, user...) is refused. No reading, concern, profile or user id is ever added | **ADS-01**; §9 "Analytics excludes ... analysis results". For review: a marketplace *search* link carries the suggested product type as its search term (e.g. `k=Salicylic Acid cleanser`), which is derived from the user's reading though it names no reading or concern. Acceptable? |
| Heart ("Saved") | Local list, this device only, in its own "sample" list | One list per signed-in account on this device (localStorage key per account id); a guest's list lasts for the tab only and is never stored. Only product ids are stored (`shelf:<catalogue id>`); a suggestion that is not a shelf product ("A low-strength retinoid") has **no heart**, because its name comes from the reading. The first version's shared list is migrated (sample ids kept, anything else deleted) | No account-side favourites table yet; nothing leaves the device. Shared-device privacy: another account never sees this list or the "Saved" chip |
| Under-18 accounts | n/a | **Not handled**: the app has no date of birth or age signal on main (AGE-01 / GDN-01 not implemented), so affiliate links and marketing hero copy show to everyone | **§9** "Under-18 accounts: no behavioural advertising ... or marketing messages" - counsel to decide whether affiliate links / merchandising must be suppressed for 16-17 once age exists |

## 2. Hero

| Element | Sample mode shows | Real mode shows instead | SRS / issue |
|---|---|---|---|
| Headline | "Skincare that works for you." | Same | Efficacy-flavoured marketing line; low risk - counsel |
| Subtitle | "Curated by Evia. Backed by science. Chosen for your skin." | "Curated by Evia, ingredient first." + " Chosen for your latest reading." only when the user has picks from a real scan | "Backed by science" unsubstantiated (SRS checklist 13, review marketing copy); "Chosen for your skin" only true with real picks (products.md §8.18) |
| Trust line: "Safe for your skin type" | Shown | **Never shown** | §10: suggestions are not a complete safety check; a safety claim |
| Trust line: "Ingredient-checked" | Shown | "Ingredient lists checked against your profile" - only for a signed-in account **and** a non-empty shelf (the catalogue detail route runs `assessProduct` on a published ingredient list) | §10; true only where a list exists - the panel says so per product |
| Trust line: "Dermatologist-grade brands" | Shown | **Never shown** | MED-01; §6 (no clinical positioning); dermatologist marketplace outside V1 (§10) |
| Trust line (new): "You buy from the shop itself, not through Evia" | not shown | Shown | True: there is no cart or checkout in Evia (decision 11). It replaces the first draft "Shop links go straight to the retailer", which was not true of the "Search Google Shopping ↗" link (that goes to a Google results page, which lists shops but sells nothing). Counsel to confirm the wording next to affiliate tagging |
| "Search Google Shopping ↗" (real mode, a pick with no shelf product) | not shown | A Google Shopping **search results** page for the suggested product type (`https://www.google.com/search?tbm=shop&q=...`), not a retailer; no affiliate tag. Its screen-reader name says what it searches for ("Search Google Shopping for Salicylic Acid cleanser") | The search term is derived from the reading (see ADS-01 row above); counsel to confirm linking to a third-party search engine is acceptable |
| Handwritten quote | "“The right products make all the difference.” — Evia" | Same | Marketing line attributed to the AI character; low risk - counsel |
| Character pointing at a product (white blazer, "evia" on chest) | Not drawn (decision 3) | Not drawn | §6 clinical-look concern is moot for now |
| "Premium Member" under the name | Shown (sample profile) | Not shown (the shell's profile pill shows only the name) | §8: single subscription, no tiers |

## 3. Category chips

| Element | Sample mode shows | Real mode shows instead | SRS / issue |
|---|---|---|---|
| "Treatments" chip | Shown | Shown (filters by words like exfoliant, peel, retinoid, BHA/AHA, mask, spot) | MED-01: "treatment" reads as medical; products.md suggests "Targeted care" - **counsel to choose** |
| "Recommended For You" | Shown | Shown: the user's picks (from their reading) and then the shelf | §10 general suggestions; see §5 below |
| Other chips (Cleansers ... Makeup) | Filter the sample shelf | Filter the catalogue by words in the product's own name/category/tags; a product is never put under a chip its own words do not name. Under a chip, the user's picks for that step come first ("Your picks - Serums suggested from your latest reading.") | None |

## 4. Grid and cards

| Element | Sample mode shows | Real mode shows instead | SRS / issue |
|---|---|---|---|
| "Recommended for you - Products that match your skin, goals and sensitivities." | Shown verbatim | "Recommended for you - Suggested by ingredient from your latest reading. Each one says why." | "sensitivities" implies allergy screening (§10); the app has no "goals" field |
| Star ratings and review counts ("4.8 (12.4k)", etc.; panel "4.8 (12.4k reviews)", "Reviews (12.4k) ★ 4.8") | Shown with stars drawn from each value to the nearest half (the mockup's mis-drawn 4.9 and panel stars are not copied) | **Never shown** (no review source exists; the Reviews row is not built) | §1 "never fabricate"; consumer-protection rules on fake reviews |
| Badges "Best Match", "Trending", "Popular", "Good for you", "For concerns", "Gentle option" | Shown as in the mockup | Only the pick's routine step ("Cleanse", "Treat", "Hydrate", "Protect"); shelf products carry no badge. "Best Match" would need a real score/rank on `ProductPick` (not exposed) | §8 no artificial cues; "Good for you" / "For concerns" read as health claims (MED-01) |
| Product blurbs in Evia's voice | "Unclogs pores and helps prevent breakouts", "Targets blemishes and helps prevent marks", "Helps with oil control, pores and uneven tone", "Soothes and balances sensitive skin", "Strengthens skin barrier and provides long-lasting hydration", "Lightweight, no white cast. Perfect for daily use.", etc. | The shop's own description (first sentence, trimmed) for shelf products; for picks: "Not on the shelf yet. Picked for your {metric} reading." | MED-01 (treatment-adjacent claims in the app's voice); shop descriptions are the retailer's text - counsel to decide whether they need attribution |
| Prices | "$14.99", "$18.00", ... for real brands | The catalogue's own `priceCents`/`currency`; picks show a price only from a shelf product, with the server's price sentence | Invented prices under real trademarks (sample only) |
| Real brand names and drawn packaging (CeraVe, Anua, The Ordinary, La Roche-Posay, Beauty of Joseon, Paula's Choice) | Shown (SVG bottles with the brands' colour schemes) | Never (real mode draws unbranded bottles by category, or the shop's own image) | Trademark / trade dress review before any public use of sample mode (products.md §8.13) |

## 5. Detail panel

| Element | Sample mode shows | Real mode shows instead | SRS / issue |
|---|---|---|---|
| Gallery (large still + 4 thumbnails) | Drawn counter still + 3 texture stills, no people | The shop's one `imageUrl`, or an unbranded bottle; no thumbnails | none |
| "In stock" | Shown | Only for a catalogue product, from the shop's `inStock` flag ("In stock" / "Out of stock") | §8 no artificial scarcity - real flag only |
| Benefit icons "Cleanse · Hydrate · Protect barrier" (the mockup's, first product). The other seven sample panels (not in the mockup) take two labels from their own card's blurb or name: Anua "Soothe · Balance"; The Ordinary "Oil control · Pores"; Toleriane "Skin barrier · Hydration"; Relief Sun "SPF 50+ · Lightweight"; BHA "Exfoliant · Pores"; Effaclar "Blemishes · Marks"; CeraVe PM "Oil-free · Nighttime" | Shown | "Contains" + ingredient families found in the published ingredient list (e.g. "Humectants", "Barrier support"); nothing when there is no list | "Protect barrier", "Skin barrier", "Blemishes", "Marks", "Pores" read as efficacy claims (MED-01) - sample only, and only restating the card's own blurb |
| "Why Evia recommends this" | "In the preview this row is sample text. With an account it gives the reason from your latest reading, in plain words, and the ingredient it was chosen for." | The server's pick reason verbatim (Elohim voice, e.g. "Nothing on the shelf does this yet, so here is where I would look."), "Your latest scan read {metric} at {value} out of 100.", and the plan's rationale (`Suggestion.why`, e.g. "It is oil-soluble, so it clears the inside of pores rather than just the surface.") | MED-01: engine `why` strings in `server/skin/recommend.ts` carry efficacy language - same item as the Routine counsel file; G5 brand voice |
| "Ingredients (full list)" | Sample text | The published list, or "What to look for on the label: {actives}." for a pick, or "The shop has not published an ingredient list for this product." | none |
| "How to use (with demonstration)" | Row shown (sample text; no demonstration media exists) | **Not built** (no step templates or media) | §6 if a character demo is added later |
| "Is it right for you?" | "With an account, Evia checks the ingredient list against your profile and the products you already use, and says what it found." + the note below | A verdict sentence from `assessProduct` only when the shop published an ingredient list: good_fit "Nothing in the ingredient list clashes with your profile or your current routine."; probably_fine "Nothing alarming, but one thing is worth being deliberate about."; be_cautious "This overlaps with more than one product you already use."; not_now "Something in the ingredient list clashes with your profile." + findings/overlaps; without a list: "The shop has not published an ingredient list for this product, so there is nothing to check it against."; for a pick without a product: the plan's cautions. **Always** followed by the note below | **§10**: "Absence of an escalation message must never be presented as reassurance" - is the good_fit sentence acceptable? It is scoped to "the ingredient list" and followed by the note |
| Standing note (every "Is it right for you?") | "General skincare guidance, not medical advice, and not a complete safety check. Read the label and patch test anything new." | Same | §10 "Product suggestions are general; users should read labels and patch test." - wording for counsel approval |
| "Reviews (12.4k) ★ 4.8" | Row shown; body "Sample ratings. Evia has no review source yet, so ratings and review counts appear only in this preview." | Not built | as ratings above |
| "Similar products" | Row shown: only other sample products of the same kind (e.g. the two moisturisers list each other); when there is none, "The sample shelf has no other cleanser to compare it with." (no unrelated products) | Not built (no similarity source) | none |

## 6. Other

- Brand: server-written pick reasons are in the "Elohim" voice and can name Elohim (data-map G5).
- The page loads no advertising or analytics technology of any kind (§9, ADS-01).
- A guest never calls `/api/catalogue` (signed-in only); the guest sees their in-tab picks, if any, and the
  public shelf count ("Sign in to browse the shelf" when the shop has products, the empty-shelf state otherwise).
