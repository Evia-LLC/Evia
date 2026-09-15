/**
 * The ingredient knowledge base.
 *
 * Scope is stated rather than implied: this covers the actives, irritants and
 * functional ingredients that actually drive routine decisions. It is not a
 * complete cosmetic chemistry database — there are ~30,000 INCI names and most
 * of them are emulsifiers and thickeners nobody needs advice about.
 *
 * What matters for correctness is that an unrecognised ingredient is reported as
 * unrecognised. Silence must never read as approval.
 *
 * `family` is what drives the stacking logic: two products in the same family
 * are doing the same job, and that is the single most common routine mistake.
 */

export type IrritationRisk = 'none' | 'low' | 'moderate' | 'high';

export type IngredientFamily =
  | 'retinoid'
  | 'exfoliating-acid'
  | 'vitamin-c'
  | 'antibacterial'
  | 'barrier'
  | 'hydration'
  | 'occlusive'
  | 'spf'
  | 'brightening'
  | 'soothing'
  | 'peptide'
  | 'fragrance'
  | 'solvent'
  | 'preservative'
  | 'texture';

export interface Ingredient {
  /** Matched case-insensitively against the ingredient string. */
  match: RegExp;
  label: string;
  family: IngredientFamily;
  irritationRisk: IrritationRisk;
  note: string;
  /** Skin types, sensitivities or states this is a poor fit for. */
  cautionFor?: string[];
  /** Time of day this belongs in, when it matters. */
  timeOfDay?: 'am' | 'pm';
  /** Families that should not be layered with this in the same routine step. */
  conflictsWith?: IngredientFamily[];
  /** True for ingredients whose whole job is to make skin better, not just feel nice. */
  active?: boolean;
}

export const INGREDIENTS: Ingredient[] = [
  // --- retinoids ----------------------------------------------------------
  {
    match: /\b(tretinoin|all[- ]?trans retinoic acid)\b/i,
    label: 'Tretinoin',
    family: 'retinoid',
    irritationRisk: 'high',
    note: 'Prescription retinoid. Powerful and reliably irritating at first. Nothing else exfoliating on the same night.',
    cautionFor: ['sensitive', 'dry', 'rosacea', 'eczema', 'pregnancy'],
    timeOfDay: 'pm',
    conflictsWith: ['exfoliating-acid', 'retinoid'],
    active: true,
  },
  {
    match: /\b(adapalene|differin)\b/i,
    label: 'Adapalene',
    family: 'retinoid',
    irritationRisk: 'high',
    note: 'Retinoid aimed at breakouts. More stable and usually better tolerated than tretinoin, but still a retinoid.',
    cautionFor: ['sensitive', 'dry', 'pregnancy'],
    timeOfDay: 'pm',
    conflictsWith: ['exfoliating-acid', 'retinoid'],
    active: true,
  },
  {
    match: /\b(retinal|retinaldehyde)\b/i,
    label: 'Retinaldehyde',
    family: 'retinoid',
    irritationRisk: 'high',
    note: 'One conversion step from retinoic acid, so stronger than retinol at the same percentage.',
    cautionFor: ['sensitive', 'dry', 'rosacea', 'pregnancy'],
    timeOfDay: 'pm',
    conflictsWith: ['exfoliating-acid', 'retinoid'],
    active: true,
  },
  {
    match: /\b(retinol|retinyl (palmitate|propionate|acetate))\b/i,
    label: 'Retinol',
    family: 'retinoid',
    irritationRisk: 'moderate',
    note: 'Cell-turnover active. Introduce two nights a week and build up; never on the same night as an acid until tolerance is established.',
    cautionFor: ['sensitive', 'dry', 'rosacea', 'eczema', 'pregnancy'],
    timeOfDay: 'pm',
    conflictsWith: ['exfoliating-acid', 'retinoid'],
    active: true,
  },
  {
    match: /\b(bakuchiol)\b/i,
    label: 'Bakuchiol',
    family: 'retinoid',
    irritationRisk: 'low',
    note: 'Behaves a little like a retinoid with far less irritation. A reasonable route in if retinol has not worked out.',
    timeOfDay: 'pm',
    active: true,
  },
  {
    match: /\b(hydroxypinacolone retinoate|granactive)\b/i,
    label: 'Granactive retinoid',
    family: 'retinoid',
    irritationRisk: 'moderate',
    note: 'Retinoid ester marketed as gentler. Still counts as your retinoid for the night.',
    cautionFor: ['sensitive', 'pregnancy'],
    timeOfDay: 'pm',
    conflictsWith: ['retinoid'],
    active: true,
  },

  // --- exfoliating acids --------------------------------------------------
  {
    match: /\b(glycolic acid)\b/i,
    label: 'Glycolic acid (AHA)',
    family: 'exfoliating-acid',
    irritationRisk: 'high',
    note: 'The smallest AHA, so it penetrates furthest and stings most. Effective on texture and tone.',
    cautionFor: ['sensitive', 'dry', 'rosacea'],
    timeOfDay: 'pm',
    conflictsWith: ['retinoid', 'exfoliating-acid'],
    active: true,
  },
  {
    match: /\b(lactic acid)\b/i,
    label: 'Lactic acid (AHA)',
    family: 'exfoliating-acid',
    irritationRisk: 'moderate',
    note: 'Gentler AHA that also hydrates. A good first acid.',
    cautionFor: ['sensitive'],
    timeOfDay: 'pm',
    conflictsWith: ['retinoid', 'exfoliating-acid'],
    active: true,
  },
  {
    match: /\b(mandelic acid)\b/i,
    label: 'Mandelic acid (AHA)',
    family: 'exfoliating-acid',
    irritationRisk: 'low',
    note: 'Large molecule, so it works slowly and gently. Often the best acid for reactive or deeper skin tones.',
    timeOfDay: 'pm',
    conflictsWith: ['retinoid', 'exfoliating-acid'],
    active: true,
  },
  {
    match: /\b(salicylic acid|beta hydroxy)\b/i,
    label: 'Salicylic acid (BHA)',
    family: 'exfoliating-acid',
    irritationRisk: 'moderate',
    note: 'Oil-soluble, so it gets into pores. The most useful acid for congestion and blackheads.',
    cautionFor: ['sensitive', 'dry'],
    conflictsWith: ['retinoid', 'exfoliating-acid'],
    active: true,
  },
  {
    match: /\b(azelaic acid)\b/i,
    label: 'Azelaic acid',
    family: 'exfoliating-acid',
    irritationRisk: 'low',
    note: 'Unusually versatile — breakouts, redness and pigmentation at once, and generally well tolerated.',
    active: true,
  },
  {
    match: /\b(gluconolactone|lactobionic|polyhydroxy|pha)\b/i,
    label: 'PHA',
    family: 'exfoliating-acid',
    irritationRisk: 'low',
    note: 'Largest exfoliating acids; mild, hydrating, suitable for sensitive skin.',
    conflictsWith: ['exfoliating-acid'],
    active: true,
  },

  // --- vitamin C ----------------------------------------------------------
  {
    match: /\b(l[- ]?ascorbic acid|ascorbic acid)\b/i,
    label: 'L-ascorbic acid (vitamin C)',
    family: 'vitamin-c',
    irritationRisk: 'moderate',
    note: 'The most studied form and the least stable. Morning use under SPF. Can sting on a compromised barrier.',
    cautionFor: ['sensitive'],
    timeOfDay: 'am',
    conflictsWith: ['vitamin-c'],
    active: true,
  },
  {
    match: /\b(ethyl ascorbic acid|ascorbyl glucoside|magnesium ascorbyl phosphate|sodium ascorbyl phosphate|tetrahexyldecyl ascorbate|ascorbyl tetraisopalmitate)\b/i,
    label: 'Vitamin C derivative',
    family: 'vitamin-c',
    irritationRisk: 'low',
    note: 'More stable, gentler, slower. Still your vitamin C for the day.',
    timeOfDay: 'am',
    conflictsWith: ['vitamin-c'],
    active: true,
  },

  // --- antibacterial / breakout ------------------------------------------
  {
    match: /\b(benzoyl peroxide)\b/i,
    label: 'Benzoyl peroxide',
    family: 'antibacterial',
    irritationRisk: 'high',
    note: 'Very effective on inflammatory breakouts and reliably drying. It bleaches fabric, so mind your towels and pillowcases.',
    cautionFor: ['sensitive', 'dry', 'eczema'],
    conflictsWith: ['retinoid', 'vitamin-c'],
    active: true,
  },
  {
    match: /\b(sulfur|sulphur)\b/i,
    label: 'Sulfur',
    family: 'antibacterial',
    irritationRisk: 'moderate',
    note: 'Draws out congestion, drying, and smells like it works.',
    cautionFor: ['dry'],
    active: true,
  },
  {
    match: /\b(clindamycin|erythromycin)\b/i,
    label: 'Topical antibiotic',
    family: 'antibacterial',
    irritationRisk: 'low',
    note: 'Prescription. Follow the prescribing clinician rather than a routine builder.',
    active: true,
  },
  {
    match: /\b(tea tree|melaleuca)\b/i,
    label: 'Tea tree oil',
    family: 'antibacterial',
    irritationRisk: 'moderate',
    note: 'Mildly antibacterial and a common sensitiser at higher concentrations.',
    cautionFor: ['sensitive', 'eczema', 'fragrance'],
  },

  // --- barrier and hydration ---------------------------------------------
  {
    match: /\b(niacinamide|nicotinamide)\b/i,
    label: 'Niacinamide',
    family: 'barrier',
    irritationRisk: 'low',
    note: 'Supports the barrier, moderates oil, helps with tone. Plays well with almost everything.',
    active: true,
  },
  {
    match: /\b(ceramide|phytosphingosine|sphingolipid)\b/i,
    label: 'Ceramides',
    family: 'barrier',
    irritationRisk: 'none',
    note: 'Barrier lipids. Safe to layer and the most useful thing to add when skin is over-exfoliated.',
  },
  {
    match: /\b(panthenol|pro[- ]?vitamin b5|dexpanthenol)\b/i,
    label: 'Panthenol',
    family: 'soothing',
    irritationRisk: 'none',
    note: 'Soothing and hydrating; helps calm irritation.',
  },
  {
    match: /\b(hyaluronic acid|sodium hyaluronate|hydrolyzed hyaluronic)\b/i,
    label: 'Hyaluronic acid',
    family: 'hydration',
    irritationRisk: 'none',
    note: 'Humectant. Apply to damp skin and seal it, or in very dry air it can pull moisture the wrong way.',
  },
  {
    match: /\b(glycerin|glycerol|betaine|propanediol|butylene glycol|sodium pca|urea)\b/i,
    label: 'Humectant',
    family: 'hydration',
    irritationRisk: 'none',
    note: 'Draws and holds water in the skin. Unremarkable and quietly important.',
  },
  {
    match: /\b(squalane|jojoba|caprylic\/capric triglyceride|shea butter|butyrospermum)\b/i,
    label: 'Emollient',
    family: 'occlusive',
    irritationRisk: 'none',
    note: 'Softens and seals. Well tolerated.',
  },
  {
    match: /\b(petrolatum|mineral oil|paraffinum|dimethicone|cyclopentasiloxane)\b/i,
    label: 'Occlusive',
    family: 'occlusive',
    irritationRisk: 'none',
    note: 'Locks water in. Very effective, occasionally too heavy for congestion-prone skin.',
    cautionFor: ['acne'],
  },
  {
    match: /\b(centella|cica|madecassoside|asiaticoside|allantoin|bisabolol|beta[- ]?glucan|oat kernel|avena)\b/i,
    label: 'Soothing agent',
    family: 'soothing',
    irritationRisk: 'none',
    note: 'Calming. Useful alongside anything strong.',
  },
  {
    match: /\b(green tea|camellia sinensis|resveratrol|ferulic acid|vitamin e|tocopherol|ectoin)\b/i,
    label: 'Antioxidant',
    family: 'soothing',
    irritationRisk: 'none',
    note: 'Antioxidant support; often paired with vitamin C to stabilise it.',
  },

  // --- brightening --------------------------------------------------------
  {
    match: /\b(alpha arbutin|arbutin)\b/i,
    label: 'Arbutin',
    family: 'brightening',
    irritationRisk: 'low',
    note: 'Gentle pigment inhibitor. Slow, steady, low drama.',
    active: true,
  },
  {
    match: /\b(tranexamic acid)\b/i,
    label: 'Tranexamic acid',
    family: 'brightening',
    irritationRisk: 'low',
    note: 'Works well on stubborn pigmentation and post-inflammatory marks.',
    active: true,
  },
  {
    match: /\b(kojic acid)\b/i,
    label: 'Kojic acid',
    family: 'brightening',
    irritationRisk: 'moderate',
    note: 'Pigment inhibitor; can sensitise with prolonged use.',
    cautionFor: ['sensitive'],
    active: true,
  },
  {
    match: /\b(hydroquinone)\b/i,
    label: 'Hydroquinone',
    family: 'brightening',
    irritationRisk: 'high',
    note: 'Strong depigmenting agent, regulated in many markets and not for indefinite use. This belongs with a dermatologist, not a routine app.',
    cautionFor: ['sensitive'],
    active: true,
  },
  {
    match: /\b(licorice|glycyrrhiza|liquorice)\b/i,
    label: 'Licorice root',
    family: 'brightening',
    irritationRisk: 'none',
    note: 'Mild brightening and soothing.',
  },

  // --- peptides -----------------------------------------------------------
  {
    match: /\b(matrixyl|palmitoyl (tripeptide|pentapeptide|tetrapeptide)|copper tripeptide|acetyl hexapeptide|argireline|sh[- ]?oligopeptide|sh[- ]?polypeptide)\b/i,
    label: 'Peptide',
    family: 'peptide',
    irritationRisk: 'none',
    note: 'Signalling peptide. Gentle, slow, uncontroversial.',
  },

  // --- sun protection -----------------------------------------------------
  {
    match: /\b(zinc oxide)\b/i,
    label: 'Zinc oxide (mineral UV filter)',
    family: 'spf',
    irritationRisk: 'none',
    note: 'Broad-spectrum mineral filter, well tolerated by reactive skin. Can leave a cast on deeper tones.',
    timeOfDay: 'am',
  },
  {
    match: /\b(titanium dioxide)\b/i,
    label: 'Titanium dioxide (mineral UV filter)',
    family: 'spf',
    irritationRisk: 'none',
    note: 'Mineral filter, usually paired with zinc.',
    timeOfDay: 'am',
  },
  {
    match: /\b(avobenzone|octinoxate|octocrylene|homosalate|octisalate|ensulizole|uvinul|tinosorb|bemotrizinol|bisoctrizole|mexoryl|ecamsule)\b/i,
    label: 'Organic UV filter',
    family: 'spf',
    irritationRisk: 'low',
    note: 'Chemical filter — cosmetically elegant, no cast. The single highest-value thing in any routine.',
    timeOfDay: 'am',
  },

  // --- irritants and flags ------------------------------------------------
  {
    match: /\b(fragrance|parfum|aroma)\b/i,
    label: 'Fragrance',
    family: 'fragrance',
    irritationRisk: 'moderate',
    note: 'The most common contact irritant in skincare. Fine for many people, a real problem for reactive skin.',
    cautionFor: ['sensitive', 'eczema', 'rosacea', 'fragrance'],
  },
  {
    match: /\b(linalool|limonene|citronellol|geraniol|eugenol|citral|coumarin|benzyl salicylate|hexyl cinnamal)\b/i,
    label: 'Fragrance allergen',
    family: 'fragrance',
    irritationRisk: 'moderate',
    note: 'EU-declarable fragrance allergen. Listed because it has to be, which is useful information.',
    cautionFor: ['sensitive', 'eczema', 'rosacea', 'fragrance'],
  },
  {
    match: /\b(lavender oil|peppermint oil|citrus .*oil|bergamot|eucalyptus|menthol|camphor)\b/i,
    label: 'Essential oil',
    family: 'fragrance',
    irritationRisk: 'moderate',
    note: 'Naturally derived and a frequent sensitiser. Citrus oils can also be phototoxic.',
    cautionFor: ['sensitive', 'eczema', 'rosacea', 'fragrance'],
  },
  {
    match: /\b(alcohol denat|sd alcohol|denatured alcohol|isopropyl alcohol)\b/i,
    label: 'Drying alcohol',
    family: 'solvent',
    irritationRisk: 'moderate',
    note: 'Gives a fast, weightless finish and can be dehydrating in a leave-on product, especially high in the list.',
    cautionFor: ['dry', 'sensitive'],
  },
  {
    match: /\b(sodium lauryl sulfate|sodium laureth sulfate|sls|sles)\b/i,
    label: 'Sulfate surfactant',
    family: 'texture',
    irritationRisk: 'moderate',
    note: 'Strong cleanser. Effective and often more stripping than facial skin needs.',
    cautionFor: ['dry', 'sensitive', 'eczema'],
  },
  {
    match: /\b(coconut oil|cocos nucifera oil|isopropyl myristate|isopropyl palmitate|algae extract)\b/i,
    label: 'Potentially pore-clogging',
    family: 'occlusive',
    irritationRisk: 'low',
    note: 'Reported as comedogenic for some people. Not a universal rule, but worth watching if you break out.',
    cautionFor: ['acne', 'oily'],
  },
  {
    match: /\b(methylisothiazolinone|methylchloroisothiazolinone|formaldehyde|dmdm hydantoin|imidazolidinyl urea)\b/i,
    label: 'Sensitising preservative',
    family: 'preservative',
    irritationRisk: 'moderate',
    note: 'Preservative with a notable contact-allergy record.',
    cautionFor: ['sensitive', 'eczema'],
  },
  {
    match: /\b(phenoxyethanol|ethylhexylglycerin|sodium benzoate|potassium sorbate|benzyl alcohol|chlorphenesin)\b/i,
    label: 'Preservative',
    family: 'preservative',
    irritationRisk: 'low',
    note: 'Standard preservative. Products need them; this one is unremarkable.',
  },
  {
    match: /\b(aqua|water|eau)\b/i,
    label: 'Water',
    family: 'texture',
    irritationRisk: 'none',
    note: 'Solvent base.',
  },
  {
    match: /\b(carbomer|xanthan gum|cetearyl alcohol|cetyl alcohol|stearyl alcohol|glyceryl stearate|polysorbate|lecithin|sodium hydroxide|citric acid|tocopheryl acetate|disodium edta|tetrasodium edta)\b/i,
    label: 'Formulation base',
    family: 'texture',
    irritationRisk: 'none',
    note: 'Thickener, emulsifier or pH adjuster. Structural rather than active.',
  },
];

/** Human-readable name for a family, used in overlap messages. */
export const FAMILY_LABELS: Record<IngredientFamily, string> = {
  retinoid: 'retinoids',
  'exfoliating-acid': 'exfoliating acids',
  'vitamin-c': 'vitamin C',
  antibacterial: 'anti-bacterial actives',
  barrier: 'barrier support',
  hydration: 'humectants',
  occlusive: 'occlusives',
  spf: 'sun protection',
  brightening: 'brightening actives',
  soothing: 'soothing agents',
  peptide: 'peptides',
  fragrance: 'fragrance',
  solvent: 'solvents',
  preservative: 'preservatives',
  texture: 'formulation base',
};

/** How many of one family is too many in a single routine. */
export const FAMILY_STACK_LIMIT: Partial<Record<IngredientFamily, number>> = {
  retinoid: 1,
  'exfoliating-acid': 1,
  'vitamin-c': 1,
  antibacterial: 1,
  brightening: 2,
};
