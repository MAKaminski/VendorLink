import { z } from 'zod';

/**
 * Controlled vocabulary of trades.
 *
 * Three consumers depend on this being closed rather than free text:
 *  - Engine #1 scores a +20 modifier when a trade token appears in an email
 *    local-part (`hvac@`, `landscaping@`), which requires knowing the tokens.
 *  - Engine #2 fuzzy-matches a PM form's own option labels back to these slugs.
 *  - The directory filters by trade.
 *
 * `aliases` exist because PM forms and inboxes rarely use our slug: a form may
 * offer "Heating & Air Conditioning" and an inbox may be `ac@`.
 */
export interface TradeDefinition {
  readonly slug: TradeSlug;
  readonly label: string;
  /** Lowercase tokens that appear in email local-parts for this trade. */
  readonly emailTokens: readonly string[];
  /** Lowercase phrases used to fuzzy-match a form's option labels. */
  readonly aliases: readonly string[];
  /** Primary NAICS code, used when a form asks for one. */
  readonly naics: string;
}

export const TRADE_SLUGS = [
  'hvac',
  'plumbing',
  'electrical',
  'roofing',
  'landscaping',
  'janitorial',
  'pest',
  'turnover',
  'flooring',
  'appliance',
  'pool',
  'snow',
  'general_contracting',
  'painting',
  'locksmith',
  'fire_safety',
  'elevator',
  'windows_doors',
  'concrete_paving',
  'fencing',
  'gutters',
  'restoration',
] as const;

export type TradeSlug = (typeof TRADE_SLUGS)[number];

export const tradeSlugSchema = z.enum(TRADE_SLUGS);

export const TRADES: Readonly<Record<TradeSlug, TradeDefinition>> = {
  hvac: {
    slug: 'hvac',
    label: 'HVAC',
    emailTokens: ['hvac', 'ac', 'airconditioning', 'heating', 'mechanical'],
    aliases: [
      'hvac',
      'heating',
      'air conditioning',
      'heating & air conditioning',
      'heating and cooling',
      'mechanical',
      'ac repair',
      'climate control',
    ],
    naics: '238220',
  },
  plumbing: {
    slug: 'plumbing',
    label: 'Plumbing',
    emailTokens: ['plumbing', 'plumber', 'plumbers'],
    aliases: ['plumbing', 'plumber', 'drain', 'sewer', 'water heater', 'backflow'],
    naics: '238220',
  },
  electrical: {
    slug: 'electrical',
    label: 'Electrical',
    emailTokens: ['electric', 'electrical', 'electrician'],
    aliases: ['electrical', 'electrician', 'electric', 'lighting', 'low voltage'],
    naics: '238210',
  },
  roofing: {
    slug: 'roofing',
    label: 'Roofing',
    emailTokens: ['roofing', 'roof', 'roofer'],
    aliases: ['roofing', 'roof', 'roof repair', 'shingle', 'flat roof'],
    naics: '238160',
  },
  landscaping: {
    slug: 'landscaping',
    label: 'Landscaping & Grounds',
    emailTokens: ['landscaping', 'landscape', 'grounds', 'lawn'],
    aliases: [
      'landscaping',
      'landscape',
      'lawn care',
      'grounds',
      'grounds maintenance',
      'lawn maintenance',
      'irrigation',
      'tree service',
    ],
    naics: '561730',
  },
  janitorial: {
    slug: 'janitorial',
    label: 'Janitorial & Cleaning',
    emailTokens: ['janitorial', 'cleaning', 'custodial'],
    aliases: [
      'janitorial',
      'cleaning',
      'custodial',
      'housekeeping',
      'porter',
      'commercial cleaning',
    ],
    naics: '561720',
  },
  pest: {
    slug: 'pest',
    label: 'Pest Control',
    emailTokens: ['pest', 'exterminator', 'pestcontrol'],
    aliases: ['pest', 'pest control', 'exterminator', 'termite', 'bed bug', 'rodent'],
    naics: '561710',
  },
  turnover: {
    slug: 'turnover',
    label: 'Turnover / Make-Ready',
    emailTokens: ['turnover', 'turns', 'makeready', 'turn'],
    aliases: [
      'turnover',
      'make ready',
      'make-ready',
      'unit turns',
      'turns',
      'apartment turns',
      'punch out',
    ],
    naics: '236118',
  },
  flooring: {
    slug: 'flooring',
    label: 'Flooring',
    emailTokens: ['flooring', 'floors', 'carpet'],
    aliases: ['flooring', 'carpet', 'tile', 'hardwood', 'lvp', 'vinyl plank'],
    naics: '238330',
  },
  appliance: {
    slug: 'appliance',
    label: 'Appliance Repair',
    emailTokens: ['appliance', 'appliances'],
    aliases: ['appliance', 'appliance repair', 'appliances'],
    naics: '811412',
  },
  pool: {
    slug: 'pool',
    label: 'Pool & Spa',
    emailTokens: ['pool', 'pools', 'aquatics'],
    aliases: ['pool', 'pools', 'spa', 'aquatic', 'pool maintenance'],
    naics: '561790',
  },
  snow: {
    slug: 'snow',
    label: 'Snow & Ice Removal',
    emailTokens: ['snow', 'snowremoval', 'ice'],
    aliases: ['snow', 'snow removal', 'ice management', 'plowing', 'de-icing'],
    naics: '561790',
  },
  general_contracting: {
    slug: 'general_contracting',
    label: 'General Contracting',
    emailTokens: ['gc', 'construction', 'contracting'],
    aliases: [
      'general contractor',
      'general contracting',
      'construction',
      'remodel',
      'renovation',
      'capital improvement',
    ],
    naics: '236220',
  },
  painting: {
    slug: 'painting',
    label: 'Painting',
    emailTokens: ['painting', 'paint', 'painters'],
    aliases: ['painting', 'paint', 'painter', 'drywall', 'interior painting'],
    naics: '238320',
  },
  locksmith: {
    slug: 'locksmith',
    label: 'Locksmith & Access Control',
    emailTokens: ['locksmith', 'locks', 'access'],
    aliases: ['locksmith', 'locks', 'rekey', 'access control', 'key'],
    naics: '561622',
  },
  fire_safety: {
    slug: 'fire_safety',
    label: 'Fire & Life Safety',
    emailTokens: ['fire', 'firesafety', 'lifesafety', 'sprinkler'],
    aliases: [
      'fire safety',
      'life safety',
      'fire alarm',
      'sprinkler',
      'fire extinguisher',
      'fire suppression',
    ],
    naics: '238220',
  },
  elevator: {
    slug: 'elevator',
    label: 'Elevator',
    emailTokens: ['elevator', 'elevators', 'lift'],
    aliases: ['elevator', 'lift', 'escalator', 'vertical transportation'],
    naics: '238290',
  },
  windows_doors: {
    slug: 'windows_doors',
    label: 'Windows & Doors',
    emailTokens: ['windows', 'doors', 'glass', 'glazing'],
    aliases: ['windows', 'doors', 'glass', 'glazing', 'window replacement', 'sliding door'],
    naics: '238350',
  },
  concrete_paving: {
    slug: 'concrete_paving',
    label: 'Concrete & Paving',
    emailTokens: ['concrete', 'paving', 'asphalt'],
    aliases: ['concrete', 'paving', 'asphalt', 'sealcoating', 'striping', 'sidewalk'],
    naics: '238110',
  },
  fencing: {
    slug: 'fencing',
    label: 'Fencing & Gates',
    emailTokens: ['fencing', 'fence', 'gates'],
    aliases: ['fencing', 'fence', 'gate', 'gates', 'gate operator'],
    naics: '238990',
  },
  gutters: {
    slug: 'gutters',
    label: 'Gutters & Drainage',
    emailTokens: ['gutters', 'gutter'],
    aliases: ['gutter', 'gutters', 'downspout', 'drainage'],
    naics: '238170',
  },
  restoration: {
    slug: 'restoration',
    label: 'Restoration & Mitigation',
    emailTokens: ['restoration', 'mitigation', 'water', 'emergency'],
    aliases: [
      'restoration',
      'water damage',
      'mitigation',
      'mold',
      'fire damage',
      'emergency services',
      'water mitigation',
    ],
    naics: '562910',
  },
};

/** All email local-part tokens, mapped back to the trade that owns them. */
export const TRADE_EMAIL_TOKENS: ReadonlyArray<{ token: string; slug: TradeSlug }> =
  TRADE_SLUGS.flatMap((slug) =>
    TRADES[slug].emailTokens.map((token) => ({ token, slug })),
  );

export function tradeLabel(slug: TradeSlug): string {
  return TRADES[slug].label;
}

/**
 * Human-readable summary of a vendor's trades, for email subject lines.
 * Returns e.g. "HVAC" or "HVAC, Plumbing +2 more".
 */
export function summarizeTrades(slugs: readonly TradeSlug[]): string {
  if (slugs.length === 0) return 'Services';
  const labels = slugs.map(tradeLabel);
  const [first, second, ...rest] = labels;
  if (labels.length === 1) return first as string;
  if (labels.length === 2) return `${first}, ${second}`;
  return `${first}, ${second} +${rest.length} more`;
}
