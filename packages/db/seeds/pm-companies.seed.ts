/**
 * SEED DATA — SYNTHETIC. NOT REAL COMPANIES.
 *
 * §9 calls for shipping with a seeded directory sourced from public NARPM and
 * IREM member listings, state licence registries and Google Places. That
 * sourcing is a data-acquisition task, not a code task, and it must happen
 * before launch.
 *
 * What ships here instead is a set of 50 *synthetic* property-management
 * companies on `.example` domains. The reason is specific rather than
 * conservative: this product's whole purpose is to send real email to the
 * addresses in this table. Seeding it with real company names attached to
 * invented domains, portfolio sizes and contacts would mean shipping
 * fabricated records about identifiable businesses, and the first Batch
 * Connect would deliver mail based on them.
 *
 * Every row is marked `source: 'seed'` and `verified: false`, so the admin
 * review queue in §9.4 treats them as unpromoted, and
 * `scripts/replace-seed-directory.md` documents the swap to sourced data.
 *
 * The `websitePath` field points each company at the local fixture server when
 * `FIXTURES_BASE_URL` is set, which is what makes the full Connect flow
 * demonstrable end to end without touching a real site.
 */

export interface SeedPmCompany {
  name: string;
  domain: string;
  hqCity: string;
  hqState: string;
  portfolioUnits: number;
  portfolioType: string[];
  markets: string[];
  /** Path on the fixture server that stands in for this company's site. */
  websitePath?: string;
}

type Row = [
  name: string,
  domain: string,
  city: string,
  state: string,
  units: number,
  types: string,
  fixture?: string,
];

// name | domain | HQ city | state | units | portfolio types | fixture site
const ROWS: Row[] = [
  ['Oakwood Residential Group', 'oakwood-residential.example', 'Atlanta', 'GA', 12400, 'multifamily', 'plain-form'],
  ['Peachtree Property Partners', 'peachtree-pp.example', 'Atlanta', 'GA', 8600, 'multifamily,single_family', 'gravity-forms'],
  ['Marietta Square Holdings', 'marietta-holdings.example', 'Marietta', 'GA', 3100, 'single_family'],
  ['Southline Communities', 'southline-communities.example', 'Atlanta', 'GA', 5400, 'multifamily', 'nav-link-form'],
  ['Buckhead Asset Management', 'buckhead-am.example', 'Atlanta', 'GA', 2200, 'commercial,multifamily', 'obfuscated-email'],

  ['Lone Star Residential', 'lonestar-residential.example', 'Dallas', 'TX', 18700, 'multifamily', 'multi-step-wizard'],
  ['Trinity Property Services', 'trinity-ps.example', 'Fort Worth', 'TX', 6300, 'multifamily,student'],
  ['Bayou City Management', 'bayoucity-mgmt.example', 'Houston', 'TX', 9800, 'multifamily', 'recaptcha-wall'],
  ['Hill Country Homes PM', 'hillcountry-pm.example', 'Austin', 'TX', 2750, 'single_family', 'info-only'],
  ['Alamo Residential Partners', 'alamo-rp.example', 'San Antonio', 'TX', 4100, 'multifamily'],

  ['Cascade Property Group', 'cascade-pg.example', 'Seattle', 'WA', 7400, 'multifamily', 'login-portal'],
  ['Emerald City Residential', 'emeraldcity-res.example', 'Seattle', 'WA', 3900, 'multifamily,condo'],
  ['Puget Sound Management', 'pugetsound-mgmt.example', 'Tacoma', 'WA', 2400, 'single_family'],

  ['Rose City Rentals', 'rosecity-rentals.example', 'Portland', 'OR', 3300, 'multifamily', 'pdf-packet'],
  ['Willamette Property Co', 'willamette-pc.example', 'Portland', 'OR', 1850, 'single_family'],

  ['Golden Gate Residential', 'goldengate-res.example', 'San Francisco', 'CA', 6100, 'multifamily', 'typeform'],
  ['Bay Area Property Trust', 'bayarea-pt.example', 'Oakland', 'CA', 4700, 'multifamily,commercial'],
  ['Sunset Boulevard Management', 'sunsetblvd-mgmt.example', 'Los Angeles', 'CA', 14200, 'multifamily', 'wpforms'],
  ['Pacific Coast Communities', 'pacificcoast-comm.example', 'Long Beach', 'CA', 5600, 'multifamily'],
  ['Inland Empire PM Group', 'inlandempire-pm.example', 'Riverside', 'CA', 3200, 'single_family', 'contact-form-no-email'],
  ['San Diego Coastal Properties', 'sandiego-coastal.example', 'San Diego', 'CA', 4400, 'multifamily,vacation'],

  ['Desert Ridge Management', 'desertridge-mgmt.example', 'Phoenix', 'AZ', 8900, 'multifamily', 'jotform'],
  ['Copper State Residential', 'copperstate-res.example', 'Tucson', 'AZ', 2600, 'single_family'],
  ['Camelback Property Partners', 'camelback-pp.example', 'Scottsdale', 'AZ', 3700, 'multifamily'],

  ['Front Range Communities', 'frontrange-comm.example', 'Denver', 'CO', 7200, 'multifamily', 'trade-inboxes'],
  ['Mile High Property Group', 'milehigh-pg.example', 'Denver', 'CO', 4900, 'multifamily,student'],
  ['Boulder Creek Rentals', 'bouldercreek-rentals.example', 'Boulder', 'CO', 1400, 'single_family'],

  ['Great Lakes Property Mgmt', 'greatlakes-pm.example', 'Chicago', 'IL', 11300, 'multifamily', 'regional-inboxes'],
  ['Lakeshore Residential', 'lakeshore-res.example', 'Chicago', 'IL', 6800, 'multifamily,condo'],
  ['Prairie State Management', 'prairiestate-mgmt.example', 'Naperville', 'IL', 2100, 'single_family'],

  ['Empire State Residential', 'empirestate-res.example', 'New York', 'NY', 21500, 'multifamily'],
  ['Hudson Valley Properties', 'hudsonvalley-props.example', 'White Plains', 'NY', 3400, 'multifamily'],
  ['Brooklyn Bridge Management', 'brooklynbridge-mgmt.example', 'Brooklyn', 'NY', 5200, 'multifamily,condo'],

  ['Liberty Property Services', 'liberty-ps.example', 'Philadelphia', 'PA', 6700, 'multifamily'],
  ['Keystone Residential Group', 'keystone-rg.example', 'Pittsburgh', 'PA', 3100, 'multifamily,student'],

  ['Bay State Property Group', 'baystate-pg.example', 'Boston', 'MA', 8100, 'multifamily,student'],
  ['Charles River Management', 'charlesriver-mgmt.example', 'Cambridge', 'MA', 2900, 'multifamily'],

  ['Sunshine State Rentals', 'sunshinestate-rentals.example', 'Miami', 'FL', 9600, 'multifamily,vacation'],
  ['Gulf Coast Property Co', 'gulfcoast-pc.example', 'Tampa', 'FL', 5800, 'multifamily'],
  ['Orange Blossom Management', 'orangeblossom-mgmt.example', 'Orlando', 'FL', 7300, 'multifamily,vacation'],
  ['Jacksonville Residential', 'jacksonville-res.example', 'Jacksonville', 'FL', 3600, 'single_family'],

  ['Music City Properties', 'musiccity-props.example', 'Nashville', 'TN', 5100, 'multifamily'],
  ['Bluff City Management', 'bluffcity-mgmt.example', 'Memphis', 'TN', 3800, 'single_family,multifamily'],

  ['Queen City Residential', 'queencity-res.example', 'Charlotte', 'NC', 6400, 'multifamily'],
  ['Research Triangle PM', 'rtp-pm.example', 'Raleigh', 'NC', 4300, 'multifamily,student'],

  ['Twin Cities Property Group', 'twincities-pg.example', 'Minneapolis', 'MN', 5900, 'multifamily'],
  ['North Star Management', 'northstar-mgmt.example', 'Saint Paul', 'MN', 2200, 'single_family'],

  ['Motor City Residential', 'motorcity-res.example', 'Detroit', 'MI', 4600, 'multifamily,single_family'],
  ['Gateway Property Partners', 'gateway-pp.example', 'Saint Louis', 'MO', 3900, 'multifamily'],
  ['Silver State Communities', 'silverstate-comm.example', 'Las Vegas', 'NV', 6200, 'multifamily,vacation'],
];

const METRO_BY_STATE: Record<string, string> = {
  GA: 'Atlanta', TX: 'Texas Triangle', WA: 'Puget Sound', OR: 'Portland Metro',
  CA: 'California', AZ: 'Phoenix Metro', CO: 'Front Range', IL: 'Chicagoland',
  NY: 'New York Metro', PA: 'Pennsylvania', MA: 'Greater Boston', FL: 'Florida',
  TN: 'Tennessee', NC: 'Carolinas', MN: 'Twin Cities', MI: 'Detroit Metro',
  MO: 'Missouri', NV: 'Las Vegas Valley',
};

export const SEED_PM_COMPANIES: SeedPmCompany[] = ROWS.map(
  ([name, domain, hqCity, hqState, portfolioUnits, types, fixture]) => ({
    name,
    domain,
    hqCity,
    hqState,
    portfolioUnits,
    portfolioType: types.split(','),
    markets: [hqCity, METRO_BY_STATE[hqState] ?? hqState].filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
    ...(fixture ? { websitePath: fixture } : {}),
  }),
);
