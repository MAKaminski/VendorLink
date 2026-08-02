/**
 * Deterministic field mapping.
 *
 * §6.3 step 2: a rules table matching a field's resolved label against a
 * canonical profile path. This handles the large majority of fields at
 * confidence 1.0 with no model call and no latency, which is what leaves the
 * LLM with only genuinely ambiguous fields to interpret.
 *
 * Rules are ordered most-specific first and the first match wins. That
 * ordering is load-bearing: "business phone" must not be caught by the looser
 * `/phone/` rule that would otherwise map it to the mobile number.
 */

export type ProfilePath =
  | `profile.${string}`
  | `document.${string}`
  | `generated.${string}`;

export interface MappingRule {
  readonly pattern: RegExp;
  readonly path: ProfilePath;
  /** Which transform the value needs on the way out. */
  readonly transform?:
    | 'phone'
    | 'currency_dollars'
    | 'currency_whole'
    | 'date_us'
    | 'date_iso'
    | 'state_code'
    | 'state_name'
    | 'boolean_yes_no'
    | 'trade_options';
  /** Patterns that disqualify a match even when `pattern` hits. */
  readonly notIf?: RegExp;
  /** Fields carrying a secret; never written literally to the audit table. */
  readonly secret?: boolean;
}

export const MAPPING_RULES: readonly MappingRule[] = [
  // ---- identity ----------------------------------------------------------
  {
    pattern: /\b(?:legal|registered)\s*(?:business|company|entity)?\s*name\b/i,
    path: 'profile.legal_name',
  },
  { pattern: /\bd\/?b\/?a\b|\bdoing business as\b|\btrade name\b/i, path: 'profile.dba' },
  {
    pattern: /\b(?:company|business|firm|vendor|contractor|supplier|organization)\s*name\b/i,
    path: 'profile.legal_name',
    notIf: /\bcontact\b|\bd\/?b\/?a\b/i,
  },
  { pattern: /^\s*(?:company|business|firm|organization)\s*$/i, path: 'profile.legal_name' },
  {
    // The tax qualifier is mandatory. An earlier version made every prefix
    // optional, so a bare "Sprocket ID" matched and the EIN — a secret — would
    // have been typed into an unrelated field.
    pattern:
      /\b(?:fed(?:eral)?|employer|tax\s*payer|taxpayer)\s*(?:tax\s*)?(?:identification(?:\s*number)?|id|i\.?d\.?|number)\b|\btax\s*(?:id|i\.?d\.?)\b|\bein\b|\btin\b/i,
    path: 'profile.ein',
    secret: true,
  },
  { pattern: /\bduns\b/i, path: 'profile.duns' },
  {
    pattern: /\b(?:entity|business|company|organization)\s*(?:type|structure)\b|\btype of (?:entity|business)\b/i,
    path: 'profile.entity_type',
  },
  { pattern: /\b(?:web\s*site|website|url|homepage|web address)\b/i, path: 'profile.website' },
  {
    pattern: /\b(?:year\s*(?:founded|established)|established|in business since|founded)\b/i,
    path: 'profile.year_founded',
  },
  {
    pattern: /\b(?:number of|#\s*of)?\s*(?:employees|staff|technicians|crew size)\b/i,
    path: 'profile.employee_count',
  },

  // ---- contact -----------------------------------------------------------
  {
    pattern: /\b(?:primary|main|principal)?\s*contact\s*(?:person|name|full name)?\b/i,
    path: 'profile.primary_contact_name',
    notIf: /\bemail\b|\bphone\b|\btitle\b|\bnumber\b|\bemergency\b|\bafter\s*hours\b/i,
  },
  { pattern: /\bcontact\s*title\b|\b(?:job\s*)?title\b|\bposition\b/i, path: 'profile.primary_contact_title' },
  { pattern: /\bfirst\s*name\b/i, path: 'profile.primary_contact_first_name' },
  { pattern: /\blast\s*name\b|\bsurname\b/i, path: 'profile.primary_contact_last_name' },

  {
    pattern: /\b(?:dispatch|service|work\s*order)\s*e-?mail\b/i,
    path: 'profile.dispatch_email',
  },
  {
    pattern: /\b(?:contact|business|company|primary|work)?\s*e-?mail(?:\s*address)?\b/i,
    path: 'profile.primary_contact_email',
    notIf: /\bdispatch\b|\bagent\b|\bconfirm\b|\bverify\b/i,
  },

  {
    pattern: /\b(?:after\s*hours|emergency|24\s*\/?\s*7|on\s*call)\s*(?:phone|number|line|contact)\b/i,
    path: 'profile.after_hours_phone',
    transform: 'phone',
  },
  {
    pattern: /\b(?:mobile|cell)\s*(?:phone|number)?\b/i,
    path: 'profile.primary_contact_phone',
    transform: 'phone',
  },
  {
    pattern: /\b(?:business|company|office|main|primary|work|contact)\s*(?:phone|telephone|number)\b/i,
    path: 'profile.primary_contact_phone',
    transform: 'phone',
  },
  {
    pattern: /\b(?:phone|telephone|tel)\b/i,
    path: 'profile.primary_contact_phone',
    transform: 'phone',
    notIf: /\bfax\b|\bagent\b|\bafter\b|\bemergency\b/i,
  },

  // ---- address -----------------------------------------------------------
  {
    pattern: /\b(?:street|mailing|business|company|physical)?\s*address\s*(?:line\s*)?(?:1|one)?\b/i,
    path: 'profile.address_line1',
    notIf: /\bline\s*(?:2|two)\b|\be-?mail\b|\bremit\b|\bweb\b/i,
  },
  {
    pattern: /\baddress\s*(?:line\s*)?(?:2|two)\b|\b(?:suite|unit|apt|apartment|floor)\b/i,
    path: 'profile.address_line2',
  },
  { pattern: /\bcity\b|\btown\b/i, path: 'profile.city', notIf: /\bremit\b/i },
  {
    pattern: /\bstate\b|\bprovince\b/i,
    path: 'profile.state',
    transform: 'state_code',
    notIf: /\blicense\b|\bremit\b|\bissuing\b|\bstates? served\b/i,
  },
  {
    pattern: /\bzip(?:\s*code)?\b|\bpostal\s*code\b/i,
    path: 'profile.postal',
    notIf: /\bremit\b|\bserved\b|\bservice\b/i,
  },
  { pattern: /\bcounty\b/i, path: 'profile.county', notIf: /\bserved\b|\bservice\b/i },

  // ---- trades and coverage -----------------------------------------------
  {
    pattern: /\b(?:trade|service|specialty|speciality|category|discipline)\s*(?:type|s)?\b|\bservices? (?:provided|offered)\b|\bscope of work\b/i,
    path: 'profile.trades',
    transform: 'trade_options',
    // "Service area" is coverage, not trade; "describe your services" is prose.
    notIf: /\barea\b|\bserved\b|\bregion\b|\bterritory\b|\bdescribe\b|\btell us\b|\bsummary\b|\bzip\b|\bcount(?:y|ies)\b/i,
  },
  { pattern: /\bnaics\b/i, path: 'profile.naics_code' },
  { pattern: /\bcsi\s*(?:code|division)\b/i, path: 'profile.csi_code' },
  {
    pattern: /\b(?:service|coverage)\s*area\b|\bareas? served\b|\bregions? served\b|\bterritory\b/i,
    path: 'profile.service_area_summary',
  },
  {
    pattern: /\b(?:counties|zip\s*codes?|markets?)\s*served\b/i,
    path: 'profile.service_area_summary',
  },

  // ---- licences ----------------------------------------------------------
  {
    pattern: /\b(?:contractor'?s?\s*)?licen[cs]e\s*(?:number|no\.?|#)\b/i,
    path: 'profile.license_number',
  },
  { pattern: /\blicen[cs]e\s*(?:type|class)\b/i, path: 'profile.license_type' },
  {
    pattern: /\blicen[cs]e\s*(?:state|issuing state)\b|\bissuing\s*state\b/i,
    path: 'profile.license_state',
    transform: 'state_code',
  },
  {
    pattern: /\blicen[cs]e\s*(?:expir|exp)\w*\b/i,
    path: 'profile.license_expires_on',
    transform: 'date_us',
  },
  { pattern: /\blicen[cs]e\b/i, path: 'profile.license_number' },

  // ---- insurance ---------------------------------------------------------
  {
    pattern: /\b(?:general\s*liability|gl)\s*(?:each\s*occurrence|per\s*occurrence|occurrence)\b/i,
    path: 'profile.gl_each_occurrence',
    transform: 'currency_dollars',
  },
  {
    pattern: /\b(?:general\s*liability|gl)\s*(?:aggregate|agg)\b/i,
    path: 'profile.gl_aggregate',
    transform: 'currency_dollars',
  },
  {
    pattern: /\b(?:general\s*liability|gl)\s*(?:limit|coverage|amount)?\b/i,
    path: 'profile.gl_each_occurrence',
    transform: 'currency_dollars',
    notIf: /\bcarrier\b|\bpolicy\s*(?:number|no|#)\b|\bexpir\w*\b/i,
  },
  {
    pattern: /\b(?:auto|automobile|vehicle)\s*(?:liability)?\s*(?:limit|coverage)?\b/i,
    path: 'profile.auto_limit',
    transform: 'currency_dollars',
    notIf: /\bcarrier\b|\bpolicy\b/i,
  },
  {
    pattern: /\b(?:umbrella|excess)\s*(?:liability)?\s*(?:limit|coverage)?\b/i,
    path: 'profile.umbrella_limit',
    transform: 'currency_dollars',
  },
  {
    pattern: /\bworkers'?\s*comp(?:ensation)?\b|\bwc\b/i,
    path: 'profile.has_workers_comp',
    transform: 'boolean_yes_no',
    notIf: /\bcarrier\b|\bpolicy\s*(?:number|no|#)\b/i,
  },
  {
    pattern: /\binsurance\s*(?:carrier|company|provider)\b|\bcarrier\s*name\b/i,
    path: 'profile.insurance_carrier',
  },
  {
    pattern: /\bpolicy\s*(?:number|no\.?|#)\b/i,
    path: 'profile.insurance_policy_number',
  },
  {
    pattern: /\b(?:insurance|policy|coi)\s*(?:expir|exp)\w*\b/i,
    path: 'profile.insurance_expires_on',
    transform: 'date_us',
  },
  { pattern: /\b(?:insurance\s*)?agent\s*name\b|\bbroker\s*name\b/i, path: 'profile.agent_name' },
  { pattern: /\bagent\s*e-?mail\b|\bbroker\s*e-?mail\b/i, path: 'profile.agent_email' },
  {
    pattern: /\bagent\s*(?:phone|number)\b|\bbroker\s*phone\b/i,
    path: 'profile.agent_phone',
    transform: 'phone',
  },
  {
    pattern: /\badditional\s*insured\b/i,
    path: 'profile.additional_insured_text',
  },
  {
    pattern: /\bwaiver\s*of\s*subrogation\b/i,
    path: 'profile.waiver_of_subrogation',
    transform: 'boolean_yes_no',
  },
  {
    pattern: /\bprimary\s*(?:and|&)\s*non-?contributory\b/i,
    path: 'profile.primary_and_noncontributory',
    transform: 'boolean_yes_no',
  },

  // ---- pricing and terms -------------------------------------------------
  {
    pattern: /\b(?:hourly|labor|labour)\s*rate\b/i,
    path: 'profile.hourly_rate',
    transform: 'currency_dollars',
  },
  {
    pattern: /\b(?:trip|travel)\s*(?:charge|fee)\b/i,
    path: 'profile.trip_fee',
    transform: 'currency_dollars',
  },
  {
    pattern: /\b(?:dispatch|service\s*call|call\s*out)\s*(?:charge|fee)\b/i,
    path: 'profile.dispatch_fee',
    transform: 'currency_dollars',
  },
  {
    pattern: /\bafter\s*hours\s*(?:rate|charge|fee|premium)\b/i,
    path: 'profile.after_hours_fee',
    transform: 'currency_dollars',
  },
  {
    pattern: /\bminimum\s*(?:invoice|charge|billing)\b/i,
    path: 'profile.minimum_invoice',
    transform: 'currency_dollars',
  },
  { pattern: /\bpayment\s*terms\b|\bnet\s*terms\b/i, path: 'profile.payment_terms' },
  { pattern: /\bwarranty\b|\bguarantee\b/i, path: 'profile.warranty_terms' },
  {
    pattern: /\b(?:accepts?\s*)?(?:ach|direct deposit|electronic payment)\b/i,
    path: 'profile.accepts_ach',
    transform: 'boolean_yes_no',
  },
  {
    pattern: /\bremit(?:tance)?\s*(?:to)?\s*address\b/i,
    path: 'profile.remit_to_address',
    secret: true,
  },
  {
    pattern: /\b(?:bank|routing|account)\s*(?:number|no\.?|#)\b/i,
    path: 'profile.bank_details',
    secret: true,
  },

  // ---- availability ------------------------------------------------------
  {
    pattern: /\b(?:24\s*\/?\s*7|24 hour|emergency|after\s*hours)\s*(?:service|availability|available|coverage)?\b/i,
    path: 'profile.offers_after_hours',
    transform: 'boolean_yes_no',
    notIf: /\bphone\b|\bnumber\b|\brate\b|\bfee\b/i,
  },
  {
    pattern: /\b(?:response|reply)\s*time\b/i,
    path: 'profile.response_time_hours',
  },
  { pattern: /\b(?:hours|days)\s*of\s*operation\b|\bbusiness hours\b/i, path: 'profile.hours_summary' },

  // ---- compliance --------------------------------------------------------
  {
    pattern: /\bw-?9\b/i,
    path: 'document.W9',
  },
  {
    pattern: /\b(?:certificate\s*of\s*insurance|coi|insurance\s*cert(?:ificate)?)\b/i,
    path: 'document.COI',
  },
  {
    pattern: /\b(?:background\s*check|bci|criminal\s*background)\b/i,
    path: 'profile.background_check_consent',
    transform: 'boolean_yes_no',
  },
  { pattern: /\bsafety\s*(?:manual|program|plan)\b/i, path: 'document.SAFETY_MANUAL' },
  {
    pattern: /\b(?:price\s*book|pricebook|price\s*list|rate\s*sheet|fee\s*schedule)\b/i,
    path: 'document.PRICEBOOK',
  },
  {
    pattern: /\b(?:capability\s*statement|company\s*profile|line\s*card)\b/i,
    path: 'document.CAPABILITY_STATEMENT',
  },
  { pattern: /\breferences?\b/i, path: 'document.REFERENCES' },
  { pattern: /\b(?:voided\s*check|void\s*cheque)\b/i, path: 'document.VOIDED_CHECK' },
  { pattern: /\bbank\s*letter\b/i, path: 'document.BANK_LETTER' },
  { pattern: /\blicen[cs]e\s*(?:copy|document|upload)\b/i, path: 'document.LICENSE' },

  // ---- free text ---------------------------------------------------------
  {
    pattern: /\b(?:describe|description of|tell us about|summary of)\s*(?:your)?\s*(?:services|company|business|experience)\b/i,
    path: 'generated.services_description',
  },
  {
    pattern: /\bwhy (?:do you )?(?:want|would you like) to (?:work with|partner with|join)\b/i,
    path: 'generated.why_work_with_us',
  },
  {
    pattern: /\b(?:additional|other)\s*(?:comments|information|notes)\b/i,
    path: 'generated.additional_notes',
  },
];

export interface DeterministicMatch {
  readonly rule: MappingRule;
  readonly path: ProfilePath;
  readonly confidence: 1;
}

/**
 * Match one resolved field label against the rules table.
 *
 * Returns confidence 1.0 or nothing at all — a partial deterministic match is
 * a contradiction, and anything uncertain belongs to the LLM stage where it
 * gets a confidence score and can be refused.
 */
export function matchDeterministic(label: string): DeterministicMatch | null {
  const normalized = label.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;

  for (const rule of MAPPING_RULES) {
    if (rule.notIf?.test(normalized)) continue;
    if (rule.pattern.test(normalized)) {
      return { rule, path: rule.path, confidence: 1 };
    }
  }
  return null;
}

/** Paths whose values must never be written literally to the audit table. */
export const SECRET_PATHS: ReadonlySet<string> = new Set(
  MAPPING_RULES.filter((r) => r.secret).map((r) => r.path),
);

export function isSecretPath(path: string): boolean {
  return SECRET_PATHS.has(path);
}
