# Project Config: Industry Taxonomy

Industry = **vertical domain modifier**. Where Category drives structure (IA seeds, component emphasis), Industry drives flavor: photography/illustration subjects, glossary seed terms, palette and tone bias, and **compliance nudges**. Because it modifies rather than structures, the taxonomy is deliberately more enumerative than Category — two-level (sector → industry), searchable, with free-text Other mapped to the nearest profile.

**Removed from the current list: "Corporate."** It is not a vertical — it conflates the business-model axis. Recommendation: add a separate config field **Audience model: B2C | B2B | B2B2C | Internal**, which modulates density, tone formality, and buyer-vs-user copy independently of any industry. (B2B fintech and B2C fintech share a glossary; they do not share a tone.)

## What each industry entry drives

`{ industryId, sector, photographySubjects[], glossarySeeds[], paletteBias, toneBias, complianceFlags[], illustrationBias }`

Compliance flags feed two places: `conformance-policy` severity nudges and elicitation additions (e.g., a disclosures question appended to `copy-deck` interview). Flags never silently change requirements — they surface as suggested policy entries the team accepts or rejects.

## The taxonomy — 13 sectors, 76 industries

### Technology & software
| Industry | Notable drivers |
|---|---|
| SaaS & business software | Product-UI screenshots over photography; glossary: workspace/plan/seat battles |
| Consumer apps & internet | Lifestyle photography; casual tone bias |
| Developer tools & infrastructure | Mono-heavy type flavor; terminal/code imagery; glossary: API/SDK conventions |
| AI & data | Abstract illustration bias (avoid robot clichés — encode in `photography.avoid`) |
| Cybersecurity | Trust palette (deep blues); tone precise; avoid fear imagery |
| Hardware & devices | Product photography primary; spec-table glossary |
| Telecom | Coverage/connectivity vocabulary |
| Gaming (industry) | Motion budget up; dark bias — pairs with Gaming category but valid for e.g. a games studio's corporate site |

### Financial services — sector flag: `regulated`
| Industry | Notable drivers |
|---|---|
| Banking | Disclosures elicitation (FDIC-equivalents by locale); tone precise; trust palette |
| Fintech & payments | PCI vocabulary; fee-transparency glossary battles |
| Insurance | Plain-language nudge; policy/claim/premium glossary |
| Investment & wealth | Performance-disclaimer elicitation; `dataviz` numberFormat strictness |
| Crypto & web3 | Volatility disclaimers; jurisdiction-sensitive compliance flag |
| Accounting & tax | Deadline/seasonal content flag |
| Lending & mortgage | APR-disclosure elicitation; regulated advertising language |

### Healthcare & life sciences — sector flag: `regulated`
| Industry | Notable drivers |
|---|---|
| Providers & hospitals | HIPAA-posture privacy copy; calm palette; a11y elevated |
| Telehealth | Same + camera/consult imagery |
| Pharma | Fair-balance/side-effect disclosure elicitation (heavily regulated advertising) |
| Biotech | Scientific credibility imagery; citations pattern |
| Medical devices | Regulatory-clearance language elicitation |
| Mental health & wellness | Tone gentle; crisis-resource pattern nudge; avoid stock-photo despair clichés |
| Veterinary | Warm imagery; consumer tone despite clinical content |

### Retail & consumer goods
| Industry | Notable drivers |
|---|---|
| Fashion & apparel | Photography maximal; size/fit glossary; editorial lookbook flavor |
| Beauty & cosmetics | Shade/tone vocabulary; ingredient glossary; inclusive imagery elicitation |
| Home & furniture | Room-context photography; dimensions/materials glossary |
| Consumer electronics | Spec tables; comparison components nudge |
| Grocery & CPG | Nutrition/label compliance flag; freshness imagery |
| Luxury | Whitespace bias; restrained tone; serif flavor nudge |
| Kids & toys | **`age-sensitive` flag: with Age config under-13 triggers COPPA-class policy nudges**; bright palette |
| Pets | Warm/playful tone |
| Sporting goods | Action photography; performance vocabulary |
| Jewelry & accessories | Macro photography; luxury-adjacent restraint |

### Food & beverage
| Industry | Notable drivers |
|---|---|
| Restaurants | Menu vocabulary; appetite photography; hours/location emphasis |
| Cafés & coffee | Craft/warm flavor |
| Packaged food & CPG | Label compliance flag; recipe content pattern |
| Alcohol & beverages | **`age-gated` flag: age-verification pattern nudge; regulated advertising language** |

### Travel & hospitality
| Industry | Notable drivers |
|---|---|
| Hotels & lodging | Aspirational photography; amenity glossary |
| Airlines | Fare-class/fee-transparency glossary; accessibility-of-travel content flag |
| Tours & experiences | Itinerary vocabulary; social-proof emphasis |
| Vacation rentals | Host/guest dual glossary |
| Cruises | Deck/cabin vocabulary |

### Media & entertainment
| Industry | Notable drivers |
|---|---|
| News & publishing | Attribution/correction conventions in glossary; ad-slot awareness |
| Film & streaming | Poster art dominance; dark bias |
| Music | Artist-first imagery; tour/release vocabulary |
| Sports | Team palette override potential (brand-colors may be REFERENCED from league); live-state emphasis |
| Live events & venues | Date/ticket vocabulary; urgency tone allowance |

### Education
| Industry | Notable drivers |
|---|---|
| K-12 | **`age-sensitive` flag**; parent+student dual audience; readability tier |
| Higher education | Institutional tone; program/admission glossary |
| Online learning & edtech | Progress/completion vocabulary; motivational tone |
| Professional training & certification | Credential vocabulary; B2B2C default hint |

### Professional & business services
| Industry | Notable drivers |
|---|---|
| Legal | Disclaimer elicitation ("not legal advice"); formal tone; serif nudge |
| Consulting | Case-study/outcome vocabulary |
| Marketing & agencies | Portfolio-adjacent visual maximal |
| HR & recruiting | Inclusive-language glossary emphasis; candidate/employer dual audience |
| Architecture & engineering services | Project photography; technical credibility |

### Industrial & manufacturing
| Industry | Notable drivers |
|---|---|
| Manufacturing | Facility/process photography; spec vocabulary |
| Construction | Safety vocabulary; project-timeline patterns |
| Logistics & supply chain | Tracking/status vocabulary; map components nudge |
| Automotive | Configurator patterns; spec comparison |
| Aerospace & defense | Restrained palette; export-control content flag |
| Energy & utilities | Outage/status patterns; regulated-rate disclosure flag |
| Renewables & cleantech | Impact-metrics vocabulary; green palette bias (flag as cliché-risk) |
| Agriculture | Seasonal imagery; provenance vocabulary |

### Public & social sector — sector flag: `regulated`
| Industry | Notable drivers |
|---|---|
| Government & civic | Statutory a11y posture (aligns with Government category when both selected); plain language |
| Non-profit & NGO | Impact/donation vocabulary; authentic-imagery elicitation |
| Political & advocacy | Disclosure requirements ("paid for by") elicitation; jurisdiction flag |
| Religious organizations | Community imagery; service-times pattern |

### Real estate & property
| Industry | Notable drivers |
|---|---|
| Residential real estate | Listing vocabulary (beds/baths/sqft by locale); fair-housing compliance flag |
| Commercial real estate | B2B density hint; sqft/lease vocabulary |
| Property management | Tenant/owner dual glossary |

### Personal & lifestyle services
| Industry | Notable drivers |
|---|---|
| Fitness & wellness | Before/after imagery **flag: pairs with a11y and body-image sensitivity — encode `photography.avoid` defaults**; class/membership vocabulary |
| Beauty & personal care services | Booking emphasis (pairs with Booking category) |
| Home services | Trust signals (licensed/insured vocabulary); service-area patterns |
| Events & weddings | Aspirational imagery; date-driven urgency |
| Photography & creative services | Portfolio-adjacent; watermark awareness |
| Coaching & personal development | Testimonial emphasis; outcome-claim compliance nudge |

## Cross-cutting flags (orthogonal to sector)

- `regulated` — appends disclosure questions to `copy-deck`/`creative-brief` interviews; suggests stricter `conformance-policy` profile
- `age-sensitive` — interacts with the Age config: under-13 audiences trigger COPPA-class nudges (data-collection copy, parental-consent patterns); note current config shows **Age: under-18 with Category: Ecommerce storefront — that combination should already be surfacing a nudge**
- `age-gated` — age-verification pattern required (alcohol; extendable to cannabis, gambling if added)
- `jurisdiction-sensitive` — compliance varies by locale; pairs with the Locale config to scope which disclosure sets apply

## Representation & UI

Same registry pattern as categories: `.uxfactory/config/industries.json`. UI: grouped, searchable combobox (76 entries can never be pills); free-text Other creates a custom entry cloned from nearest sector defaults. Multi-select worth considering — real businesses straddle (fintech × real estate = mortgage tech); if allowed, first selection wins conflicts, flags union.

**Interplay rule**: Category × Industry is a matrix, not a hierarchy — Ecommerce storefront × Fashion and Ecommerce storefront × Grocery share structure and differ in flavor; Fashion × Ecommerce and Fashion × Marketing site share flavor and differ in structure. Neither taxonomy may absorb the other's job: any proposed industry that changes IA seeds is actually a category; any proposed category that only changes imagery is actually an industry.
