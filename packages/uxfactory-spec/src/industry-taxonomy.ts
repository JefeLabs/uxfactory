/**
 * industry-taxonomy.ts — the project-industry taxonomy as DATA
 * (source: .plans/industry-taxonomy.md).
 *
 * Industry = vertical domain MODIFIER. Category drives structure (IA seeds,
 * component emphasis); industry drives flavor: imagery subjects, glossary
 * seeds, palette/tone bias, and compliance nudges. Interplay rule: any
 * proposed industry that changes IA seeds is actually a category; any
 * proposed category that only changes imagery is actually an industry.
 *
 * "Corporate" is deliberately ABSENT — it is a business-model axis, not a
 * vertical (doc recommends a future Audience-model field: B2C/B2B/B2B2C/
 * Internal). Legacy "corporate" values alias to Consulting.
 *
 * `drivers` keeps the doc's notable-drivers text as the selection caption;
 * structured driver fields (photographySubjects, glossarySeeds, …) land when
 * their consumers (elicitation additions, policy nudges) ship. Compliance
 * flags never silently change requirements — they surface as suggested
 * policy entries the team accepts or rejects.
 */

export type ComplianceFlag =
  | "regulated"
  | "age-sensitive"
  | "age-gated"
  | "jurisdiction-sensitive";

export interface IndustryProfile {
  label: string;
  sector: string;
  /** The doc's notable-drivers line — shown as the selection caption. */
  drivers: string;
  complianceFlags: ComplianceFlag[];
}

export const INDUSTRY_SECTORS: { id: string; label: string; regulated?: boolean }[] = [
  { id: "tech", label: "Technology & software" },
  { id: "financial", label: "Financial services", regulated: true },
  { id: "healthcare", label: "Healthcare & life sciences", regulated: true },
  { id: "retail-goods", label: "Retail & consumer goods" },
  { id: "food-beverage", label: "Food & beverage" },
  { id: "travel", label: "Travel & hospitality" },
  { id: "media-entertainment", label: "Media & entertainment" },
  { id: "education", label: "Education" },
  { id: "professional", label: "Professional & business services" },
  { id: "industrial", label: "Industrial & manufacturing" },
  { id: "public-social", label: "Public & social sector", regulated: true },
  { id: "real-estate", label: "Real estate & property" },
  { id: "personal-services", label: "Personal & lifestyle services" },
];

const REG: ComplianceFlag[] = ["regulated"];

export const INDUSTRY_TAXONOMY: Record<string, IndustryProfile> = {
  // ── Technology & software ─────────────────────────────────────────────────
  "saas-business-software": { label: "SaaS & business software", sector: "tech", complianceFlags: [], drivers: "Product-UI screenshots over photography; workspace/plan/seat vocabulary" },
  "consumer-apps": { label: "Consumer apps & internet", sector: "tech", complianceFlags: [], drivers: "Lifestyle photography; casual tone bias" },
  "developer-tools": { label: "Developer tools & infrastructure", sector: "tech", complianceFlags: [], drivers: "Mono-heavy type flavor; terminal/code imagery; API/SDK vocabulary" },
  "ai-data": { label: "AI & data", sector: "tech", complianceFlags: [], drivers: "Abstract illustration bias — avoid robot clichés" },
  "cybersecurity": { label: "Cybersecurity", sector: "tech", complianceFlags: [], drivers: "Trust palette (deep blues); tone precise; avoid fear imagery" },
  "hardware-devices": { label: "Hardware & devices", sector: "tech", complianceFlags: [], drivers: "Product photography primary; spec-table vocabulary" },
  "telecom": { label: "Telecom", sector: "tech", complianceFlags: [], drivers: "Coverage/connectivity vocabulary" },
  "gaming-industry": { label: "Gaming (industry)", sector: "tech", complianceFlags: [], drivers: "Motion budget up; dark bias — valid beyond the Gaming category" },

  // ── Financial services (regulated) ────────────────────────────────────────
  "banking": { label: "Banking", sector: "financial", complianceFlags: REG, drivers: "Disclosures elicitation; tone precise; trust palette" },
  "fintech-payments": { label: "Fintech & payments", sector: "financial", complianceFlags: REG, drivers: "PCI vocabulary; fee-transparency glossary" },
  "insurance": { label: "Insurance", sector: "financial", complianceFlags: REG, drivers: "Plain-language nudge; policy/claim/premium vocabulary" },
  "investment-wealth": { label: "Investment & wealth", sector: "financial", complianceFlags: REG, drivers: "Performance-disclaimer elicitation; strict number formats" },
  "crypto-web3": { label: "Crypto & web3", sector: "financial", complianceFlags: ["regulated", "jurisdiction-sensitive"], drivers: "Volatility disclaimers; jurisdiction-sensitive compliance" },
  "accounting-tax": { label: "Accounting & tax", sector: "financial", complianceFlags: REG, drivers: "Deadline/seasonal content" },
  "lending-mortgage": { label: "Lending & mortgage", sector: "financial", complianceFlags: REG, drivers: "APR-disclosure elicitation; regulated advertising language" },

  // ── Healthcare & life sciences (regulated) ────────────────────────────────
  "providers-hospitals": { label: "Providers & hospitals", sector: "healthcare", complianceFlags: REG, drivers: "HIPAA-posture privacy copy; calm palette; a11y elevated" },
  "telehealth": { label: "Telehealth", sector: "healthcare", complianceFlags: REG, drivers: "Privacy posture; camera/consult imagery" },
  "pharma": { label: "Pharma", sector: "healthcare", complianceFlags: REG, drivers: "Fair-balance/side-effect disclosure elicitation" },
  "biotech": { label: "Biotech", sector: "healthcare", complianceFlags: REG, drivers: "Scientific credibility imagery; citations pattern" },
  "medical-devices": { label: "Medical devices", sector: "healthcare", complianceFlags: REG, drivers: "Regulatory-clearance language elicitation" },
  "mental-health-wellness": { label: "Mental health & wellness", sector: "healthcare", complianceFlags: REG, drivers: "Tone gentle; crisis-resource pattern; avoid despair clichés" },
  "veterinary": { label: "Veterinary", sector: "healthcare", complianceFlags: [], drivers: "Warm imagery; consumer tone despite clinical content" },

  // ── Retail & consumer goods ───────────────────────────────────────────────
  "fashion-apparel": { label: "Fashion & apparel", sector: "retail-goods", complianceFlags: [], drivers: "Photography maximal; size/fit vocabulary; editorial lookbook flavor" },
  "beauty-cosmetics": { label: "Beauty & cosmetics", sector: "retail-goods", complianceFlags: [], drivers: "Shade/tone vocabulary; ingredient glossary; inclusive imagery" },
  "home-furniture": { label: "Home & furniture", sector: "retail-goods", complianceFlags: [], drivers: "Room-context photography; dimensions/materials vocabulary" },
  "consumer-electronics": { label: "Consumer electronics", sector: "retail-goods", complianceFlags: [], drivers: "Spec tables; comparison components" },
  "grocery-cpg": { label: "Grocery & CPG", sector: "retail-goods", complianceFlags: [], drivers: "Nutrition/label compliance; freshness imagery" },
  "luxury": { label: "Luxury", sector: "retail-goods", complianceFlags: [], drivers: "Whitespace bias; restrained tone; serif flavor" },
  "kids-toys": { label: "Kids & toys", sector: "retail-goods", complianceFlags: ["age-sensitive"], drivers: "Bright palette; under-13 audiences trigger COPPA-class nudges" },
  "pets": { label: "Pets", sector: "retail-goods", complianceFlags: [], drivers: "Warm, playful tone" },
  "sporting-goods": { label: "Sporting goods", sector: "retail-goods", complianceFlags: [], drivers: "Action photography; performance vocabulary" },
  "jewelry-accessories": { label: "Jewelry & accessories", sector: "retail-goods", complianceFlags: [], drivers: "Macro photography; luxury-adjacent restraint" },

  // ── Food & beverage ───────────────────────────────────────────────────────
  "restaurants": { label: "Restaurants", sector: "food-beverage", complianceFlags: [], drivers: "Menu vocabulary; appetite photography; hours/location emphasis" },
  "cafes-coffee": { label: "Cafés & coffee", sector: "food-beverage", complianceFlags: [], drivers: "Craft, warm flavor" },
  "packaged-food": { label: "Packaged food & CPG", sector: "food-beverage", complianceFlags: [], drivers: "Label compliance; recipe content pattern" },
  "alcohol-beverages": { label: "Alcohol & beverages", sector: "food-beverage", complianceFlags: ["age-gated"], drivers: "Age-verification pattern; regulated advertising language" },

  // ── Travel & hospitality ──────────────────────────────────────────────────
  "hotels-lodging": { label: "Hotels & lodging", sector: "travel", complianceFlags: [], drivers: "Aspirational photography; amenity vocabulary" },
  "airlines": { label: "Airlines", sector: "travel", complianceFlags: [], drivers: "Fare-class/fee-transparency vocabulary; travel accessibility content" },
  "tours-experiences": { label: "Tours & experiences", sector: "travel", complianceFlags: [], drivers: "Itinerary vocabulary; social-proof emphasis" },
  "vacation-rentals": { label: "Vacation rentals", sector: "travel", complianceFlags: [], drivers: "Host/guest dual vocabulary" },
  "cruises": { label: "Cruises", sector: "travel", complianceFlags: [], drivers: "Deck/cabin vocabulary" },

  // ── Media & entertainment ─────────────────────────────────────────────────
  "news-publishing": { label: "News & publishing", sector: "media-entertainment", complianceFlags: [], drivers: "Attribution/correction conventions; ad-slot awareness" },
  "film-streaming": { label: "Film & streaming", sector: "media-entertainment", complianceFlags: [], drivers: "Poster art dominance; dark bias" },
  "music": { label: "Music", sector: "media-entertainment", complianceFlags: [], drivers: "Artist-first imagery; tour/release vocabulary" },
  "sports": { label: "Sports", sector: "media-entertainment", complianceFlags: [], drivers: "Team palette override potential; live-state emphasis" },
  "live-events-venues": { label: "Live events & venues", sector: "media-entertainment", complianceFlags: [], drivers: "Date/ticket vocabulary; urgency tone allowance" },

  // ── Education ─────────────────────────────────────────────────────────────
  "k12": { label: "K-12", sector: "education", complianceFlags: ["age-sensitive"], drivers: "Parent+student dual audience; readability tier" },
  "higher-education": { label: "Higher education", sector: "education", complianceFlags: [], drivers: "Institutional tone; program/admission vocabulary" },
  "online-learning": { label: "Online learning & edtech", sector: "education", complianceFlags: [], drivers: "Progress/completion vocabulary; motivational tone" },
  "professional-training": { label: "Professional training & certification", sector: "education", complianceFlags: [], drivers: "Credential vocabulary; B2B2C default hint" },

  // ── Professional & business services ──────────────────────────────────────
  "legal": { label: "Legal", sector: "professional", complianceFlags: [], drivers: "Disclaimer elicitation; formal tone; serif nudge" },
  "consulting": { label: "Consulting", sector: "professional", complianceFlags: [], drivers: "Case-study/outcome vocabulary" },
  "marketing-agencies": { label: "Marketing & agencies", sector: "professional", complianceFlags: [], drivers: "Portfolio-adjacent, visually maximal" },
  "hr-recruiting": { label: "HR & recruiting", sector: "professional", complianceFlags: [], drivers: "Inclusive-language glossary; candidate/employer dual audience" },
  "architecture-engineering": { label: "Architecture & engineering services", sector: "professional", complianceFlags: [], drivers: "Project photography; technical credibility" },

  // ── Industrial & manufacturing ────────────────────────────────────────────
  "manufacturing": { label: "Manufacturing", sector: "industrial", complianceFlags: [], drivers: "Facility/process photography; spec vocabulary" },
  "construction": { label: "Construction", sector: "industrial", complianceFlags: [], drivers: "Safety vocabulary; project-timeline patterns" },
  "logistics-supply-chain": { label: "Logistics & supply chain", sector: "industrial", complianceFlags: [], drivers: "Tracking/status vocabulary; map components" },
  "automotive": { label: "Automotive", sector: "industrial", complianceFlags: [], drivers: "Configurator patterns; spec comparison" },
  "aerospace-defense": { label: "Aerospace & defense", sector: "industrial", complianceFlags: [], drivers: "Restrained palette; export-control content flag" },
  "energy-utilities": { label: "Energy & utilities", sector: "industrial", complianceFlags: REG, drivers: "Outage/status patterns; regulated-rate disclosures" },
  "renewables-cleantech": { label: "Renewables & cleantech", sector: "industrial", complianceFlags: [], drivers: "Impact-metrics vocabulary; green palette (cliché-risk flagged)" },
  "agriculture": { label: "Agriculture", sector: "industrial", complianceFlags: [], drivers: "Seasonal imagery; provenance vocabulary" },

  // ── Public & social sector (regulated) ────────────────────────────────────
  "government-civic": { label: "Government & civic", sector: "public-social", complianceFlags: REG, drivers: "Statutory a11y posture; plain language" },
  "nonprofit-ngo": { label: "Non-profit & NGO", sector: "public-social", complianceFlags: REG, drivers: "Impact/donation vocabulary; authentic-imagery elicitation" },
  "political-advocacy": { label: "Political & advocacy", sector: "public-social", complianceFlags: ["regulated", "jurisdiction-sensitive"], drivers: "Paid-for-by disclosure elicitation; jurisdiction flag" },
  "religious-organizations": { label: "Religious organizations", sector: "public-social", complianceFlags: [], drivers: "Community imagery; service-times pattern" },

  // ── Real estate & property ────────────────────────────────────────────────
  "residential-real-estate": { label: "Residential real estate", sector: "real-estate", complianceFlags: REG, drivers: "Listing vocabulary; fair-housing compliance" },
  "commercial-real-estate": { label: "Commercial real estate", sector: "real-estate", complianceFlags: [], drivers: "B2B density hint; sqft/lease vocabulary" },
  "property-management": { label: "Property management", sector: "real-estate", complianceFlags: [], drivers: "Tenant/owner dual vocabulary" },

  // ── Personal & lifestyle services ─────────────────────────────────────────
  "fitness-wellness": { label: "Fitness & wellness", sector: "personal-services", complianceFlags: [], drivers: "Class/membership vocabulary; body-image-sensitive imagery defaults" },
  "beauty-services": { label: "Beauty & personal care services", sector: "personal-services", complianceFlags: [], drivers: "Booking emphasis (pairs with the Booking category)" },
  "home-services": { label: "Home services", sector: "personal-services", complianceFlags: [], drivers: "Licensed/insured trust signals; service-area patterns" },
  "events-weddings": { label: "Events & weddings", sector: "personal-services", complianceFlags: [], drivers: "Aspirational imagery; date-driven urgency" },
  "photography-creative": { label: "Photography & creative services", sector: "personal-services", complianceFlags: [], drivers: "Portfolio-adjacent; watermark awareness" },
  "coaching-development": { label: "Coaching & personal development", sector: "personal-services", complianceFlags: [], drivers: "Testimonial emphasis; outcome-claim compliance nudge" },
};

/**
 * Legacy classification values → taxonomy ids. "Corporate" is retired (it is
 * a business-model axis, not a vertical) — Consulting is its nearest profile.
 */
export const LEGACY_INDUSTRY_ALIASES: Record<string, string> = {
  "corporate": "consulting",
  "finance": "banking",
  "healthcare": "providers-hospitals",
  "education": "higher-education",
  "retail": "grocery-cpg",
  "technology": "saas-business-software",
  "media": "news-publishing",
  "government": "government-civic",
  "non-profit": "nonprofit-ngo",
};

/** Normalize any stored industry value (legacy alias or taxonomy id). */
export function normalizeIndustry(value: string): string {
  return LEGACY_INDUSTRY_ALIASES[value] ?? value;
}

/** Human label (legacy-tolerant; free-text/custom values fall back verbatim). */
export function industryLabel(value: string): string {
  return INDUSTRY_TAXONOMY[normalizeIndustry(value)]?.label ?? value;
}

/** Selection caption: the drivers line plus any compliance flags. */
export function industryDrivers(value: string): string {
  const profile = INDUSTRY_TAXONOMY[normalizeIndustry(value)];
  if (profile === undefined) return "";
  const flags = profile.complianceFlags.length > 0
    ? ` — flags: ${profile.complianceFlags.join(", ")}`
    : "";
  return `${profile.drivers}${flags}`;
}
