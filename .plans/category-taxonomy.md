# Project Config: Category Taxonomy

Category = **structural genre** of the product — what shape it is, which drives IA seeds, generation dial defaults, component emphasis, and compliance posture. Distinct from **Industry** (vertical modifier: corporate, healthcare, fashion) and **Platform**. A category earns its slot only if its default profile differs materially from every other category's; overlapping candidates are merged and noted.

## Profile dimensions each category sets

- **Orientation**: conversion | task | content | engagement | trust
- **Dial defaults**: tone / visual / editorial / flows / coverage / coherence (the existing config dials)
- **IA seed**: the sitemap skeleton the setup wizard proposes (greenfield)
- **Component emphasis**: which component archetypes generation biases toward
- **Activates**: artifacts or checks switched on (e.g., `dataviz`, stricter `a11y-spec` default, channel cluster)

## The taxonomy — 8 groups, 34 categories

### 1. Commerce & transactions (orientation: conversion)

| Category | One-liner | Distinct defaults |
|---|---|---|
| Ecommerce storefront | Catalog → cart → checkout retail | PDP/PLP IA seed; product-card & checkout emphasis; trust badges |
| Marketplace | Multi-vendor, buyer/seller duality | Dual-audience IA (buy + sell); seller dashboards; ratings/reviews emphasis |
| Subscription commerce | Recurring purchase, plan-led | Plan-picker/pricing-table emphasis; account-mgmt IA; churn-sensitive copy tone |
| Booking & reservations | Availability + calendar transactions | Date/time pickers, availability grids; confirmation-flow emphasis (hotels, appointments, restaurants, travel) |
| Food ordering & delivery | Menu-to-door realtime commerce | Menu IA; live-status components; mobile-first density |
| Auctions & classifieds | C2C listing lifecycle | Listing composer; bid/offer components; C2C trust & safety copy |

### 2. Marketing & brand (orientation: conversion/content)

| Category | One-liner | Distinct defaults |
|---|---|---|
| Product marketing site | Feature/benefit persuasion for a product | Hero-features-social-proof-CTA seed; visual High; activates channel cluster |
| Corporate site | Multi-audience institutional presence | About/IR/careers/press IA; editorial High; tone formal |
| Landing page / microsite | Single-conversion campaign page | One-page IA; flows Shallow forced; A/B-variant friendliness; instance-bound `creative-brief` front and center |
| Portfolio & showcase | Work-first visual presentation | Gallery/case-study IA; visual maximal, editorial Low; photography artifact promoted |
| Personal site | Identity-first individual presence (bio, CV/résumé, links, contact) | About/work/writing/contact seed; identity-card, timeline, link-list components; visual restrained; **defaults `conformance-policy` to advisory profile** (solo context — intent chain is ceremony at n=1) |
| Event site | Time-boxed gathering | Schedule/speakers/register IA; countdown components; expiry-aware (borrows `creative-brief.expiry`) |
| Nonprofit & cause | Mission storytelling + donation | Donate-flow emphasis; impact-metrics components; tone warm |

### 3. Content & media (orientation: content/engagement)

| Category | One-liner | Distinct defaults |
|---|---|---|
| News & editorial | Recency-ranked article publishing | Front-page hierarchy seed; headline typography scale; editorial Max; density High |
| Blog & publication | Long-form reading | Reading-optimized measure (typography `lineLengthCh` tightened); archive/tag IA |
| Streaming & media | Browse-and-play catalog | Poster-grid emphasis; dark-mode default on; player chrome components |
| Community & forum | Threaded UGC discussion | Thread/reply components; moderation states (activates extra `interaction-states` content states); profile IA |
| Social network | Feed-centric UGC | Composer + feed components; notification patterns; engagement orientation |

### 4. Docs & knowledge (orientation: task/content)

| Category | One-liner | Distinct defaults |
|---|---|---|
| Documentation | Reference docs for a product | Sidebar-nav IA; code-block components; mono face required in `fonts`; search emphasis |
| Help center / KB | Self-service support deflection | Search-first IA; article + contact-escalation seed; glossary promoted to required |
| Wiki / internal knowledge | Team-editable knowledge base | Flat IA, edit affordances; density Medium; minimal brand |

### 5. SaaS & tools (orientation: task)

| Category | One-liner | Distinct defaults |
|---|---|---|
| Dashboard & analytics | Data-dense monitoring/insight | **Activates `dataviz`**; density Max; editorial Min; chart/table emphasis |
| Admin & internal tool | Operator CRUD surfaces | Density Max; visual Low; table/form emphasis; brand minimal; a11y focus-order checks weighted (keyboard-heavy users) |
| Productivity & collaboration | Shared-work application | Presence/realtime components; keyboard-shortcut conventions; empty-state emphasis |
| CRM & business ops | Record-and-pipeline management | Record-detail IA; data-table + kanban emphasis; density High |
| Developer platform | Console + API docs hybrid | Docs + dashboard dual seed; code components; API-key/settings IA |

### 6. Regulated services (orientation: trust) — categories where compliance posture is the differentiator

| Category | One-liner | Distinct defaults |
|---|---|---|
| Fintech & banking | Money movement and management | Disclosure components; number formatting rules (activates `dataviz` numberFormat); tone precise; elevated input-integrity strictness |
| Health & care | Patient-facing health services | `a11y-spec` default elevated; privacy-forward copy defaults; calm palette bias |
| Government & civic | Public services | **`a11y-spec` statutory posture (blocking by default, decision 14 resolved per-category)**; plain-language editorial rules; multilingual weighting |
| Education & e-learning | Courses and learning paths | Progress components; lesson IA seed; readability-tier typography default |

### 7. Listings & portals (orientation: task/conversion)

| Category | One-liner | Distinct defaults |
|---|---|---|
| Listings & directory | Search → results → detail genre | Faceted-search seed; result-card + map components (real estate, jobs, local — Industry disambiguates the vertical) |
| Customer / account portal | Auth-walled self-service | Logged-in IA seed; settings/billing emphasis; empty and error states weighted heavily |
| Membership & gated content | Paywalled content access | Paywall/upgrade components; teaser-state pattern added to `interaction-states` |

### 8. Entertainment (orientation: engagement)

| Category | One-liner | Distinct defaults |
|---|---|---|
| Gaming & entertainment | Game/franchise presence and companion | Visual maximal; motion budget raised (still bounded by `a11y-spec` reduced-motion); dark default; channel cluster activated |

## Merged/rejected candidates (so the list stays a taxonomy, not an inventory)

- **Travel & hospitality** → Booking & reservations + Listings (Industry: travel disambiguates)
- **Job board, real-estate site** → Listings & directory (Industry disambiguates)
- **Podcast site** → Streaming & media
- **Restaurant site** → split: Booking (reservations) or Food ordering — genuinely two genres
- **Agency site** → Portfolio & showcase
- **"Personal" as ownership** (personal blog, personal newsletter) → not a category; ownership is orthogonal to genre, like Industry. Personal blog = Blog & publication; freelancer work site = Portfolio & showcase. Only the identity-first homepage genre earns the Personal site slot.
- **Link-in-bio page** → Personal site (degenerate single-section case)
- **Email client / messaging app** → Productivity & collaboration
- **Insurance / legal portal** → Fintech & banking posture + Customer portal IA (compose, don't enumerate)
- **Crypto/trading** → Fintech & banking (dial differences don't clear the distinct-profile bar)

## Representation & UI

34 categories cannot be four pills. Recommendation:

1. **Registry as data**, symmetrical with the artifact registry: `.uxfactory/config/categories.json`, each entry = `{ categoryId, group, profile: { orientation, dials, iaSeed, componentEmphasis, activates[], compliancePosture } }`. The setup wizard and the config panel both read it; custom categories are user entries in the same file, cloned from the nearest profile.
2. **UI**: grouped combobox with search; the four most recently/commonly used render as pills with a "More…" opener. Selection previews the defaults it will set ("Dashboard & analytics — sets density Max, editorial Min, activates data-viz conventions") so the category's *consequences* are visible before commit — consistent with category being a defaults-driver, not a label.
3. **Changing category after setup** re-proposes dial defaults but never silently overwrites user-modified dials — category sets defaults once; it does not own the dials thereafter.
