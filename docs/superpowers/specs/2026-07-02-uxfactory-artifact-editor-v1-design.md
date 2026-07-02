# Artifact Editor v1 — MDXEditor, sectioned guidance, edit/save/regenerate (Design)

**Date:** 2026-07-02
**Status:** Approved direction (user, live during acceptance walk). Sequenced BEFORE the TanStack adoption (feature-first; the refactor then migrates it with everything else).

## 1. Requirements (user's words → spec)

1. **MDXEditor for displaying artifacts** — markdown artifacts open **in-panel** in a rich editor, not (only) the external editor.
2. **Sections isolated with guidance text** — the editor presents the artifact split into sections, each with muted guidance copy above it.
3. **Open → edit / save / regenerate** — full lifecycle in-panel: edit content, Save writes back, Regenerate re-runs generation (via the existing guided dialog).
4. **Brief must not restate setup values** — generated briefs reference the pinned classification/profile implicitly; no parroting category/industry/platforms/dials. Substance only: product story, audience insight, goals, success metrics, scope, risks.

## 2. Design

### Bridge (additive)
- `GET /project/artifact?key=<concernKey>` → `{key, path, format: "markdown"|"json", content: string}` (404 when missing; path containment enforced).
- `PUT /project/artifact` `{key, content}` → `{ok}` — writes to the concern's resolved path (registry-aware, same resolution as the snapshot); after write the snapshot freshness reflects it.
- CORS already allows PUT.

### Panel
- **Artifacts row actions become:** `Open` → **in-panel editor view** (new subview within the Artifacts tab, not a modal — full panel height; Back returns to the inventory); secondary icon action `↗` = the old external `openPath`.
- **Editor view (markdown artifacts, e.g. brief):**
  - Header: artifact label + freshness dot + actions `Save` (primary, dirty-gated) · `Regenerate` (opens the existing guided-create dialog) · `Back`.
  - Body: content split by `## ` headings into **section cards**: section title, **guidance text** (muted, from a per-artifact section-schema map), and an **MDXEditor** instance scoped to that section's markdown. Unknown/extra sections render with generic guidance; missing schema sections are offered as "Add section" stubs.
  - Save reassembles sections → single markdown → `PUT /project/artifact`; toast + freshness refresh. Dirty tracking per section; leaving with unsaved changes prompts.
- **JSON artifacts (tokens, design-system, assets registries) v1:** read-only pretty view + `Regenerate` + external open. (JSON structured editing is its own later phase.)
- **MDXEditor:** `@mdxeditor/editor` with a MINIMAL plugin set (headings, lists, bold/italic/links, markdownShortcut) — tree-shaken. **Bundle budget raised to 2MB inlined** (measured in the plan; Figma's real limit is far higher; the 1.5MB figure was self-imposed).

### Brief section schema (the first per-artifact schema)
`Overview` ("What is this product in one paragraph — the elevator story."), `Audience & insight` ("Who is this for and what do we know about them beyond the demographics already pinned in setup?"), `Goals & success metrics` ("What outcomes define success — measurable where possible."), `Scope & constraints` ("What's in, what's explicitly out, and any hard constraints."), `Risks & open questions` ("What could sink this and what remains undecided."). Guidance strings live beside the create-dialog guidance map (one module: `ui/lib/artifact-schemas.ts`).

### Worker (brief content rule)
The `brief` plan's instructions gain: structure the document with exactly the schema's `## ` sections; **do NOT restate classification/profile values** (they are pinned config, not brief content — reference them only where an implication matters, e.g. "given the mobile-first audience"); every section must carry net-new substance or an honest "TBD — needs user input" line.

## 3. Testing
Bridge: artifact GET/PUT round-trip (registry-resolved paths, containment, 404). Panel: open→sections render with schema guidance; edit→Save PUTs reassembled markdown + dirty gating + unsaved prompt; Regenerate opens the dialog; JSON artifacts read-only path; external-open secondary. Worker: brief plan includes schema sections + the no-restatement rule (prompt-content assertions). Bundle: ui.html measured < 2MB, still self-contained.

## 4. Non-goals
JSON editing; concurrent-edit conflict handling beyond last-write-wins + freshness flag; MDX components beyond core markdown; per-section regenerate (whole-artifact only in v1).
