/**
 * category-taxonomy.ts — the project-category taxonomy as DATA
 * (source: .plans/category-taxonomy.md).
 *
 * Category = structural GENRE of the product — which drives IA seeds, dial
 * defaults, component emphasis, and compliance posture. Distinct from
 * Industry (vertical modifier) and Platform. A category earns its slot only
 * if its default profile differs materially from every other's.
 *
 * Dial defaults are SPARSE — only what the doc states, over the existing six
 * dials. `iaSeed`/`componentEmphasis`/`activates` are consumed by the setup
 * wizard and worker in later phases; the panel already previews them as the
 * category's consequences. `activates` entries are free slugs (artifact ids
 * where they match the registry, check-cluster names otherwise).
 *
 * Per-repo custom categories (`.uxfactory/config/categories.json`, doc §UI-1)
 * are a later phase — this module is the built-in registry they extend.
 */

export type CategoryOrientation =
  | "conversion"
  | "task"
  | "content"
  | "engagement"
  | "trust";

export interface CategoryDialDefaults {
  tone?: "informal" | "mix" | "formal";
  visual?: "low" | "medium" | "high";
  editorial?: "low" | "medium" | "high";
  flows?: "low" | "medium" | "high";
  coverage?: "low" | "medium" | "high";
  coherence?: "low" | "medium" | "high";
}

export interface CategoryProfile {
  label: string;
  group: string;
  orientation: CategoryOrientation;
  oneLiner: string;
  dials: CategoryDialDefaults;
  iaSeed: string[];
  componentEmphasis: string[];
  activates: string[];
  compliancePosture?: string;
}

export const CATEGORY_GROUPS: { id: string; label: string }[] = [
  { id: "commerce", label: "Commerce & transactions" },
  { id: "marketing", label: "Marketing & brand" },
  { id: "content-media", label: "Content & media" },
  { id: "docs-knowledge", label: "Docs & knowledge" },
  { id: "saas-tools", label: "SaaS & tools" },
  { id: "regulated", label: "Regulated services" },
  { id: "listings-portals", label: "Listings & portals" },
  { id: "entertainment", label: "Entertainment" },
];

export const CATEGORY_TAXONOMY: Record<string, CategoryProfile> = {
  // ── 1. Commerce & transactions ────────────────────────────────────────────
  "ecommerce-storefront": {
    label: "Ecommerce storefront", group: "commerce", orientation: "conversion",
    oneLiner: "Catalog → cart → checkout retail",
    dials: {},
    iaSeed: ["Home", "Category (PLP)", "Product (PDP)", "Cart", "Checkout", "Account"],
    componentEmphasis: ["product-card", "checkout-flow", "trust-badges"],
    activates: [],
  },
  "marketplace": {
    label: "Marketplace", group: "commerce", orientation: "conversion",
    oneLiner: "Multi-vendor, buyer/seller duality",
    dials: {},
    iaSeed: ["Home", "Browse", "Listing", "Sell", "Seller dashboard", "Messages"],
    componentEmphasis: ["seller-dashboard", "ratings-reviews", "listing-card"],
    activates: [],
  },
  "subscription-commerce": {
    label: "Subscription commerce", group: "commerce", orientation: "conversion",
    oneLiner: "Recurring purchase, plan-led",
    dials: {},
    iaSeed: ["Home", "Plans & pricing", "Account", "Billing"],
    componentEmphasis: ["plan-picker", "pricing-table", "account-management"],
    activates: [],
  },
  "booking-reservations": {
    label: "Booking & reservations", group: "commerce", orientation: "conversion",
    oneLiner: "Availability + calendar transactions",
    dials: {},
    iaSeed: ["Home", "Search availability", "Detail", "Book", "Confirmation"],
    componentEmphasis: ["date-time-picker", "availability-grid", "confirmation-flow"],
    activates: [],
  },
  "food-ordering": {
    label: "Food ordering & delivery", group: "commerce", orientation: "conversion",
    oneLiner: "Menu-to-door realtime commerce",
    dials: {},
    iaSeed: ["Home", "Menu", "Cart", "Checkout", "Order status"],
    componentEmphasis: ["menu-list", "live-status", "mobile-density"],
    activates: [],
  },
  "auctions-classifieds": {
    label: "Auctions & classifieds", group: "commerce", orientation: "conversion",
    oneLiner: "C2C listing lifecycle",
    dials: {},
    iaSeed: ["Home", "Browse", "Listing", "Post a listing", "Offers", "Profile"],
    componentEmphasis: ["listing-composer", "bid-offer", "trust-safety-copy"],
    activates: [],
  },

  // ── 2. Marketing & brand ──────────────────────────────────────────────────
  "product-marketing-site": {
    label: "Product marketing site", group: "marketing", orientation: "conversion",
    oneLiner: "Feature/benefit persuasion for a product",
    dials: { visual: "high" },
    iaSeed: ["Home (hero → features → social proof → CTA)", "Features", "Pricing", "Contact"],
    componentEmphasis: ["hero", "feature-grid", "social-proof", "cta"],
    activates: ["channel-cluster"],
  },
  "corporate-site": {
    label: "Corporate site", group: "marketing", orientation: "content",
    oneLiner: "Multi-audience institutional presence",
    dials: { editorial: "high", tone: "formal" },
    iaSeed: ["Home", "About", "Investor relations", "Careers", "Press", "Contact"],
    componentEmphasis: ["leadership-grid", "press-list", "careers-list"],
    activates: [],
  },
  "landing-page": {
    label: "Landing page / microsite", group: "marketing", orientation: "conversion",
    oneLiner: "Single-conversion campaign page",
    dials: { flows: "low" },
    iaSeed: ["Landing (single page)"],
    componentEmphasis: ["hero", "cta", "ab-variants"],
    activates: ["creative-brief"],
  },
  "portfolio-showcase": {
    label: "Portfolio & showcase", group: "marketing", orientation: "content",
    oneLiner: "Work-first visual presentation",
    dials: { visual: "high", editorial: "low" },
    iaSeed: ["Work", "Case study", "About", "Contact"],
    componentEmphasis: ["gallery", "case-study", "photography-forward"],
    activates: ["photography"],
  },
  "personal-site": {
    label: "Personal site", group: "marketing", orientation: "content",
    oneLiner: "Identity-first individual presence (bio, CV, links, contact)",
    dials: { visual: "medium" },
    iaSeed: ["About", "Work", "Writing", "Contact"],
    componentEmphasis: ["identity-card", "timeline", "link-list"],
    activates: [],
    compliancePosture: "advisory", // solo context — intent chain is ceremony at n=1
  },
  "event-site": {
    label: "Event site", group: "marketing", orientation: "conversion",
    oneLiner: "Time-boxed gathering",
    dials: {},
    iaSeed: ["Home", "Schedule", "Speakers", "Venue", "Register"],
    componentEmphasis: ["countdown", "schedule-grid", "speaker-card"],
    activates: ["creative-brief"],
  },
  "nonprofit-cause": {
    label: "Nonprofit & cause", group: "marketing", orientation: "conversion",
    oneLiner: "Mission storytelling + donation",
    dials: { tone: "informal" },
    iaSeed: ["Home", "Mission", "Programs", "Impact", "Donate"],
    componentEmphasis: ["donate-flow", "impact-metrics", "story-blocks"],
    activates: [],
  },

  // ── 3. Content & media ────────────────────────────────────────────────────
  "news-editorial": {
    label: "News & editorial", group: "content-media", orientation: "content",
    oneLiner: "Recency-ranked article publishing",
    dials: { editorial: "high" },
    iaSeed: ["Front page", "Section", "Article", "Search"],
    componentEmphasis: ["headline-hierarchy", "article-card", "byline"],
    activates: [],
  },
  "blog-publication": {
    label: "Blog & publication", group: "content-media", orientation: "content",
    oneLiner: "Long-form reading",
    dials: { editorial: "high" },
    iaSeed: ["Home", "Post", "Archive", "Tags", "About"],
    componentEmphasis: ["reading-measure", "post-list", "tag-cloud"],
    activates: [],
  },
  "streaming-media": {
    label: "Streaming & media", group: "content-media", orientation: "engagement",
    oneLiner: "Browse-and-play catalog",
    dials: { visual: "high" },
    iaSeed: ["Browse", "Detail", "Player", "My list", "Search"],
    componentEmphasis: ["poster-grid", "player-chrome", "dark-mode-default"],
    activates: [],
  },
  "community-forum": {
    label: "Community & forum", group: "content-media", orientation: "engagement",
    oneLiner: "Threaded UGC discussion",
    dials: {},
    iaSeed: ["Home", "Category", "Thread", "Compose", "Profile"],
    componentEmphasis: ["thread", "reply", "moderation-states"],
    activates: ["interaction-states"],
  },
  "social-network": {
    label: "Social network", group: "content-media", orientation: "engagement",
    oneLiner: "Feed-centric UGC",
    dials: {},
    iaSeed: ["Feed", "Profile", "Compose", "Notifications", "Messages"],
    componentEmphasis: ["composer", "feed", "notification-patterns"],
    activates: [],
  },

  // ── 4. Docs & knowledge ───────────────────────────────────────────────────
  "documentation": {
    label: "Documentation", group: "docs-knowledge", orientation: "task",
    oneLiner: "Reference docs for a product",
    dials: {},
    iaSeed: ["Overview", "Getting started", "Guides", "API reference", "Search"],
    componentEmphasis: ["sidebar-nav", "code-block", "search"],
    activates: ["fonts-mono"],
  },
  "help-center": {
    label: "Help center / KB", group: "docs-knowledge", orientation: "task",
    oneLiner: "Self-service support deflection",
    dials: {},
    iaSeed: ["Search", "Categories", "Article", "Contact support"],
    componentEmphasis: ["search-first", "article", "contact-escalation"],
    activates: ["glossary"],
  },
  "wiki-knowledge": {
    label: "Wiki / internal knowledge", group: "docs-knowledge", orientation: "task",
    oneLiner: "Team-editable knowledge base",
    dials: { visual: "low" },
    iaSeed: ["Home", "Page", "Recent changes", "Search"],
    componentEmphasis: ["edit-affordances", "flat-nav", "minimal-brand"],
    activates: [],
  },

  // ── 5. SaaS & tools ───────────────────────────────────────────────────────
  "dashboard-analytics": {
    label: "Dashboard & analytics", group: "saas-tools", orientation: "task",
    oneLiner: "Data-dense monitoring/insight",
    dials: { editorial: "low" },
    iaSeed: ["Overview", "Report", "Explore", "Settings"],
    componentEmphasis: ["chart", "data-table", "kpi-card"],
    activates: ["dataviz"],
  },
  "admin-internal": {
    label: "Admin & internal tool", group: "saas-tools", orientation: "task",
    oneLiner: "Operator CRUD surfaces",
    dials: { visual: "low", editorial: "low" },
    iaSeed: ["List", "Detail", "Edit", "Settings", "Audit log"],
    componentEmphasis: ["data-table", "form", "keyboard-focus-order"],
    activates: ["a11y-focus-order"],
  },
  "productivity-collaboration": {
    label: "Productivity & collaboration", group: "saas-tools", orientation: "task",
    oneLiner: "Shared-work application",
    dials: {},
    iaSeed: ["Workspace", "Document/board", "Share", "Settings"],
    componentEmphasis: ["presence", "realtime", "empty-states", "keyboard-shortcuts"],
    activates: ["interaction-states"],
  },
  "crm-business-ops": {
    label: "CRM & business ops", group: "saas-tools", orientation: "task",
    oneLiner: "Record-and-pipeline management",
    dials: {},
    iaSeed: ["Pipeline", "Record detail", "Lists", "Reports"],
    componentEmphasis: ["data-table", "kanban", "record-detail"],
    activates: [],
  },
  "developer-platform": {
    label: "Developer platform", group: "saas-tools", orientation: "task",
    oneLiner: "Console + API docs hybrid",
    dials: {},
    iaSeed: ["Console", "Docs", "API keys", "Usage", "Settings"],
    componentEmphasis: ["code-block", "api-key-management", "usage-charts"],
    activates: ["fonts-mono", "dataviz"],
  },

  // ── 6. Regulated services ─────────────────────────────────────────────────
  "fintech-banking": {
    label: "Fintech & banking", group: "regulated", orientation: "trust",
    oneLiner: "Money movement and management",
    dials: { tone: "formal" },
    iaSeed: ["Overview", "Accounts", "Transfer", "Statements", "Settings"],
    componentEmphasis: ["disclosure", "number-formatting", "transaction-list"],
    activates: ["dataviz"],
    compliancePosture: "elevated",
  },
  "health-care": {
    label: "Health & care", group: "regulated", orientation: "trust",
    oneLiner: "Patient-facing health services",
    dials: {},
    iaSeed: ["Home", "Appointments", "Records", "Messages", "Billing"],
    componentEmphasis: ["calm-palette", "privacy-forward-copy", "appointment-flow"],
    activates: ["a11y-elevated"],
    compliancePosture: "elevated",
  },
  "government-civic": {
    label: "Government & civic", group: "regulated", orientation: "trust",
    oneLiner: "Public services",
    dials: { tone: "formal" },
    iaSeed: ["Home", "Services", "Apply", "Status", "Contact"],
    componentEmphasis: ["plain-language", "form", "multilingual"],
    activates: ["a11y-statutory"],
    compliancePosture: "statutory", // a11y blocking by default (mapping decision 14)
  },
  "education-elearning": {
    label: "Education & e-learning", group: "regulated", orientation: "trust",
    oneLiner: "Courses and learning paths",
    dials: {},
    iaSeed: ["Catalog", "Course", "Lesson", "Progress", "Profile"],
    componentEmphasis: ["progress", "lesson-nav", "readability-typography"],
    activates: [],
  },

  // ── 7. Listings & portals ─────────────────────────────────────────────────
  "listings-directory": {
    label: "Listings & directory", group: "listings-portals", orientation: "task",
    oneLiner: "Search → results → detail genre",
    dials: {},
    iaSeed: ["Search", "Results", "Detail", "Saved", "Compare"],
    componentEmphasis: ["faceted-search", "result-card", "map"],
    activates: [],
  },
  "customer-portal": {
    label: "Customer / account portal", group: "listings-portals", orientation: "task",
    oneLiner: "Auth-walled self-service",
    dials: {},
    iaSeed: ["Sign in", "Overview", "Settings", "Billing", "Support"],
    componentEmphasis: ["settings", "billing", "empty-states", "error-states"],
    activates: ["interaction-states"],
  },
  "membership-gated": {
    label: "Membership & gated content", group: "listings-portals", orientation: "conversion",
    oneLiner: "Paywalled content access",
    dials: {},
    iaSeed: ["Preview", "Join", "Member home", "Account"],
    componentEmphasis: ["paywall", "upgrade", "teaser-state"],
    activates: ["interaction-states"],
  },

  // ── 8. Entertainment ──────────────────────────────────────────────────────
  "gaming-entertainment": {
    label: "Gaming & entertainment", group: "entertainment", orientation: "engagement",
    oneLiner: "Game/franchise presence and companion",
    dials: { visual: "high" },
    iaSeed: ["Home", "Game/franchise", "Media", "Community", "News"],
    componentEmphasis: ["motion", "dark-default", "media-gallery"],
    activates: ["channel-cluster"],
  },
};

/**
 * Legacy classification values (the original four pills) → taxonomy ids.
 * Reads normalize; the next classification write upgrades the stored value.
 */
export const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  "marketing": "product-marketing-site",
  "ecommerce": "ecommerce-storefront",
  "webapp": "productivity-collaboration",
  "news": "news-editorial",
};

/** Normalize any stored category value (legacy alias or taxonomy id). */
export function normalizeCategory(value: string): string {
  return LEGACY_CATEGORY_ALIASES[value] ?? value;
}

/** Human label for a category value (legacy-tolerant; falls back to the raw value). */
export function categoryLabel(value: string): string {
  return CATEGORY_TAXONOMY[normalizeCategory(value)]?.label ?? value;
}

/**
 * One-line preview of the consequences a category sets — the doc's "defaults
 * driver, not a label" principle made visible before commit.
 */
export function categoryConsequences(value: string): string {
  const profile = CATEGORY_TAXONOMY[normalizeCategory(value)];
  if (profile === undefined) return "";
  const parts: string[] = [];
  for (const [dial, level] of Object.entries(profile.dials)) {
    parts.push(`${dial} ${level}`);
  }
  if (profile.activates.length > 0) parts.push(`activates ${profile.activates.join(", ")}`);
  if (profile.compliancePosture !== undefined) {
    parts.push(`${profile.compliancePosture} compliance posture`);
  }
  return parts.length > 0 ? `Sets ${parts.join(" · ")}` : profile.oneLiner;
}
