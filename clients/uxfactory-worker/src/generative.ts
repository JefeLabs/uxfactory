/**
 * Generative dispatch — run a SKILL through the autonomous `AgentAdapter`.
 *
 * The generative request kinds run a SKILL verbatim as the adapter's
 * `systemPrompt` and a short kind-specific user instruction:
 *   - `generate-artifact` → the `generate` skill: draft ONE UX artifact for a
 *     classification + project and write it to the registry's expected path.
 *   - `canvas-review`      → the `vision-review` skill: review the pending canvas.
 *   - `generate-design`    → the `design` skill: author self-contained
 *     `design/screens/<page>.html` screens + a `design/trace.json` coverage
 *     manifest covering the stories, then iterate the deterministic
 *     `uxfactory batch` HTML gate to a green bar. Its narration carries
 *     `UXF::PROGRESS <json>` lines that we forward as structured `progress`
 *     events so the panel can render live loop progress.
 *
 * The adapter is INJECTED (the worker depends on the interface, not a concrete
 * backend) and this module imports ONLY types from `@helmsmith/*`, so importing
 * the dispatch loop never pulls in the LLM stack — the real adapter is built
 * lazily in `main()`. We therefore accumulate text-deltas by hand rather than
 * importing the lib's `reduceStream` (which would make this a runtime barrel
 * dependency); both reach the same end-state for the streamed text.
 *
 * Live events: we iterate `adapter.stream(input)` and forward every `AgentChunk`
 * to the bridge (→ SSE → panel), masking any `sk-…`-shaped secret in streamed
 * text first. A `usage` chunk is flattened + forwarded (and its latest cumulative
 * total returned in the result) so the panel can show token cost climbing through
 * the multi-turn loop. Any thrown `AdapterError` (Auth/Billing/RateLimit/Network/…)
 * — or an in-band `error` chunk — is a setup/transport failure → `status 2`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentInput, AgentChunk } from '@helmsmith/agent-adapter';
import type { AgentAdapter } from './adapter.js';
import type { PipelineRequest, BridgeLike } from './bridge-client.js';
import type { DispatchCtx, DispatchOutcome } from './dispatch.js';
import { ensureBatchRegistry } from './batch-registry.js';
import { loadSkill, loadArtifactSkill } from './skills.js';
import { landDesign, realLandingDeps, type LandingResult } from './landing.js';

// ---------------------------------------------------------------------------
// secret masking — never let an `sk-…`-shaped key reach the panel or the result
// ---------------------------------------------------------------------------

/** Matches `sk-…` API-key-shaped runs (e.g. `sk-ant-api03-…`). */
const SK_RE = /sk-[A-Za-z0-9_-]{8,}/g;
const REDACTION = 'sk-[redacted]';

/** Redact any `sk-…`-shaped substring. */
function maskText(s: string): string {
  return s.replace(SK_RE, REDACTION);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/**
 * Project a raw `AgentChunk` into the (masked, JSON-serializable) event posted to
 * the bridge. `text-delta`/`thinking-delta` text is masked; an `error` chunk's
 * `AdapterError` is reduced to `{ name, message }` (an Error serializes to `{}`),
 * with its message masked too; a `usage` chunk is flattened to
 * `{ type:'usage', inputTokens, outputTokens }` so the panel can show tokens
 * climbing live. Everything else passes through verbatim.
 */
function toEvent(chunk: AgentChunk): unknown {
  switch (chunk.type) {
    case 'text-delta':
      return { type: 'text-delta', text: maskText(chunk.text) };
    case 'thinking-delta':
      return { type: 'thinking-delta', text: maskText(chunk.text) };
    case 'error':
      return {
        type: 'error',
        error: { name: chunk.error.name, message: maskText(chunk.error.message) },
      };
    case 'usage':
      return {
        type: 'usage',
        inputTokens: chunk.usage.inputTokens,
        outputTokens: chunk.usage.outputTokens,
      };
    default:
      return chunk;
  }
}

// ---------------------------------------------------------------------------
// progress markers — the `design` loop narrates `UXF::PROGRESS <json>` lines
// ---------------------------------------------------------------------------

/** The progress marker prefix. The agent often prefixes narration before it. */
const PROGRESS_MARKER = 'UXF::PROGRESS';

/** Extract the balanced `{…}` object starting at `s[start]` (`{`), string-aware. */
function balancedObject(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse a narration line into a structured progress event payload, or `null` when
 * it carries no `UXF::PROGRESS <json>` marker or its JSON is malformed (best-effort).
 * The marker may appear MID-LINE — the agent often emits prose then the marker on
 * the same line — so we find it ANYWHERE and extract the balanced JSON object that
 * follows (string-aware, tolerant of trailing text). A `note` field is secret-masked.
 */
export function parseProgressLine(line: string): Record<string, unknown> | null {
  const at = line.indexOf(PROGRESS_MARKER);
  if (at < 0) return null;
  const brace = line.indexOf('{', at + PROGRESS_MARKER.length);
  if (brace < 0) return null;
  const json = balancedObject(line, brace);
  if (json === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const obj = { ...(payload as Record<string, unknown>) };
  if (typeof obj['note'] === 'string') obj['note'] = maskText(obj['note']);
  return obj;
}

// ---------------------------------------------------------------------------
// payload helpers (local copies — keep this module decoupled from dispatch)
// ---------------------------------------------------------------------------

function asObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {};
}

function str(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Unit-type scope guidance for `generate-design`. Keys match the panel
 * composer's unit droplist wire values (Prompt.tsx UNIT_OPTIONS). Unknown or
 * absent unit types add no scope line, so legacy panels are unaffected.
 */
const UNIT_GUIDANCE: Record<string, string> = {
  'user-flow':
    'Scope: a MULTI-SCREEN user flow — author one HTML page per flow step with explicit ' +
    'connective navigation (the control that advances each step), and cover every step ' +
    'and transition state in trace.json.',
  'home-page':
    'Scope: the HOME page (primary landing) — it owns the app shell: full primary ' +
    'navigation, a hero/overview section, and entry points into every major story area.',
  'landing-page':
    'Scope: a STANDALONE CONVERSION page (campaign/ad destination) — one primary CTA and ' +
    'one job; no site navigation shell (it lives outside the IA tree). The copy deck is ' +
    'load-bearing: render its entries verbatim and let the words carry the page. Keep the ' +
    'scroll tight (hero, proof, single CTA repeated); every section must earn its place ' +
    'against the conversion goal.',
  'secondary-page':
    'Scope: a SECONDARY page (a section landing reached from primary navigation) — reuse ' +
    'the shared shell (nav/header) and focus on section-level content; no home hero.',
  'tertiary-page':
    'Scope: a TERTIARY page (detail/leaf content reached from a secondary page) — include ' +
    'breadcrumbs or an explicit way back, and focus on the detail content itself.',
  page: 'Scope: a single standalone PAGE covering the stories it names.',
  template:
    'Scope: a page TEMPLATE — a layout skeleton with clearly named placeholder slots ' +
    'instead of real content; emphasize grid, regions, and slot naming.',
  organism:
    'Scope: a single ORGANISM component (a self-contained section such as a header, card ' +
    'grid, or form) — render it isolated on a neutral canvas page without full-page chrome.',
  molecule:
    'Scope: a single MOLECULE component (a small composed unit such as a labeled input ' +
    'with a button) — isolated on a neutral canvas; no page chrome.',
  atom:
    'Scope: a single ATOM (the smallest UI primitive such as a button, input, or badge) — ' +
    'render its variants and states side by side on one canvas; no page chrome.',
  email:
    'Scope: an HTML EMAIL — a single 600px-wide, table-safe layout with fully inline CSS, ' +
    'no JavaScript, and no web-app chrome; assume email-client rendering (no flex/grid), ' +
    'and include preheader text plus a plain-text-friendly hierarchy.',
  'instagram-post':
    'Scope: an INSTAGRAM POST graphic — one fixed 1080×1080 canvas, no page chrome; ' +
    'bold type hierarchy legible at feed size, brand-token colors only.',
  'instagram-story':
    'Scope: an INSTAGRAM STORY graphic — one fixed 1080×1920 vertical canvas, no page ' +
    'chrome; keep critical content out of the top/bottom ~250px system-UI safe zones.',
  'youtube-thumbnail':
    'Scope: a YOUTUBE THUMBNAIL — one fixed 1280×720 canvas; must stay readable at ' +
    'small preview sizes: max ~4 words, high contrast, a single focal subject.',
  'facebook-post':
    'Scope: a FACEBOOK POST graphic — one fixed 1200×630 canvas, no page chrome; ' +
    'designed to hold up in the link-card crop.',
  'x-post':
    'Scope: an X POST graphic — one fixed 1600×900 canvas, no page chrome; ' +
    'high-contrast composition that reads in a fast-scrolling timeline.',
};

/**
 * Design-style guidance keyed by classification.designStyle (panel wizard
 * vocabulary). Each entry becomes both prompt guidance for the design agent
 * and a craft-rubric conformance section for the vision judge.
 */
export const STYLE_GUIDANCE: Record<string, { label: string; traits: string[] }> = {
  minimalism: {
    label: 'Minimalism',
    traits: [
      'Few elements',
      'No decorative details',
      'Lots of negative space',
      'Minimal use of bold colors',
    ],
  },
  neobrutalism: {
    label: 'Brutalism & Neobrutalism',
    traits: [
      'Provocative layouts',
      'Clashing color palettes',
      'Heavy shadows and outlines',
    ],
  },
  constructivism: {
    label: 'Constructivism',
    traits: [
      'Sans-serif fonts',
      'Various geometric shapes',
      'Elements aligned to one side of the page',
    ],
  },
  swiss: {
    label: 'Swiss Style',
    traits: [
      'Strong modular grid',
      'Clean sans-serif fonts',
      'Minimal, realistic photos and illustrations',
      'Poster-inspired composition',
    ],
  },
  editorial: {
    label: 'Editorial Style',
    traits: [
      'Print-inspired design',
      'High contrast in fonts',
      'Large visuals',
      'Plenty of decorative elements',
    ],
  },
  'hand-drawn': {
    label: 'Hand-drawn Style',
    traits: [
      'Handwritten or script fonts',
      'Sketches and brush strokes',
      'Misaligned or free-form layout',
      'Intentional visual chaos',
    ],
  },
  retro: {
    label: 'Retro',
    traits: [
      'Bright color palettes and gradients',
      'Grainy textures and wear effects',
      'Design elements inspired by old-school tech',
    ],
  },
  flat: {
    label: 'Flat',
    traits: [
      'Total flatness — no shadows or 3D effects',
      'Pastel tones',
      'Clean, readable fonts',
    ],
  },
  bento: {
    label: 'Bento',
    traits: [
      'Many rectangular, rounded content blocks',
      'Very little empty space',
      'No decorative or unconventional design tricks',
    ],
  },
  enterprise: {
    label: 'Enterprise / Utility-first',
    traits: [
      'Extreme data density',
      'Strict atomic component hierarchy',
      'High accessibility',
      'Rigid, functional layouts with no ornamental flair',
    ],
  },
  glassmorphism: {
    label: 'Glassmorphism',
    traits: [
      'Frosted-glass translucent panels',
      'Vivid background colors',
      'Layered vertical depth and hierarchy',
    ],
  },
  material: {
    label: 'Material Design',
    traits: [
      'Realistic paper-and-ink lighting',
      'Grid-based layouts with disciplined padding',
      'Responsive, physically-grounded animations',
    ],
  },
  neumorphism: {
    label: 'Neumorphism (Soft UI)',
    traits: [
      'Low-contrast monochromatic palette',
      'Soft shadows',
      'Elements appear extruded from the background material',
    ],
  },
  wireframe: {
    label: 'Wireframe / Skeletal',
    traits: [
      'Grayscale tones',
      'Simple stroke borders',
      'Placeholder typography',
      'Exposed structural bones of the interface',
    ],
  },
  bauhaus: {
    label: 'Bauhaus',
    traits: [
      'Fundamental geometric shapes (circles, squares, triangles)',
      'Primary colors',
      'Strict grid systems balancing form and function',
    ],
  },
  memphis: {
    label: 'Memphis Design',
    traits: [
      'Energetic abstract geometric patterns and squiggles',
      'Heavily contrasting pastel or neon colors',
      'A sharp, vibrant pivot away from minimalism',
    ],
  },
  aurora: {
    label: 'Aurora / Mesh Gradients',
    traits: [
      'Fluid, blurred mesh gradients',
      'Organic color blends',
      'Dynamic warmth behind an uncluttered foreground',
    ],
  },
  cyberpunk: {
    label: 'Cyberpunk / Dark Tech',
    traits: [
      'Deep dark backgrounds',
      'High-contrast glowing neon accents (cyan, magenta, yellow)',
      'Monospaced typography',
    ],
  },
  claymorphism: {
    label: 'Claymorphism',
    traits: [
      'Floating 3D elements',
      'Very soft rounded corners',
      'Double inner shadows',
      'Tactile, friendly clay-like feel',
    ],
  },
  kinetic: {
    label: 'Kinetic / Typographic-led',
    traits: [
      'Typography carries the entire aesthetic',
      'Aggressively large, tightly kerned text',
      'Animated type as the primary interactive element',
    ],
  },
  skeuomorphic: {
    label: 'Skeuomorphic',
    traits: [
      'Hyper-realistic textures, shadows, and lighting',
      'Mimics real-world materials (leather, brushed metal)',
      'Physical switches and controls',
    ],
  },
  cupertino: {
    label: 'Cupertino (Apple HIG)',
    traits: [
      'Smooth blur and translucent surfaces',
      'Large typography',
      'Content depth and fluid navigation',
    ],
  },
  metro: {
    label: 'Metro (Flat 2.0)',
    traits: [
      'Sharp edges and solid blocks of color',
      'High-contrast typography',
      'Tile-based composition',
    ],
  },
  holographic: {
    label: 'Holographic',
    traits: [
      'Iridescent color palettes',
      'Shimmering gradients',
      'Glowing prism-refraction edges',
    ],
  },
  y2k: {
    label: 'Y2K Aesthetic',
    traits: [
      'Metallic gradients',
      'Bubble fonts',
      'Icy blues and purples',
      'Early-internet optimism',
    ],
  },
  'brutalist-web': {
    label: 'Web 1.0 / Brutalist Web',
    traits: [
      'Default browser styling',
      'Times New Roman and bright blue hyperlinks',
      'Visible table borders',
      'Chaotic, unstyled layouts',
    ],
  },
  'retro-os': {
    label: '90s OS (Win95 / Mac OS 9)',
    traits: [
      'Thick bevels and gray dialog boxes',
      'Pixelated icons',
      'Strict grid-based window management',
    ],
  },
  vaporwave: {
    label: 'Vaporwave',
    traits: [
      'Neon pinks and cyans',
      'Grid lines and retro-tech imagery',
      'Glitch effects with classical statues',
    ],
  },
  'pixel-art': {
    label: 'Pixel Art / 8-bit',
    traits: [
      'Blocky, low-resolution graphics',
      'Restricted color palettes',
      'Jagged, un-aliased typography',
    ],
  },
  'art-deco': {
    label: 'Art Deco',
    traits: [
      'Geometric elegance and symmetrical layouts',
      'High-contrast gold and black palettes',
      'Sophisticated sans-serif typography',
    ],
  },
  'pop-art': {
    label: 'Pop Art',
    traits: [
      'Comic-book halftone dots',
      'Primary colors with thick black outlines',
      'High-energy, contrasting compositions',
    ],
  },
  'de-stijl': {
    label: 'De Stijl',
    traits: [
      'Only straight horizontal and vertical lines',
      'Rectangular forms',
      'Black, white, gray, and primary colors',
    ],
  },
  organic: {
    label: 'Organic / Eco',
    traits: [
      'Earth tones (greens, browns, warm whites)',
      'Organic, irregular shapes',
      'Natural textures (paper, grain)',
      'Humanist typography',
    ],
  },
  'dark-academia': {
    label: 'Dark Academia',
    traits: [
      'Deep browns, maroons, and forest greens',
      'Serif typography',
      'Vintage paper textures',
      'Studious, classical vibe',
    ],
  },
  glitch: {
    label: 'Glitch / Anti-design',
    traits: [
      'Intentional distortion and chromatic aberration',
      'Misaligned grids and overlapping text',
      'A rejection of traditional usability conventions',
    ],
  },
  terminal: {
    label: 'Terminal / CLI',
    traits: [
      'Purely text-based interface',
      'Monospaced typography',
      'Stark dark background with bright green or amber text',
    ],
  },
};

/** Read classification.designStyle when it names a known style; else undefined. */
async function readDesignStyle(projectRoot: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(projectRoot, 'uxfactory.classification.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return undefined;
    const style = (parsed as Record<string, unknown>)['designStyle'];
    return typeof style === 'string' && STYLE_GUIDANCE[style] !== undefined ? style : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the registered audience artifact into an instruction note, or undefined.
 * The audience modulates rendering (tone, density, editorial) — segments are
 * quoted verbatim so the agent designs for the primary segment's context and
 * carries accessibility-relevant characteristics into its choices.
 */
async function readAudienceNote(projectRoot: string): Promise<string | undefined> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(projectRoot, '.uxfactory/artifacts/audience.json'), 'utf8'),
    ) as { segments?: unknown; primarySegment?: unknown };
    if (!Array.isArray(raw.segments) || raw.segments.length === 0) return undefined;
    const segments = raw.segments.filter(
      (s): s is Record<string, unknown> => s !== null && typeof s === 'object',
    );
    if (segments.length === 0) return undefined;
    const primary = typeof raw.primarySegment === 'string' ? raw.primarySegment : undefined;
    const lines = segments.map((s) => {
      const name = typeof s['name'] === 'string' ? s['name'] : 'segment';
      const parts = [
        typeof s['ageRange'] === 'string' ? s['ageRange'] : undefined,
        typeof s['context'] === 'string' ? s['context'] : undefined,
        typeof s['accessibilityNotes'] === 'string' && s['accessibilityNotes'] !== ''
          ? `a11y: ${s['accessibilityNotes']}`
          : undefined,
      ].filter((p): p is string => p !== undefined);
      const primaryTag = name === primary ? ' (PRIMARY)' : '';
      return `${name}${primaryTag}${parts.length > 0 ? ` — ${parts.join('; ')}` : ''}`;
    });
    return (
      `AUDIENCE (registered): ${lines.join(' · ')}. ` +
      'Design for the primary segment first — its context sets tone, density, and type ' +
      'size; honor any accessibility characteristics in every choice. '
    );
  } catch {
    return undefined;
  }
}

/** Conventional per-category viewport sizes (mirror the panel's device defaults). */
const DEFAULT_VIEWPORT_SIZES: Record<
  'desktop' | 'tablet' | 'mobile',
  { width: number; height: number }
> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

/** Fixed canvas per channel unit — overrides any viewport selection. */
const CHANNEL_CANVAS: Record<string, { width: number; height: number }> = {
  email: { width: 600, height: 800 },
  'instagram-post': { width: 1080, height: 1080 },
  'instagram-story': { width: 1080, height: 1920 },
  'youtube-thumbnail': { width: 1280, height: 720 },
  'facebook-post': { width: 1200, height: 630 },
  'x-post': { width: 1600, height: 900 },
};

/** Parse a "WxH" payload size string. */
function parseSize(v: unknown): { width: number; height: number } | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d+)x(\d+)$/.exec(v);
  if (m === null) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Compute the registry `viewports` for a generate-design payload: the channel
 * unit's fixed canvas, or one entry per platform token (device×orientation)
 * sized from `viewportSizes` (panel device config) or the conventional
 * defaults. Landscape tokens swap width/height. Returns undefined when the
 * payload names nothing renderable (legacy payloads clear stale viewports).
 */
function computeViewports(
  p: Record<string, unknown>,
): { name: string; width: number; height: number }[] | undefined {
  const unitType = str(p, 'unitType');
  if (unitType !== undefined && CHANNEL_CANVAS[unitType] !== undefined) {
    const c = CHANNEL_CANVAS[unitType];
    return [{ name: 'canvas', width: c.width, height: c.height }];
  }

  const platforms = Array.isArray(p['platforms'])
    ? (p['platforms'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const sizes =
    p['viewportSizes'] !== null && typeof p['viewportSizes'] === 'object'
      ? (p['viewportSizes'] as Record<string, unknown>)
      : {};

  const out: { name: string; width: number; height: number }[] = [];
  for (const token of platforms) {
    const category = token.startsWith('desktop')
      ? 'desktop'
      : token.startsWith('tablet')
        ? 'tablet'
        : token.startsWith('mobile')
          ? 'mobile'
          : null;
    if (category === null) continue;
    const base = parseSize(sizes[category]) ?? DEFAULT_VIEWPORT_SIZES[category];
    const landscape = token.endsWith('-landscape');
    out.push({
      name: token,
      width: landscape ? base.height : base.width,
      height: landscape ? base.width : base.height,
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Render the `constraints` payload field (array | string | absent) for the prompt. */
function constraintsText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join('; ');
  if (typeof v === 'string' && v.trim() !== '') return v;
  return 'the profile constraints';
}

/** Render the `classification` payload field for the prompt. */
function classificationText(v: unknown): string {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && v.trim() !== '') return v;
  return 'the pinned classification in uxfactory.classification.json';
}

/** Render the `seedRefs` payload field (upstream artifact refs) for the prompt. */
function seedRefsText(v: unknown): string {
  if (Array.isArray(v)) {
    const refs = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (refs.length > 0) return refs.join(', ');
  }
  return 'none (this is an upstream/seed job — there are no prior artifacts to honor)';
}

// ---------------------------------------------------------------------------
// generate-artifact targets — the 3 panel jobs (Stories → ACs → Journeys)
// ---------------------------------------------------------------------------

/**
 * The 3 requirement-artifact workstreams the pipeline panel drives. Each maps to
 * an underlying registry artifact (2 files: stories + ACs persist into
 * `AcceptanceCriterion`; journeys into `UserFlow`) plus a per-target emphasis.
 */
export type GenerateTarget = 'user-story' | 'acceptance-criteria' | 'user-journey';

interface TargetPlan {
  /** The underlying registry artifact the draft persists into. */
  artifact: 'AcceptanceCriterion' | 'UserFlow';
  /** The default registry path used when the payload omits an explicit `path`. */
  pathHint: string;
  /** The per-target skill emphasis threaded into the user instruction. */
  emphasis: string;
}

/** Maps a `target` discriminator → its artifact, default path, and skill emphasis. */
const TARGET_MAP: Record<GenerateTarget, TargetPlan> = {
  'user-story': {
    artifact: 'AcceptanceCriterion',
    pathHint: 'design/acceptance-criteria.json',
    emphasis: 'draft the user-story narratives',
  },
  'acceptance-criteria': {
    artifact: 'AcceptanceCriterion',
    pathHint: 'design/acceptance-criteria.json',
    emphasis: 'draft testable acceptance criteria for the seeded stories',
  },
  'user-journey': {
    artifact: 'UserFlow',
    pathHint: 'design/user-flow.json',
    emphasis: 'draft the user journey / UserFlow spanning the seeded stories',
  },
};

/** Narrow an opaque payload field to a known `GenerateTarget`. */
function isTarget(v: unknown): v is GenerateTarget {
  return Object.prototype.hasOwnProperty.call(TARGET_MAP, v as string) && typeof v === 'string';
}

/**
 * Thrown when a `generate-artifact` request carries an absent or unrecognized
 * `target`. `runGenerative`'s catch maps it to `status 2` (a setup error) — the
 * adapter is never streamed for a request we can't route.
 */
export class InvalidTargetError extends Error {
  constructor(public readonly target: unknown) {
    super(
      `generate-artifact: invalid or missing 'target' (got ${JSON.stringify(target)}); ` +
        `expected one of: user-story | acceptance-criteria | user-journey`,
    );
    this.name = 'InvalidTargetError';
  }
}

// ---------------------------------------------------------------------------
// per-item refs — lift `{ ref, title?, seedRef? }` from the written artifact
// ---------------------------------------------------------------------------

/**
 * A per-item artifact ref the panel seeds downstream jobs from. The panel's
 * `toArtifacts(result)` reads `result.artifacts: ArtifactRef[]` and seeds the
 * next job (ACs / Journeys) from `jobs['user-story'].artifacts[].ref` — so a
 * generate-artifact run MUST surface these or downstream jobs can't seed.
 */
export interface ArtifactRef {
  ref: string;
  title?: string;
  seedRef?: string;
}

/** Narrow to a plain (non-array) object, else `undefined`. */
function rec(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** A required ref-ish value: a non-empty string or a finite number, else `undefined`. */
function idStr(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/** First non-empty string among `vals` (a human label), else `undefined`. */
function labelStr(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === 'string' && v.trim() !== '') return v;
  return undefined;
}

/** Build a ref, omitting absent optional fields (the panel reads them verbatim). */
function makeRef(ref: string, title?: string, seedRef?: string): ArtifactRef {
  const out: ArtifactRef = { ref };
  // `title` is free text read back from the agent-written file; mask any
  // `sk-…`-shaped secret before it reaches the panel (the module's invariant).
  // `ref`/`seedRef` are ids that must round-trip exactly for downstream seeding,
  // so they are NOT masked (a story id will never contain a secret).
  if (title !== undefined) out.title = maskText(title);
  if (seedRef !== undefined) out.seedRef = seedRef;
  return out;
}

/** The story objects from `parsed.stories` (or a top-level array). */
function storyList(parsed: unknown): Record<string, unknown>[] {
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray(rec(parsed)?.['stories'])
      ? (rec(parsed)!['stories'] as unknown[])
      : [];
  return arr.map(rec).filter((x): x is Record<string, unknown> => x !== undefined);
}

/** One UserFlow step (a node-name string, or a tolerant `{ id?, name?, story? }`). */
function stepRef(s: unknown, i: number): ArtifactRef {
  if (typeof s === 'string' || typeof s === 'number') {
    return makeRef(idStr(s) ?? `step-${i + 1}`);
  }
  const so = rec(s) ?? {};
  const ref = idStr(so['id']) ?? labelStr(so['name']) ?? `step-${i + 1}`;
  return makeRef(ref, labelStr(so['name'], so['label']), labelStr(so['story'], so['storyRef']));
}

/** user-story: each story with an `id` → `{ ref, title: goal ?? title ?? name }`. */
function extractStories(parsed: unknown): ArtifactRef[] {
  const out: ArtifactRef[] = [];
  for (const st of storyList(parsed)) {
    const ref = idStr(st['id']);
    if (ref === undefined) continue;
    out.push(makeRef(ref, labelStr(st['goal'], st['title'], st['name'])));
  }
  return out;
}

/**
 * acceptance-criteria: ACs are NESTED per story (no own id), so flatMap each
 * `st.acceptanceCriteria[i]` → `{ ref: `${st.id}#ac-${i+1}`, title, seedRef: st.id }`.
 * A story with no criteria yields one self-seeded `{ ref: st.id, …, seedRef: st.id }`.
 */
function extractCriteria(parsed: unknown): ArtifactRef[] {
  const out: ArtifactRef[] = [];
  for (const st of storyList(parsed)) {
    const ref = idStr(st['id']);
    if (ref === undefined) continue;
    const criteria = Array.isArray(st['acceptanceCriteria'])
      ? (st['acceptanceCriteria'] as unknown[])
      : [];
    if (criteria.length === 0) {
      out.push(makeRef(ref, labelStr(st['goal'], st['title'], st['name']), ref));
      continue;
    }
    criteria.forEach((c, i) => {
      const cr = rec(c) ?? {};
      out.push(makeRef(`${ref}#ac-${i + 1}`, labelStr(cr['statement'], cr['text']), ref));
    });
  }
  return out;
}

/**
 * user-journey: items = `parsed.steps` (canonical `string[]`, tolerant of objects).
 * With no steps, a recognizable flow doc yields ONE artifact from its id/name;
 * a genuinely empty/malformed doc yields `[]`.
 */
function extractJourney(parsed: unknown): ArtifactRef[] {
  if (Array.isArray(parsed)) return parsed.map(stepRef);
  const p = rec(parsed);
  if (p === undefined) return [];
  const hasSteps = Array.isArray(p['steps']);
  const steps = hasSteps ? (p['steps'] as unknown[]) : [];
  if (steps.length > 0) return steps.map(stepRef);
  const ref = idStr(p['id']) ?? labelStr(p['name']);
  const title = labelStr(p['name'], p['title']);
  // Only emit a flow fallback for a flow-shaped doc (declares steps, or names itself).
  if (!hasSteps && ref === undefined && title === undefined) return [];
  return [makeRef(ref ?? 'user-flow', title)];
}

/**
 * Lift per-item refs from a PARSED artifact file for a given target. Pure and
 * tolerant: any missing/malformed/empty input yields `[]` and it NEVER throws.
 */
export function extractArtifacts(parsed: unknown, target: GenerateTarget): ArtifactRef[] {
  try {
    switch (target) {
      case 'user-story':
        return extractStories(parsed);
      case 'acceptance-criteria':
        return extractCriteria(parsed);
      case 'user-journey':
        return extractJourney(parsed);
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/**
 * Best-effort read + parse + extract of the written artifact file. Returns the
 * per-item refs on success, or `undefined` when the file is missing/unreadable/
 * unparseable — the caller then OMITS `artifacts` (a graceful fallback that never
 * fails the generation).
 */
async function readArtifactRefs(
  filePath: string,
  target: GenerateTarget,
): Promise<ArtifactRef[] | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return extractArtifacts(parsed, target);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// permission grant (approach A) — least tools a headless skill needs
// ---------------------------------------------------------------------------

/**
 * The minimal Claude Code permission grant a HEADLESS autonomous skill needs to
 * do its job: shell the `uxfactory` CLI, write/edit artifact files, and READ its
 * inputs + the gate's `.uxfactory/batch/report.json`. The `design` skill drives a
 * full author→gate→read-report→revise loop, so `Read` is required (it reads the
 * stories/profile/registry and the report each iteration); it is a safe,
 * non-prompting tool and the other skills only benefit from it.
 *
 * SECURITY: the `claude-code-cli` adapter sandboxes `HOME → workdir`, so
 * `<projectRoot>/.claude/settings.json` IS the agent's home config FOR THIS RUN.
 * The grant is therefore scoped to the sandboxed run (the project tree) and never
 * widens the host operator's own Claude Code permissions. `.claude/` should be
 * gitignored by the consuming project (the worker's own `.gitignore` already is).
 * The exact least-privilege set for a real run is a live-only check (see notes).
 */
export const SKILL_TOOL_GRANTS = ['Bash(uxfactory:*)', 'Write', 'Edit', 'Read', 'Task'] as const;

/**
 * Idempotently ensure `<projectRoot>/.claude/settings.json` grants the skill the
 * tools it needs. Never clobbers an existing user file: an existing settings
 * object is preserved key-for-key and the `permissions.allow` list is UNION-ed
 * with {@link SKILL_TOOL_GRANTS} (no duplicates). Returns the settings path.
 */
export async function ensureSkillPermissions(projectRoot: string): Promise<string> {
  const dir = path.join(projectRoot, '.claude');
  const file = path.join(dir, 'settings.json');
  await mkdir(dir, { recursive: true });

  let settings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (parsed !== null && typeof parsed === 'object') settings = parsed as Record<string, unknown>;
  } catch {
    // No file yet (ENOENT), or an unparsable one — write a fresh, valid grant.
    // A *valid* user file is never clobbered (the read above succeeds + merges).
  }

  const perms =
    settings.permissions !== null && typeof settings.permissions === 'object'
      ? (settings.permissions as Record<string, unknown>)
      : {};
  const existing = Array.isArray(perms.allow)
    ? (perms.allow as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  const allow = [...existing];
  for (const grant of SKILL_TOOL_GRANTS) {
    if (!allow.includes(grant)) allow.push(grant);
  }

  settings.permissions = { ...perms, allow };
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * SP2: write the craft-judge rubric to `<projectRoot>/.uxfactory/craft-rubric.md` so
 * the in-session craft-judge SUBAGENT (dispatched by the design agent once the gate is
 * green) can read it — the engine's `skill/` dir is NOT in the agent's workspace.
 * Idempotent; the single source is `skill/craft-review/SKILL.md` (via loadSkill).
 */
export async function provisionCraftRubric(
  projectRoot: string,
  designStyle?: string,
): Promise<string> {
  const dir = path.join(projectRoot, '.uxfactory');
  const file = path.join(dir, 'craft-rubric.md');
  await mkdir(dir, { recursive: true });
  let rubric = loadSkill('craft-review');
  // The judge scores against the project's CHOSEN style, not generic taste.
  const styleSpec = designStyle !== undefined ? STYLE_GUIDANCE[designStyle] : undefined;
  if (styleSpec !== undefined) {
    rubric +=
      `\n\n## Design style conformance — ${styleSpec.label}\n\n` +
      'The project pins this design style; score how unmistakably each screen reads in it:\n' +
      styleSpec.traits.map((t) => `- ${t}`).join('\n') +
      '\n';
  }
  await writeFile(file, rubric, 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// panel-artifact plan table — the Artifacts tab concern keys
// ---------------------------------------------------------------------------

/**
 * The artifact concern keys the panel's Artifacts tab sends as
 * `{ kind: "generate-artifact", payload: { artifact: <key>, guidance?: string } }`.
 * Distinct from the legacy `target` discriminator used by the pipeline panel's
 * seeded workstreams (user-story / acceptance-criteria / user-journey).
 */
export type PanelArtifactKey =
  | 'brief'
  | 'sitemap'
  | 'flows'
  | 'brand-colors'
  | 'palettes'
  | 'fonts'
  | 'typography'
  | 'a11y-spec'
  | 'personas'
  | 'stories'
  | 'features'
  | 'audience'
  | 'copy-deck'
  | 'grid'
  | 'tokens'
  | 'icons'
  | 'photography'
  | 'illustrations';

interface PanelArtifactEntry {
  /** Human label used in the generated user instruction. */
  label: string;
  /**
   * Registry-matching path (relative to projectRoot) the agent writes the
   * artifact to. Verbatim copy from `buildArtifacts` in
   * `packages/uxfactory-bridge/src/project.ts` so writing this path flips the
   * snapshot row from `missing` → `up-to-date`.
   */
  path: string;
  /**
   * When set, the four design-system.json section keys (`brand-colors`,
   * `palettes`, `fonts`, `grid`) share a single file; the agent merges/creates
   * exactly this section without touching the others.
   */
  sectionKey?: string;
  /** Set artifact: one JSON file per instance under `path` (a directory). */
  set?: boolean;
  /** Artifact-specific instruction appended to the user prompt. */
  note?: string;
}

/**
 * Maps every panel concern key to its registry-matching target path and a
 * human label. Paths are verbatim from `buildArtifacts` in
 * `packages/uxfactory-bridge/src/project.ts`.
 */
const PANEL_ARTIFACT_MAP: Record<PanelArtifactKey, PanelArtifactEntry> = {
  brief: { label: 'Product Brief', path: '.uxfactory/artifacts/brief.md' },
  sitemap: {
    label: 'Sitemap',
    path: '.uxfactory/artifacts/sitemap.json',
    note:
      ' Give each node a `featureRefs` array naming the registered features' +
      ' (.uxfactory/artifacts/features.json) whose stories the page serves — derive the' +
      ' links from the stories each page realizes.',
  },
  flows: {
    label: 'Flows',
    path: '.uxfactory/artifacts/flows.json',
    note:
      ' If the guidance names the stories this flow realizes, ALSO mirror those story ids' +
      ' into design/user-flow.json as a `storyRefs` array — the flow-story-coverage gate' +
      ' verifies the journey against them.',
  },
  'brand-colors': {
    label: 'Brand Colors',
    path: '.uxfactory/artifacts/design-system.json',
    sectionKey: 'brand-colors',
  },
  palettes: {
    label: 'Palettes',
    path: '.uxfactory/artifacts/design-system.json',
    sectionKey: 'palettes',
  },
  fonts: { label: 'Fonts', path: '.uxfactory/artifacts/design-system.json', sectionKey: 'fonts' },
  grid: { label: 'Grid', path: '.uxfactory/artifacts/design-system.json', sectionKey: 'grid' },
  typography: {
    label: 'Typography',
    path: '.uxfactory/artifacts/design-system.json',
    sectionKey: 'typography',
  },
  'a11y-spec': { label: 'A11y Spec', path: '.uxfactory/artifacts/accessibility.json' },
  personas: {
    label: 'Personas',
    path: '.uxfactory/artifacts/personas',
    set: true,
  },
  stories: {
    label: 'Stories',
    path: '.uxfactory/artifacts/stories',
    set: true,
  },
  features: { label: 'Features', path: '.uxfactory/artifacts/features.json' },
  audience: { label: 'Audience', path: '.uxfactory/artifacts/audience.json' },
  'copy-deck': {
    label: 'Copy deck',
    path: '.uxfactory/artifacts/content/copy-deck.json',
    note:
      ' Shape: {"entries":[{"key":"<page>.<section>.<element>","text":"…"}]} — keys bind to' +
      ' pages by first segment. Derive the slot inventory from the sitemap and stories;' +
      ' generation must render each entry VERBATIM and claim it with data-copy="<key>"' +
      ' (the copy-conformance gate enforces exact text).',
  },
  tokens: { label: 'Tokens', path: 'design/token-set.json' },
  icons: { label: 'Icons', path: '.uxfactory/artifacts/assets/icons.json' },
  photography: { label: 'Photography', path: '.uxfactory/artifacts/assets/photography.json' },
  illustrations: { label: 'Illustrations', path: '.uxfactory/artifacts/assets/illustrations.json' },
};

/** Narrow an opaque value to a known `PanelArtifactKey`. */
function isPanelArtifact(v: unknown): v is PanelArtifactKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PANEL_ARTIFACT_MAP, v);
}

/**
 * Thrown when a `generate-artifact` request carries an `artifact` key that is
 * not one of the panel concern keys. `runGenerative`'s catch maps it to
 * `status 2` — the adapter is never streamed.
 */
export class InvalidArtifactError extends Error {
  constructor(public readonly artifact: unknown) {
    super(
      `generate-artifact: unrecognised 'artifact' key (got ${JSON.stringify(artifact)}); ` +
        `expected one of: ${(Object.keys(PANEL_ARTIFACT_MAP) as PanelArtifactKey[]).join(' | ')}`,
    );
    this.name = 'InvalidArtifactError';
  }
}

// ---------------------------------------------------------------------------
// per-kind plan: which skill + what user instruction + the artifact path
// ---------------------------------------------------------------------------

interface GenerativePlan {
  systemPrompt: string;
  user: string;
  /** Echoed in the result for `generate-artifact` (the registry path written). */
  artifactPath?: string;
  /** The resolved target (drives which per-item refs we lift from the written file). */
  target?: GenerateTarget;
  /**
   * When true (the `generate-design` loop), the stream is scanned for
   * `UXF::PROGRESS <json>` lines and each is forwarded as a structured
   * `{ type: "progress", … }` event so the panel can render live loop progress.
   */
  progress?: boolean;
  /**
   * Single-writer producer (phase 3b): the agent wrote to an ISOLATED scratch
   * path (plan.artifactPath); after the stream we read it back and emit a
   * write-intent so the bridge — the one writer — applies it to the canonical
   * file. The agent never touches a shared file, so producers are pool-safe.
   */
  producerWrite?: {
    /** Canonical path the bridge writes (e.g. design-system.json). */
    canonicalPath: string;
    /** Merge the scratch body under this key (design-system sections). */
    sectionKey?: string;
    /** `.md` target → the scratch body is a raw string, not parsed JSON. */
    markdown: boolean;
  };
}

/** A write-intent posted in the result for the bridge's single writer. */
interface ArtifactWriteIntent {
  path: string;
  body: unknown;
  sectionKey?: string;
}

function planGenerative(
  req: PipelineRequest,
  ctx: DispatchCtx,
  extras?: { designStyle?: string; ungoverned?: boolean; storyRefs?: string[]; audienceNote?: string },
): GenerativePlan {
  const p = asObject(req.payload);

  if (req.kind === 'generate-artifact') {
    // ── Panel-artifact path (Artifacts tab: artifact + optional guidance) ───
    // The panel's Artifacts tab sends `{ artifact: <key>, guidance?: string }`.
    // Route through PANEL_ARTIFACT_MAP when the payload carries an `artifact`
    // key; an explicit but unrecognised key is a setup error (caught → status 2)
    // and the adapter is never streamed.
    const artifact = str(p, 'artifact');
    if (artifact !== undefined) {
      if (!isPanelArtifact(artifact)) throw new InvalidArtifactError(artifact);
      const entry = PANEL_ARTIFACT_MAP[artifact];
      const guidance = str(p, 'guidance');
      const sectionNote =
        entry.sectionKey !== undefined
          ? ` Merge ONLY the '${entry.sectionKey}' section into ${entry.path}` +
            ` (create the file if absent, preserve all other sections).` +
            ` MIGRATION: if ${entry.path} does not exist but design/design-system.json does,` +
            ` first move design/design-system.json to ${entry.path}, then merge —` +
            ` never lose existing sections.`
          : '';
      // Brief content rule (Artifact Editor v1 spec §2 Worker): the brief carries
      // exactly the panel's section schema, never parrots the pinned setup values,
      // and every section earns its place (substance or an honest TBD).
      const briefNote =
        artifact === 'brief'
          ? ' Structure the document with exactly these ## sections in order:' +
            ' ## Overview, ## Audience & insight, ## Goals & success metrics,' +
            ' ## Scope & constraints, ## Risks & open questions.' +
            ' DO NOT restate classification or profile values (category, industry, platforms,' +
            ' scope dials — these are pinned config, not brief content); reference them only' +
            ' where an implication matters (e.g. "given the mobile-first audience").' +
            ' Every section must carry net-new substance; if a section is genuinely unknown' +
            ' at this time, write a single "TBD — needs user input" line for it.' +
            ' Author any enumeration (scope items, outcomes, risks, constraints) as a MARKDOWN' +
            ' LIST — one "- item" per line — never a comma- or semicolon-run in a sentence, so' +
            ' each item renders as its own bullet.'
          : '';
      const guidanceNote =
        guidance !== undefined && guidance.trim() !== ''
          ? ` USER GUIDANCE (honor verbatim): ${guidance}`
          : '';
      // SET artifacts (directories of instances) keep the direct-write path —
      // one file per instance is a separate producer case (deferred).
      if (entry.set === true) {
        const setNote =
          ` This is a SET artifact: ${entry.path} is a DIRECTORY — write one JSON file per` +
          ` instance (e.g. P-01.json, P-02.json), each with a unique id field. 2–4 instances` +
          ` unless the guidance says otherwise; never write a single combined file.`;
        const user =
          `Write the ${entry.label} artifact to ${entry.path} inside ${ctx.projectRoot}.` +
          ` Ground the content in uxfactory.classification.json and uxfactory.profile.json` +
          ` (read both first).${briefNote}${setNote}${entry.note ?? ''}` +
          ` Keep the output strictly the artifact file: valid JSON for .json targets.` +
          ` Report the written path once done.${guidanceNote}`;
        return { systemPrompt: loadArtifactSkill(artifact), user, artifactPath: entry.path };
      }

      // NON-set producer (phase 3b): write to an ISOLATED per-job scratch file.
      // The worker reads it back into a write-intent; the bridge writes the
      // canonical file. The agent never touches a shared file → pool-safe, and
      // for section artifacts the deterministic merge moves to the bridge.
      const isMd = entry.path.endsWith('.md');
      const scratchRel = path.join('.uxfactory', 'scratch', req.id, `${artifact}.${isMd ? 'md' : 'json'}`);
      const writeTarget =
        entry.sectionKey !== undefined
          ? `Write ONLY the content of the '${entry.sectionKey}' section — the JSON object that` +
            ` belongs under that key — to ${scratchRel}. Do not wrap it or add other sections.`
          : `Write the ${entry.label} artifact to ${scratchRel}.`;
      const listRule = isMd
        ? ' Author any enumeration as a MARKDOWN LIST (one "- item" per line), never a' +
          ' comma-run in a sentence, so each item renders as its own bullet.'
        : '';
      const user =
        `${writeTarget} Ground the content in uxfactory.classification.json and` +
        ` uxfactory.profile.json, and read the project's other registered artifacts under` +
        ` .uxfactory/artifacts to stay on-project (read them first).${briefNote}${listRule}${entry.note ?? ''}` +
        ` Output strictly the artifact content: valid JSON for a .json target, Markdown for a` +
        ` .md target. Write ONLY to ${scratchRel} — nowhere else. Report the path once done.${guidanceNote}`;
      return {
        systemPrompt: loadArtifactSkill(artifact),
        user,
        artifactPath: scratchRel,
        producerWrite: {
          canonicalPath: entry.path,
          ...(entry.sectionKey !== undefined ? { sectionKey: entry.sectionKey } : {}),
          markdown: isMd,
        },
      };
    }

    // ── Legacy target path (pipeline panel: target + seedRefs + constraints) ─
    // The panel drives 3 seeded workstreams via a `target` discriminator; an
    // absent/unknown target is a setup error (caught → status 2), never streamed.
    const target = p['target'];
    if (!isTarget(target)) throw new InvalidTargetError(target);

    const plan = TARGET_MAP[target];
    // An explicit `path` overrides the per-artifact default (the skill ultimately
    // writes to the registry's `inputs.<kind>` entry, but we hint a concrete path).
    const artifactPath = str(p, 'path') ?? plan.pathHint;
    const user =
      `Target: ${target} — ${plan.emphasis}. ` +
      `The underlying artifact is ${plan.artifact}; write it as JSON to ${artifactPath} in ${ctx.projectRoot}. ` +
      `Seed refs (upstream stories/artifacts this draft must honor): ${seedRefsText(p['seedRefs'])}. ` +
      `Classification: ${classificationText(p['classification'])}. ` +
      `Honor: ${constraintsText(p['constraints'])}.`;
    return {
      systemPrompt: loadSkill('generate'),
      user,
      artifactPath,
      target,
    };
  }

  if (req.kind === 'canvas-review') {
    return {
      systemPrompt: loadSkill('vision-review'),
      user: 'Review the pending canvas request; post the best-effort report.',
    };
  }

  if (req.kind === 'generate-design') {
    // The agentic high-fidelity HTML loop (matches skill/design/SKILL.md): author
    // self-contained `design/screens/<page>.html` screens (inline CSS + JS) that
    // cover the stories, author `design/tokens.ds.json` when the visual dial is
    // medium+, author a `design/trace.json` mapping every (story, impliedState) to
    // a (page, view, selector), then iterate the deterministic `uxfactory batch`
    // HTML gate to a green bar. The registry is provisioned with `inputs.screens`
    // + `inputs.trace` in `runGenerative` (before the agent's first `batch`) so
    // HTML mode is selected. The skill owns the whole loop; we hand it the task +
    // the working tree (the CLI is on PATH).
    //
    // The composer payload (prompt/unitType/platforms) narrows the task: the
    // user request leads, the unit type sets the scope, platforms set viewports.
    // All three are optional — a legacy/empty payload reproduces the bare task.
    const p = asObject(req.payload);
    const promptText = str(p, 'prompt');
    const unitType = str(p, 'unitType');
    const platforms = Array.isArray(p['platforms'])
      ? (p['platforms'] as unknown[]).filter(
          (x): x is string => typeof x === 'string' && x.trim() !== '',
        )
      : [];

    const requestNote =
      promptText !== undefined && promptText.trim() !== ''
        ? `USER REQUEST (honor verbatim): ${promptText.trim()}. `
        : '';
    const scopeNote =
      unitType !== undefined && UNIT_GUIDANCE[unitType] !== undefined
        ? `${UNIT_GUIDANCE[unitType]} `
        : '';
    const styleSpec =
      extras?.designStyle !== undefined ? STYLE_GUIDANCE[extras.designStyle] : undefined;
    const styleNote =
      styleSpec !== undefined
        ? `Design style: ${styleSpec.label.toUpperCase()} — ${styleSpec.traits.join('; ')}. ` +
          'Every screen must read unmistakably in this style. '
        : '';
    const platformsNote =
      platforms.length > 0
        ? `Target platforms: ${platforms.join(', ')} — lay out and size every screen for these viewports. `
        : '';
    const audienceNote = extras?.audienceNote ?? '';
    const storyRefsNote =
      extras?.storyRefs !== undefined && extras.storyRefs.length > 0
        ? `STORY SCOPE: this unit implements EXACTLY these stories: ${extras.storyRefs.join(', ')}. ` +
          'Cover each of them fully in trace.json; do not claim coverage for any other story. '
        : '';
    const ungovernedNote =
      extras?.ungoverned === true
        ? 'NOTE: this is an UNGOVERNED DRAFT — required grounding artifacts are missing ' +
          'from the project. Proceed, but state your assumptions prominently wherever a ' +
          'registered artifact would normally decide (colors, type, grid, requirements), ' +
          'and never present invented brand values as if they were registered. '
        : '';

    const user =
      requestNote +
      scopeNote +
      styleNote +
      platformsNote +
      audienceNote +
      storyRefsNote +
      ungovernedNote +
      'Author REAL, self-contained UI screens as `design/screens/<page>.html` files ' +
      '(inline <style> + <script>, no external assets) that cover the stories and ' +
      'acceptance criteria in design/acceptance-criteria.json — one file per page, each ' +
      'hosting its view-states (empty/loading/error/success/edge) reachable via the ' +
      'activation contract (location.hash, a query param, or a click sequence; expose ' +
      'window.uxfReady for async states). Author design/tokens.ds.json registering every ' +
      'painted color when the profile visual dial is medium or higher. Author ' +
      'design/trace.json mapping every (story, impliedState) to a (page, view, selector); ' +
      'on page-tier units also set each cover.acId to the specific acceptance criterion the ' +
      'element realizes and mark that element data-ac="<story>/<acId>", so every AC binds to a ' +
      'component (the advisory ac-binding-coverage check nudges toward full AC binding). ' +
      'If a copy deck is registered (inputs.copyDeck), render its entries VERBATIM and claim ' +
      'each with data-copy="<key>" on the element — the copy-conformance gate enforces exact text. ' +
      'Then iterate `uxfactory batch --json -- design` to a green gate (exit 0), reading ' +
      '.uxfactory/batch/report.json after each run and revising the HTML/tokens/trace to ' +
      'clear every must-check finding (render-coverage · a11y · contrast · token-conformance). ' +
      `Work in ${ctx.projectRoot}; the uxfactory CLI is on PATH. ` +
      'Once the deterministic gate is green, run the independent craft-judge step (skill Step 4b): ' +
      'dispatch a fresh subagent following .uxfactory/craft-rubric.md to score the rendered ' +
      'screenshots and write craft-report.json, then revise for craft to the bar before finishing. ' +
      'Emit a UXF::PROGRESS line at every loop step. ' +
      'After the craft bar is met (or the budget is spent with the gate green), run `uxfactory extract --json design` once and report its stats line (phase "extract").';
    return {
      systemPrompt: loadSkill('design'),
      user,
      progress: true,
    };
  }

  throw new Error(`runGenerative: unsupported generative kind '${req.kind}'`);
}

// ---------------------------------------------------------------------------
// runGenerative — stream a SKILL through the adapter, forward + accumulate
// ---------------------------------------------------------------------------

/**
 * Run the SKILL for a generative request. NEVER rejects: every failure (a bad
 * kind, an `AdapterError`, an in-band `error` chunk) returns `{ status: 2 }`, and
 * a clean run returns `{ status: 0, result: { content, artifactPath?, artifacts?,
 * usage? } }`. `usage` (cumulative `inputTokens`/`outputTokens`) is attached only
 * when the runtime reported it; absent runtimes omit it gracefully.
 */
export async function runGenerative(
  req: PipelineRequest,
  adapter: AgentAdapter,
  bridge: BridgeLike,
  ctx: DispatchCtx,
): Promise<DispatchOutcome> {
  try {
    // Design style for the generate-design task + rubric: a valid per-request
    // payload override wins; otherwise the classification-pinned default.
    let designStyle: string | undefined;
    if (req.kind === 'generate-design') {
      const payloadStyle = str(asObject(req.payload), 'designStyle');
      designStyle =
        payloadStyle !== undefined && STYLE_GUIDANCE[payloadStyle] !== undefined
          ? payloadStyle
          : await readDesignStyle(ctx.projectRoot);
    }
    const ungoverned =
      req.kind === 'generate-design' && asObject(req.payload)['ungoverned'] === true;
    const payloadRefs = asObject(req.payload)['storyRefs'];
    const storyRefs =
      req.kind === 'generate-design' &&
      Array.isArray(payloadRefs) &&
      payloadRefs.length > 0 &&
      payloadRefs.every((r) => typeof r === 'string' && r !== '')
        ? (payloadRefs as string[])
        : undefined;
    const audienceNote =
      req.kind === 'generate-design' ? await readAudienceNote(ctx.projectRoot) : undefined;
    const plan = planGenerative(req, ctx, { designStyle, ungoverned, storyRefs, audienceNote });

    // Grant the headless skill the least tools it needs (shell uxfactory + write
    // files) inside the sandboxed project tree before invoking the adapter.
    await ensureSkillPermissions(ctx.projectRoot);

    // For the HTML design loop, register `inputs.screens` + `inputs.trace` in
    // `uxfactory.batch.json` UP FRONT (deterministically — not via the LLM) so the
    // agent's `uxfactory batch` selects HTML mode. These files don't exist yet at
    // provisioning time, so we bypass the existence gate for exactly these two keys;
    // every other input/kind keeps the existence-gated, non-clobbering behavior.
    if (req.kind === 'generate-design') {
      const designPayload = asObject(req.payload);
      const unitType = str(designPayload, 'unitType');
      await ensureBatchRegistry(ctx.projectRoot, {
        unconditional: ['screens', 'trace'],
        // Stamp only vocabulary the CLI registry validates (UNIT_GUIDANCE keys);
        // unknown or absent unit types clear any stale unit from a prior run.
        unit:
          unitType !== undefined && UNIT_GUIDANCE[unitType] !== undefined
            ? unitType
            : undefined,
        // Concrete render viewports for the CLI batch (undefined clears stale).
        viewports: computeViewports(designPayload),
        // The effective style (payload override or classification default) so
        // the CLI's advisory style-conformance check runs against it.
        designStyle,
        // Escape-hatch provenance: the report records that this run generated
        // without its required grounding artifacts (cleared on governed runs).
        ungoverned: ungoverned ? true : undefined,
        // Story-scoped contract: the gate holds this run to exactly these
        // stories (cleared when the composer targets the full set).
        storyRefs,
        // Convergence guard: bound the loop so an unsatisfiable gate can't run
        // unbounded (non-clobbering — a user-set maxIterations wins).
        defaultMaxIterations: 8,
      });
      // SP2: place the craft-judge rubric in the project for the in-session judge subagent.
      await provisionCraftRubric(ctx.projectRoot, designStyle);
    }

    const input: AgentInput = {
      messages: [{ role: 'user', content: plan.user }],
      systemPrompt: plan.systemPrompt,
    };

    let content = '';
    // The latest CUMULATIVE token usage the adapter reported (a `usage` chunk is
    // cumulative — `reduceStream` keeps the last one, so we mirror that and overwrite).
    // Omitted entirely when the runtime never reports usage (graceful, never throws).
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    // Buffer raw text across chunks so a `UXF::PROGRESS` marker that spans reads is
    // only parsed once newline-terminated (the loop narrates progress for the panel).
    let progressBuf = '';
    const emitProgress = async (line: string): Promise<void> => {
      const parsed = parseProgressLine(line);
      if (parsed !== null) await bridge.postEvent(req.id, { type: 'progress', ...parsed });
    };

    for await (const chunk of adapter.stream(input)) {
      // toEvent forwards every chunk masked/normalized — incl. flattening `usage`
      // to `{ type:'usage', inputTokens, outputTokens }` for the live panel feed.
      await bridge.postEvent(req.id, toEvent(chunk));
      if (chunk.type === 'text-delta') {
        content += maskText(chunk.text);
        // Forward structured progress IN ADDITION to the raw (masked) narration.
        if (plan.progress === true) {
          progressBuf += chunk.text;
          const segments = progressBuf.split('\n');
          progressBuf = segments.pop() ?? ''; // last segment may be incomplete — keep it
          for (const line of segments) await emitProgress(line);
        }
      }
      if (chunk.type === 'usage') {
        usage = { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens };
      }
      if (chunk.type === 'error') {
        // An in-band terminal error chunk — setup/transport failure.
        return { status: 2, result: { error: maskText(chunk.error.message), content } };
      }
    }
    // Flush a trailing complete marker that arrived without a closing newline.
    if (plan.progress === true && progressBuf !== '') await emitProgress(progressBuf);

    // The skill wrote the artifact during the stream — READ it back (best-effort)
    // and attach per-item `{ ref, title?, seedRef? }` so the panel can seed the
    // downstream jobs (Stories → ACs / Journeys). A missing/unreadable/unparseable
    // file OMITS `artifacts` (graceful) — it never fails an otherwise-clean run.
    const artifacts =
      plan.target !== undefined && plan.artifactPath !== undefined
        ? await readArtifactRefs(path.join(ctx.projectRoot, plan.artifactPath), plan.target)
        : undefined;

    // For generate-design: publish + bounded-verify each per-view designspec that
    // the skill's Step 4c `uxfactory extract` produced. A landing failure NEVER
    // changes the job status — the whole block is wrapped in try/catch.
    let landing: LandingResult | undefined;
    if (req.kind === 'generate-design') {
      try {
        const bridgeDataDir = ctx.bridgeDataDir ?? path.resolve('.uxfactory');
        const landingResult = await landDesign(ctx.projectRoot, bridgeDataDir, realLandingDeps);
        if (landingResult !== null) {
          landing = landingResult;
          const passes = landingResult.verdicts.filter((v) => v.verify === 'pass').length;
          await bridge.postEvent(req.id, {
            type: 'progress',
            phase: 'landing',
            note: `${landingResult.published.length} published, ${passes} verified`,
          });
        }
      } catch {
        // Catastrophic landing failure — discard silently; status unchanged.
      }
    }

    // Single-writer producer (phase 3b): read the isolated scratch file the
    // agent wrote and emit a write-intent for the bridge's one writer. The
    // result reports the CANONICAL path (not scratch). A missing/unparseable
    // scratch file omits the write-intent — the run still records cleanly.
    let writes: ArtifactWriteIntent[] | undefined;
    let reportedPath = plan.artifactPath;
    if (plan.producerWrite !== undefined && plan.artifactPath !== undefined) {
      reportedPath = plan.producerWrite.canonicalPath;
      try {
        const raw = await readFile(path.join(ctx.projectRoot, plan.artifactPath), 'utf8');
        const body: unknown = plan.producerWrite.markdown ? raw : (JSON.parse(raw) as unknown);
        writes = [
          {
            path: plan.producerWrite.canonicalPath,
            ...(plan.producerWrite.sectionKey !== undefined
              ? { sectionKey: plan.producerWrite.sectionKey }
              : {}),
            body,
          },
        ];
      } catch {
        // No usable scratch output — no write-intent.
      }
    }

    return {
      status: 0,
      result: {
        content,
        ...(reportedPath !== undefined ? { artifactPath: reportedPath } : {}),
        ...(artifacts !== undefined ? { artifacts } : {}),
        ...(writes !== undefined ? { writes } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(landing !== undefined ? { landing } : {}),
      },
    };
  } catch (err) {
    // A thrown AdapterError (Auth/Billing/RateLimit/Network/Provider/…) or any
    // other setup failure → status 2 (the loop also re-maps, but we own a
    // structured, secret-masked result here).
    return { status: 2, result: { error: maskText(errMessage(err)) } };
  }
}
