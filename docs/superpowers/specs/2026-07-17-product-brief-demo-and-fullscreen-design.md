# Product Brief — Full-Screen Intake + Config-Driven Demo Button

*Design spec. Two improvements to the product-brief root-gate intake (shipped 2026-07-11). Downstream: an implementation plan via writing-plans.*

## 1. Motivation

The product brief is the root gate — every artifact derives from it, and it must be user-authored (the producer refuses answerless briefs; "AI structures your words, it never invents"). Two frictions today:

1. **The 4-question intake is cramped.** It renders in a small centered modal (`CreateArtifactDialog`, `max-w-sm` ≈ 384px) inside a 560×640 plugin window. Answering four substantive questions in tiny textareas is uncomfortable.
2. **A blank intake is a cold start.** A new user staring at four empty questions has nothing to react to. A **Demo** button that fills a plausible, *config-matched* example brief lets them breeze through the flow and see the feature's capabilities — then edit, or hit Generate to run the real producer on the example.

Both are self-contained panel/worker changes. No change to the brief's authorship contract: the demo populates the same `answers` fields the user would type, and nothing is written to project state until the user hits Generate.

## 2. Feature 1 — Full-screen brief intake

**Scope:** only the brief (`artifactKey === "brief"`). Every other artifact keeps the current compact modal.

**Mechanic.**
- **Window resize.** When the brief intake opens, the panel posts the existing `resize` plugin message (the same channel `router.tsx`'s `RESIZE_MAP` uses: `parent.postMessage({ pluginMessage: { type: "resize", width, height } })`, handled in `code.ts` → `figma.ui.resize`). Target a large working size (e.g. 900×720, clamped to Figma's plugin-window bounds). On close, restore to the active route's default (560×640 for `/tabs`).
- **Full-bleed layout.** `CreateArtifactDialog`'s Radix `Dialog.Content` swaps its `w-[92vw] max-w-sm max-h-[85vh]` classes for a full-window layout (`inset-0 w-full h-full`, no rounded card, generous padding, tall textareas) **when `artifactKey === "brief"`**. A shared conditional keeps the compact layout for all other artifacts.

**Restore safety.** The resize-on-open / restore-on-close pair must be robust to the dialog closing by any path (Generate, cancel, Esc, overlay click, unmount). Restore is driven off the dialog's `open` transition to false (and an unmount cleanup), so the window can never be left oversized.

**Non-goals.** No true OS-fullscreen (a Figma plugin can't take the OS screen); "full screen" means "use the whole plugin window, enlarged." No layout change to the banner or other tabs.

## 3. Feature 2 — Config-driven Demo button (LLM)

A **Demo** button inside the brief intake dialog (beside Generate). Clicking it generates a config-matched example idea via the worker and drops first-person answers into the four questions.

### 3.1 Flow

1. **Enqueue.** The panel enqueues a new generative kind **`demo-brief`** via the existing `enqueueMutation` (`POST /pipeline/enqueue`). Payload carries the raw config the panel already holds from the snapshot query:
   ```ts
   { kind: "demo-brief", payload: { classification, profile } }
   ```
   (`classification` = category, industry, locale, platforms, layout, ageGroup, style, designStyle; `profile` = scope dials + coherence.) The payload passes **slugs**, lean — enrichment happens worker-side (§3.3).
2. **Worker generates.** The worker routes `demo-brief` to a new skill `skill/demo-brief/SKILL.md`, which enriches the config from the shared taxonomies (§3.3), invents **one** specific plausible website/app concept matching the combination, and returns first-person answers to the four brief questions.
3. **Result → fields.** The job result carries `{ answers: { problem, outcomes, "out-of-scope", constraints } }`. The panel polls `GET /pipeline/result/:id` (the same mechanic the Interpret button uses — 200 done / 202 pending / 404) and, on a done result, merges the answers into the dialog's answer state.
4. **User edits or Generates.** The four fields are now populated. The user edits freely, or hits **Generate** to run the real brief producer on the example answers — showcasing the full chain in one flow.

### 3.2 Result & population

The dialog's answer state (`CreateArtifactDialog`, `answers: Record<string,string>` keyed by question id) gains a merge point for demo results. Because answers reset on dialog `open`/`artifactKey` change, the parent (`Artifacts.tsx`) holds the demo-generated answers in state and passes them via a new controlled `initialAnswers?: Record<string,string>` prop, merged into the existing `setAnswers` effect (last-write-wins over defaults). Keys are the four elicitation ids (`problem`, `outcomes`, `out-of-scope`, `constraints`). A subsequent demo result while the dialog is open re-merges via the same prop. (This is the chosen mechanism; the app-store/`dynamicPrefills` route is a rejected alternative — it couples the demo to global state unnecessarily.)

### 3.3 Taxonomy enrichment (the idea quality lever)

The generator must be fed the **semantic** config, not bare slugs. The worker resolves, from `@uxfactory/spec` (the same source the panel dropdowns render from):

- **Category** (`CATEGORY_TAXONOMY[slug]` + `CATEGORY_GROUPS`): `group` label (e.g. "SaaS & tools") + `label` (e.g. "Productivity & collaboration") + `oneLiner` (e.g. "Shared-work application") + `iaSeed` (page skeleton) + `componentEmphasis`.
- **Industry** (`INDUSTRY_TAXONOMY[slug]` + `INDUSTRY_SECTORS`): `sector` label (e.g. "Education") + `label` (e.g. "K-12") + `drivers` caption + `complianceFlags` (e.g. `age-sensitive`).
- **Design style** (`design-styles.ts` group + evocative label + the worker's `STYLE_GUIDANCE` description): e.g. "Nostalgic & retro › Y2K Aesthetic", "Thematic & niche › Terminal / CLI", "Modern & dimensional › Aurora / Mesh Gradients". Design style steers the concept's **archetype and voice**, not the literal answer text — the four brief questions are product substance, not visuals. But the aesthetic is a strong vibe signal for *what kind of product suits it*: Terminal/CLI → developer-tooling flavor, Y2K/Vaporwave → playful consumer nostalgia, Dark Academia → reading/education, Enterprise/Utility-first → back-office tooling. The SKILL uses it to pick a fitting concept and tone, and it never appears as a raw token in the answers.
  - **Exploring / unset state.** The design-style dropdown has an "Exploring — no default yet" state (the generative default before a style is committed; `designStyle` unset/empty/sentinel). When style is unset, the generator ignores the aesthetic vibe and grounds the concept on **category + industry alone**. The demo must resolve gracefully with a missing or exploring `designStyle`.
- **Tone/scope:** `style` (informal|mix|formal), platforms, layout, ageGroup, and the scope dials as light framing.

The SKILL.md instructs the model to ground the concept in this context: the category one-liner/IA seed shapes *what the product is*, the industry drivers/compliance shape *the domain and its constraints* (compliance flags flow naturally into the "constraints" answer), and the design style (when set) shapes the concept archetype + voice. Legacy slug aliases normalize first (`LEGACY_CATEGORY_ALIASES` / `LEGACY_INDUSTRY_ALIASES`) so old configs still resolve; a missing/exploring `designStyle` and any absent field degrade to category+industry grounding rather than erroring.

**Worked example.** `category=productivity-collaboration` × `industry=k12` → the model sees "SaaS & tools › Productivity & collaboration · Shared-work application · IA: …" × "Education › K-12 · drivers: … · age-sensitive" → yields e.g. *a lesson-planning collaboration workspace for K-12 teaching teams*, with FERPA/age-appropriate handling surfacing in the constraints answer.

### 3.4 States & errors

- **In flight:** the Demo button shows a "Generating…" state; disabled while a demo job is tracked.
- **No worker connected:** Demo is disabled with a hint (reuse the panel's existing worker-presence signal).
- **Failure / timeout:** a model or worker failure toasts and clears the tracking (no hang — the poll has a timeout backstop, same discipline as Interpret).
- **Re-click with typed content:** if any of the four fields already has user-typed content, Demo asks before overwriting (confirm), so a demo can't clobber real work silently. Re-clicking on empty/demo fields regenerates freely.
- **LLM-free boundary preserved:** the model call lives only in the worker skill. The panel and bridge stay LLM-free; the panel just enqueues and polls.

## 4. Data flow (summary)

```
Demo click
  → panel: enqueue { kind:"demo-brief", payload:{classification,profile} }
  → worker: route → skill/demo-brief/SKILL.md → enrich from @uxfactory/spec taxonomies
            → LLM invents 1 config-matched concept → return { answers:{4 ids} }
  → panel: poll GET /pipeline/result/:id → on done, merge answers into dialog fields
  → user: edits / hits Generate (real producer; writes the brief) 
```

The demo path is **read-only** w.r.t. project state (reads config, returns ephemeral answers). The only write is the user's subsequent Generate, unchanged.

## 5. Files touched (orientation, not prescriptive)

- **Panel:** `ui/components/CreateArtifactDialog.tsx` (full-bleed brief layout + `initialAnswers`/demo merge + Demo button), `ui/screens/Artifacts.tsx` (window resize on brief open/close, demo enqueue + result-poll + hold demo answers), `ui/lib/bridge.ts` (reuse `enqueue` + `getPipelineResult`), `ui/queries.ts` (reuse enqueue mutation).
- **Worker:** `clients/uxfactory-worker/src/skills.ts` (`SkillName` += `demo-brief`), `clients/uxfactory-worker/src/generative.ts` (route `demo-brief` → skill; enrich config from taxonomies; shape the result `{ answers }`), `skill/demo-brief/SKILL.md` (new).
- **Spec:** none required — taxonomies (`category-taxonomy.ts`, `industry-taxonomy.ts`, `design-styles`) already export what enrichment needs. (If a small pure `enrichConfigForDemo(classification)` helper reads cleaner, it lives in `@uxfactory/spec` so the worker imports it — optional.)

## 6. Testing

- **Panel:** brief-open resizes the window (large dims) and restores on close (all close paths); non-brief artifacts unaffected. Demo disabled without a worker; Demo click enqueues `demo-brief` with the `{classification,profile}` payload; a done poll result populates all four fields; overwrite-confirm fires when a field has typed content.
- **Worker:** `demo-brief` resolves to the `demo-brief` skill; the config→enrichment step produces the expected taxonomy context for a sample config (pure helper unit-tested if extracted); result shape is `{ answers: {problem,outcomes,out-of-scope,constraints} }`.
- **SKILL.md** is prose (no unit test); a small parity check that the four answer ids match the elicitation ids guards against drift.

## 7. Non-goals

- No change to the brief authorship contract or the answerless-refusal gate.
- No persistence of demo ideas; each click is fresh and ephemeral.
- No client-side idea generation (the user chose the LLM path for richer ideas).
- No OS-level fullscreen; "full screen" = the enlarged plugin window.
- No batch/multi-idea gallery — one concept per click.
