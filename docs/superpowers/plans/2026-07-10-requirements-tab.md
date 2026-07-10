# Requirements Tab (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-class Requirements tab (second position) hosting the features→stories→ACs graph with coverage rollups, search/filters, canvas jumps, open-in-editor, and a per-story Generate handoff — replacing the TraceView parked in Components.

**Architecture:** One additive bridge wire field (`TraceStory.filePath`), then panel-only work: a new `/tabs/requirements` route + `TAB_DEFS` entry, a `Requirements` screen built from action-bearing tree components over the existing `traceQuery`, a `pendingStoryRefs` store handoff into Prompt's existing `scopedStories` state, and removal of the old read-only TraceView from Components.

**Tech Stack:** React + TanStack Router/Query + Zustand + Radix Tabs + Tailwind tokens; Fastify bridge; vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-10-requirements-tab-design.md` — read it first.

## Global Constraints

- Node ≥ 20.10, pnpm workspace, commands from repo root unless stated. Commit directly to `main`.
- Changeset: `@uxfactory/bridge` minor (Task 1 only). Panel is private — no other changesets.
- Tab order (verbatim): `Generate | Requirements | Artifacts | Components | Assets | Checks`. `TAB_DEFS` is LABEL-ONLY (no icons — the spec's icon line is superseded by the actual TabNav design).
- Coverage definitions (verbatim): uncovered story = `story.coveredBy.length === 0`; unverified AC = `ac.coveredBy.length === 0 && ac.linkedNodes.length === 0`. Search matches feature name, story id/actor/want, AC id/statement. Search and filters AND-compose.
- Conformance dot semantics identical to the old TraceView: green `conformed === true`, amber `=== false`, gray `null`.
- Handoff contract: store `pendingStoryRefs: string[] | null` (initial null); `setPendingStoryRefs(refs)`; `consumePendingStoryRefs()` returns the value and clears to null; Prompt consumes on mount into its EXISTING `scopedStories` state (do not invent a parallel selection).
- Panel conventions: `.tsx` tests run from `packages/uxfactory-plugin`; new RTL files need `// @vitest-environment jsdom`, `import "@testing-library/jest-dom/vitest"`, `afterEach(cleanup)`; design tokens (`primary-*`, `warn-*`, `success-*`, grays) over raw palette; Zustand selector discipline; 16 pre-existing plugin typecheck errors (no new). Pre-existing failures not to touch: spec typecheck story-schema.test.ts:184; CLI 3 fixture errors.
- `ui/components/TraceView.tsx` must be DELETED by the end (Task 4), with zero remaining imports.

---

### Task 1: Bridge — `filePath` on the trace wire + changeset

**Files:**
- Modify: `packages/uxfactory-bridge/src/project.ts` (`TraceStory` interface; `readTraceStories`; the trace join that builds story rows)
- Modify: `packages/uxfactory-plugin/ui/lib/bridge.ts` (panel `TraceStory` type)
- Create: `.changeset/bridge-trace-filepath.md`
- Test: extend the bridge test file that covers `/project/trace` (locate via `grep -rln "project/trace" packages/uxfactory-bridge/test/`; if none exists, create `packages/uxfactory-bridge/test/trace-filepath.test.ts` with the standard tmp-launchRoot harness used by `on-root-served.test.ts`)

**Interfaces:**
- Produces (used by Tasks 2–3): `TraceStory.filePath: string` — repo-relative path of the story's source file (set member `.uxfactory/artifacts/stories/<m>.json`, or the legacy stories file for single-file projects).

- [ ] **Step 1: Write the failing test** — harness: tmp launch root with `.git/`, write `.uxfactory/artifacts/stories/S-01.json` containing a minimal canonical story (copy a valid story fixture from the existing stories tests — `grep -rln "storyId" packages/uxfactory-bridge/test/ packages/uxfactory-cli/test/` to find one; it must parse via `parseStoryFile`), plus `.uxfactory/artifacts/features.json` referencing `S-01`. Then:

```ts
  it("trace stories carry the repo-relative member filePath", async () => {
    const res = await app.inject({ method: "GET", url: "/project/trace" });
    const body = res.json() as { features: Array<{ stories: Array<{ storyId: string; filePath: string }> }>; unassigned: Array<{ storyId: string; filePath: string }> };
    const all = [...body.features.flatMap((f) => f.stories), ...body.unassigned];
    const s1 = all.find((s) => s.storyId === "S-01");
    expect(s1?.filePath).toBe(".uxfactory/artifacts/stories/S-01.json");
  });
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run <that test file>` → FAIL (`filePath` undefined).

- [ ] **Step 3: Implement.** In `readTraceStories(storiesPath)` (project.ts ~line 656): the set-mode loop already has `member` and `storiesPath` — carry `absPath: path.join(storiesPath, m)` per parsed story; the legacy single-file branch carries `absPath: storiesPath` for every story. Thread it through the function's return objects. In the trace join where `toTraceStory` builds the wire row (it has `root` in scope — verify; if not, pass it in), set `filePath: path.relative(root, absPath)`. Add `filePath: string;` to the `TraceStory` interface in project.ts AND to the panel's `TraceStory` in `ui/lib/bridge.ts`.

- [ ] **Step 4: Changeset** `.changeset/bridge-trace-filepath.md`:

```md
---
"@uxfactory/bridge": minor
---

Trace stories carry `filePath` — the repo-relative source file of each story
(set member or legacy file) — so the panel's Requirements tab can open a
story in the editor.
```

- [ ] **Step 5: Run + typecheck + commit**

`pnpm vitest run <test file> && pnpm --filter @uxfactory/bridge typecheck` → PASS/clean.

```bash
git add packages/uxfactory-bridge/src/project.ts packages/uxfactory-plugin/ui/lib/bridge.ts packages/uxfactory-bridge/test/ .changeset/bridge-trace-filepath.md
git commit -m "feat(bridge): trace stories carry their source filePath"
```

---

### Task 2: Panel — tab, route, and the Requirements screen (read/navigate core)

**Files:**
- Modify: `packages/uxfactory-plugin/ui/stores/app.ts` (`Tab` union gains `"requirements"`)
- Modify: `packages/uxfactory-plugin/ui/router.tsx` (`TAB_DEFS` second entry `{ value: "requirements", label: "Requirements" }`; new `requirementsRoute` following the `promptRoute` pattern (`getParentRoute: () => tabsRoute`, path `requirements`, component renders `<Requirements bridge={bridge} bus={bus} />` from the route context); register in the route tree beside the other tab routes)
- Create: `packages/uxfactory-plugin/ui/screens/Requirements.tsx`
- Test: `packages/uxfactory-plugin/test/screen-requirements.test.tsx` (new); update `test/routing.test.tsx` for the six-tab order

**Interfaces:**
- Consumes: `traceQuery(bridge)` (existing), `TraceFeature`/`TraceStory` (now with `filePath`), `Tabs` chrome.
- Produces (Task 3 attaches actions): the screen with stable hooks for actions — story rows render `data-story-id`, and the component accepts `bridge` and `bus` props from the route (bus unused until Task 3; wire it now so Task 3 is additive).

- [ ] **Step 1: Write the failing tests** (`screen-requirements.test.tsx`; jsdom pragma + jest-dom + cleanup; `makeBridge` fixture copied from `screen-artifacts.test.tsx:270` with `trace` overridden). Fixture trace: 2 features — F-1 "Onboard" with S-01 (covered: `coveredBy: [{page:"p",view:"v"}]`; 2 ACs: AC-1 verified via `linkedNodes: [{nodeId:"1:2",unitName:"Hero",unitType:"organism",acId:"AC-1"}]`, AC-2 unverified) and S-02 (uncovered, 1 unverified AC); F-2 "Billing" with zero stories; 1 unassigned story S-09 (uncovered). Assert:

```ts
  it("renders the rollup with attention chips", async () => {
    // 2 features · 3 stories · 3 ACs; 2 uncovered stories; 2 unverified ACs
    await renderRequirements();
    expect(await screen.findByText(/2 features/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 uncovered stories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 unverified ACs" })).toBeInTheDocument();
  });

  it("uncovered filter narrows the tree to uncovered stories", async () => {
    await renderRequirements();
    fireEvent.click(screen.getByRole("button", { name: "2 uncovered stories" }));
    expect(screen.queryByText(/S-01/)).toBeNull();
    expect(screen.getByText(/S-02/)).toBeInTheDocument();
    expect(screen.getByText(/S-09/)).toBeInTheDocument();
  });

  it("search matches AC statements and composes with filters (AND)", async () => {
    await renderRequirements();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search requirements" }), {
      target: { value: "AC-2 statement text" },
    });
    expect(screen.getByText(/S-01/)).toBeInTheDocument(); // its AC matches
    expect(screen.queryByText(/S-02/)).toBeNull();
  });

  it("empty trace renders the seed hint linking to Artifacts", async () => {
    await renderRequirements({ features: [], unassigned: [] });
    expect(screen.getByText(/seed Features and Stories/i)).toBeInTheDocument();
  });
```

`routing.test.tsx`: update the tab-order assertion to `["Generate", "Requirements", "Artifacts", "Components", "Assets", "Checks"]` and add a case that navigating to `/tabs/requirements` renders the screen (mirror how existing tab-route cases work in that file).

- [ ] **Step 2: Run to verify failure** — from `packages/uxfactory-plugin`: `pnpm vitest run test/screen-requirements.test.tsx test/routing.test.tsx` → new tests FAIL (screen missing / 5 tabs).

- [ ] **Step 3: Implement the screen.** `Requirements.tsx` structure (follow existing screens' patterns — `useQuery(traceQuery(bridge))`, Card, tokens):

```tsx
type Filter = "all" | "uncovered" | "unverified";

export function Requirements({ bridge, bus }: { bridge: Bridge; bus: PluginBus }): React.JSX.Element {
  const trace = useQuery(traceQuery(bridge));
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  // rollup: counts + uncovered/unverified per the Global Constraints definitions
  // matching: a story survives if (filter passes for it) AND (q matches feature/story/AC text);
  //   feature name matches keep all its stories; an AC match keeps its story.
  //   A feature renders if it has surviving stories OR (filter==="all" && q==="") (zero-story features visible by default).
  // tree: FeatureRow (dot + name + count + planned chip) → StoryRow (id, actor · want,
  //   coveredBy chips, action slot) → AcRow (id, statement, manual badge, coveredBy chips, linkedNodes chips).
  // Task 3 turns linkedNodes chips into buttons and fills the story action slot —
  //   render them as plain spans + an empty actions <div data-story-actions={storyId}> for now.
}
```

Write the full component with the rollup header (chips are `<button aria-pressed>` toggles that set `filter`), a labeled search input (`role="searchbox"`, `aria-label="Search requirements"`), the three row components (port the JSX/classes from `TraceView.tsx` — dot logic verbatim), and the empty state (`Link` to `/tabs/artifacts` with the text "No requirements yet — seed Features and Stories in the Artifacts tab."). Toggle-open state per feature exactly as TraceView's `open` record. Keep each row component small; colocate in the screen file unless it exceeds ~300 lines, in which case split `ui/components/requirements-tree.tsx`.

- [ ] **Step 4: Wire tab + route** per the Files list (TAB_DEFS second; `requirementsRoute` cloned from `promptRoute`'s shape; add to the `tabsRoute.addChildren([...])` list).

- [ ] **Step 5: Run** — from `packages/uxfactory-plugin`: `pnpm vitest run test/screen-requirements.test.tsx test/routing.test.tsx test/stores.test.ts` → PASS; typecheck parity (16 known errors, no new).

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-plugin/ui packages/uxfactory-plugin/test
git commit -m "feat(panel): Requirements tab — trace tree with rollups, search, coverage filters"
```

---

### Task 3: Panel — actions: canvas jump, Open, Generate handoff

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Requirements.tsx` (actions)
- Modify: `packages/uxfactory-plugin/ui/stores/app.ts` (`pendingStoryRefs` + actions)
- Modify: `packages/uxfactory-plugin/ui/screens/Prompt.tsx` (consume on mount into `scopedStories`)
- Test: extend `test/screen-requirements.test.tsx`; extend `test/stores.test.ts`; extend `test/screen-prompt.test.tsx`

**Interfaces:**
- Consumes: `bus.selectNodes(ids: string[])` (plugin-bus, exists); `bridge.openPath(path)` (exists); `TraceStory.filePath` (Task 1); Prompt's `scopedStories: string[] | null` state (Prompt.tsx ~line 784).
- Produces: store `pendingStoryRefs: string[] | null`, `setPendingStoryRefs(refs: string[]): void`, `consumePendingStoryRefs(): string[] | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// screen-requirements.test.tsx additions
  it("linked-node chip jumps the canvas selection", async () => {
    const selectNodes = vi.fn();
    await renderRequirements(undefined, { bus: { ...fakeBus, selectNodes } });
    fireEvent.click(screen.getByRole("button", { name: /Hero/ }));
    expect(selectNodes).toHaveBeenCalledWith(["1:2"]);
  });

  it("Open calls bridge.openPath with the story's filePath", async () => {
    const openPath = vi.fn().mockResolvedValue({ ok: true });
    await renderRequirements(undefined, { bridge: { openPath } });
    fireEvent.click(screen.getAllByRole("button", { name: "Open story in editor" })[0]!);
    expect(openPath).toHaveBeenCalledWith(".uxfactory/artifacts/stories/S-01.json");
  });

  it("Generate stores pending refs and navigates to the Generate tab", async () => {
    await renderRequirements();
    fireEvent.click(screen.getAllByRole("button", { name: "Generate design for story" })[0]!);
    expect(useAppStore.getState().pendingStoryRefs).toEqual(["S-01"]);
    // navigation assertion per routing test conventions (mock navigate or assert location)
  });

// stores.test.ts additions
  it("pendingStoryRefs: set then consume returns once and clears", () => {
    useAppStore.getState().setPendingStoryRefs(["S-01", "S-02"]);
    expect(useAppStore.getState().consumePendingStoryRefs()).toEqual(["S-01", "S-02"]);
    expect(useAppStore.getState().pendingStoryRefs).toBeNull();
    expect(useAppStore.getState().consumePendingStoryRefs()).toBeNull();
  });

// screen-prompt.test.tsx addition
  it("consumes pendingStoryRefs on mount into the coverage scope", async () => {
    useAppStore.getState().setPendingStoryRefs(["S-01"]);
    await renderPrompt(); // existing helper
    expect(useAppStore.getState().pendingStoryRefs).toBeNull();
    // scope line reflects a narrowed selection (mirror the existing scope-count assertion style,
    // e.g. /1 of \d+ stories/)
  });
```

- [ ] **Step 2: Run to verify failure** — from `packages/uxfactory-plugin`: the three suites → new tests FAIL.

- [ ] **Step 3: Implement.**
  - Store: field + the two actions (consume uses `set`+return; a plain `get`-then-`set` pair is fine).
  - Requirements: story action slot gains two icon-buttons — `aria-label="Open story in editor"` → `void bridge.openPath(story.filePath)` with the Artifacts-tab error pattern (row-level error note on failure); `aria-label="Generate design for story"` → `setPendingStoryRefs([story.storyId]); void navigate({ to: "/tabs/prompt" })`. Linked-node chips become `<button aria-label={
    `Jump to ${n.unitName} on canvas`}>` → `bus.selectNodes([n.nodeId])` (keep the visual chip styling; note the test queries `name: /Hero/` — the accessible name must include the unit name).
  - Prompt: on mount (a `useEffect` with empty deps beside the existing mount effects), `const refs = consumePendingStoryRefs(); if (refs !== null && refs.length > 0) setScopedStories(refs);`.

- [ ] **Step 4: Run** — the three suites + `test/routing.test.tsx` → PASS; typecheck parity.

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin/ui packages/uxfactory-plugin/test
git commit -m "feat(panel): Requirements actions — canvas jump, open story, generate handoff"
```

---

### Task 4: Components slims down; TraceView deleted

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Components.tsx` (remove the TraceView Card at ~lines 269-277 and the `TraceView` import; remove `traceResult`/`traceQuery` ONLY if nothing else in the file reads them — `grep -n "traceResult" ui/screens/Components.tsx` first and keep the query if other consumers exist; add a one-line hint in its place: a subdued row "Trace moved — see the Requirements tab" whose link navigates to `/tabs/requirements`)
- Delete: `packages/uxfactory-plugin/ui/components/TraceView.tsx`
- Test: update `test/screen-components.test.tsx` (trace-tree assertions removed/replaced by the hint) — check the file name via `ls packages/uxfactory-plugin/test | grep -i component`

**Interfaces:** consumes Task 2's route (the hint's target).

- [ ] **Step 1: Failing test** — in the Components screen suite: assert the hint link renders and `screen.queryByText("Trace")` (the old tree heading) is null.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** per Files. Then `grep -rn "TraceView" packages/uxfactory-plugin` must return nothing; delete the file.
- [ ] **Step 4: Run** — Components suite + `pnpm vitest run` for the whole plugin test dir (from the package) → green; typecheck parity.
- [ ] **Step 5: Commit**

```bash
git add -A packages/uxfactory-plugin
git commit -m "refactor(panel): Components drops the trace tree — Requirements owns it"
```

---

### Task 5: Full verification + bundle (controller)

- [ ] `pnpm -r build && pnpm test` → suite green (~1850 tests); `pnpm --filter @uxfactory/bridge typecheck` clean; plugin typecheck parity (16 known).
- [ ] Plugin bundle rebuilt by the build; reload the UX Factory plugin in Figma: six tabs in order, Requirements shows the uxfio-demo trace (features/stories seeded there), filters work, Generate pre-selects the story in the composer.
- [ ] Fix the spec's icon line: in `docs/superpowers/specs/2026-07-10-requirements-tab-design.md` §2, replace "TabNav entry with the lucide `ListChecks` icon, ordered second" with "TabNav entry (label-only — TAB_DEFS carries no icons), ordered second". Commit docs with the verification.

```bash
git add docs/superpowers/specs/2026-07-10-requirements-tab-design.md
git commit -m "docs: requirements-tab spec — TabNav is label-only"
```

---

## Self-review notes (kept for the implementer)

- **Spec coverage:** §1 wire field (T1), §2 tab/route (T2), §3 screen (T2 core + T3 actions), §4 handoff (T3), §5 Components (T4), §6 testing (each task) + bundle (T5).
- **Anchors (main @ 181d821):** `TAB_DEFS` router.tsx:586-592 (label-only); `deriveTab` known-list also needs `"requirements"` (it derives from TAB_DEFS values — verify it picks the new entry automatically); tab routes ~router.tsx:779+; Prompt `scopedStories` ~line 784, enqueue use ~line 915; Components trace usage lines 80 + 269-277; `readTraceStories` project.ts ~656; panel `TraceStory` type in ui/lib/bridge.ts.
- **T2/T3 split rationale:** T2 is reviewable as a read-only screen (rollup/filter/search correctness); T3's actions are independently reviewable side-effects. The `data-story-actions` slot in T2 keeps T3 purely additive.
- **Watch:** `renderRequirements` helper should wrap in QueryClientProvider + a router context supplying `bridge`/`bus` — mirror `screen-artifacts.test.tsx`'s `renderWithProviders`; the fixture bridge's `trace` member must exist (the real `Bridge` interface marks `trace?` optional — provide it).
