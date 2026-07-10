// @vitest-environment jsdom
/**
 * screen-requirements.test.tsx — RTL tests for the Requirements tab: the
 * read/navigate core (rollup, search, coverage filters) AND the per-story
 * actions (canvas jump, open-in-editor, Generate handoff).
 *
 * Fixture (DEFAULT_TRACE) — 2 features · 3 stories · 3 ACs:
 *   F-1 "Onboard": S-01 (covered; AC-1 verified via linkedNodes, AC-2 unverified)
 *                  S-02 (uncovered; AC-3 unverified)
 *   F-2 "Billing": no stories
 *   unassigned:    S-09 (uncovered, no ACs)
 * → 2 uncovered stories (S-02, S-09) · 2 unverified ACs (AC-2, AC-3).
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { Bridge, ProjectSnapshot, TraceResponse } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";
import { Requirements } from "../ui/screens/Requirements.js";
import { useAppStore } from "../ui/stores/app.js";
import { renderWithProviders } from "./test-utils.js";

afterEach(cleanup);

// ─── Fixture trace ─────────────────────────────────────────────────────────

const DEFAULT_TRACE: TraceResponse = {
  features: [
    {
      featureId: "F-1",
      name: "Onboard",
      conformed: true,
      plannedPages: [],
      stories: [
        {
          storyId: "S-01",
          actor: "Visitor",
          want: "get onboarded quickly",
          status: "registered",
          filePath: ".uxfactory/artifacts/stories/S-01.json",
          coveredBy: [{ page: "p", view: "v" }],
          acceptanceCriteria: [
            {
              acId: "AC-1",
              statement: "AC-1 statement text",
              checkable: "auto",
              linkedNodes: [{ nodeId: "1:2", unitName: "Hero", unitType: "organism" }],
              coveredBy: [],
            },
            {
              acId: "AC-2",
              statement: "AC-2 statement text",
              checkable: "auto",
              linkedNodes: [],
              coveredBy: [],
            },
          ],
        },
        {
          storyId: "S-02",
          actor: "Visitor",
          want: "see pricing upfront",
          status: "registered",
          filePath: ".uxfactory/artifacts/stories/S-02.json",
          coveredBy: [],
          acceptanceCriteria: [
            {
              acId: "AC-3",
              statement: "AC-3 statement text",
              checkable: "auto",
              linkedNodes: [],
              coveredBy: [],
            },
          ],
        },
      ],
    },
    {
      featureId: "F-2",
      name: "Billing",
      conformed: null,
      plannedPages: [],
      stories: [],
    },
  ],
  unassigned: [
    {
      storyId: "S-09",
      actor: "Ops",
      want: "reconcile invoices",
      status: "draft",
      filePath: ".uxfactory/artifacts/stories/S-09.json",
      coveredBy: [],
      acceptanceCriteria: [],
    },
  ],
};

// ─── Fakes ──────────────────────────────────────────────────────────────────

const BASE_SNAPSHOT: ProjectSnapshot = {
  name: "Test",
  root: "/repo",
  hasClassification: true,
  hasProfile: true,
  classification: null,
  profile: null,
  artifacts: [],
  requirements: [],
};

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn().mockResolvedValue({ ok: true, snapshot: BASE_SNAPSHOT }),
    snapshot: vi.fn().mockResolvedValue(BASE_SNAPSHOT),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi.fn().mockResolvedValue({
      version: "0.0.0",
      uptimeMs: 0,
      runsRelayed: 0,
      tokenCount: null,
    }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    enqueue: vi.fn().mockResolvedValue({ id: "req-1" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue(null),
    trace: vi.fn().mockResolvedValue(DEFAULT_TRACE),
    ...overrides,
  };
}

function makeBus(overrides: Partial<PluginBus> = {}): PluginBus {
  return {
    storageGet: vi.fn().mockResolvedValue(undefined),
    storageSet: vi.fn().mockResolvedValue(undefined),
    fileInfo: vi.fn().mockResolvedValue({ name: "Test", fileKey: "fk" }),
    insertIcon: vi.fn().mockResolvedValue("node-1"),
    notify: vi.fn(),
    close: vi.fn(),
    onSelection: vi.fn().mockReturnValue(() => {}),
    selectNodes: vi.fn(),
    postReview: vi.fn(),
    ...overrides,
  };
}

interface RenderSeams {
  bridge?: Partial<Bridge>;
  bus?: Partial<PluginBus>;
}

async function renderRequirements(traceOverride?: Partial<TraceResponse>, seams?: RenderSeams) {
  const bridge = makeBridge({
    trace: vi.fn().mockResolvedValue({ ...DEFAULT_TRACE, ...traceOverride }),
    ...seams?.bridge,
  });
  return renderWithProviders(<Requirements bridge={bridge} bus={makeBus(seams?.bus)} />, {
    initialEntries: ["/tabs/requirements"],
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Requirements — rollup, search, coverage filters", () => {
  it("renders the rollup with attention chips", async () => {
    await renderRequirements();

    expect(await screen.findByText(/2 features/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 uncovered stories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 unverified ACs" })).toBeInTheDocument();
  });

  it("uncovered filter narrows the tree to uncovered stories", async () => {
    await renderRequirements();
    await screen.findByText(/2 features/);

    fireEvent.click(screen.getByRole("button", { name: "2 uncovered stories" }));

    expect(screen.queryByText(/S-01/)).toBeNull();
    expect(screen.getByText(/S-02/)).toBeInTheDocument();
    expect(screen.getByText(/S-09/)).toBeInTheDocument();
  });

  it("search matches AC statements and composes with filters (AND)", async () => {
    await renderRequirements();
    await screen.findByText(/2 features/);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search requirements" }), {
      target: { value: "AC-2 statement text" },
    });

    expect(screen.getByText(/S-01/)).toBeInTheDocument(); // its AC matches
    expect(screen.queryByText(/S-02/)).toBeNull();
  });

  it("empty trace renders the seed hint linking to Artifacts", async () => {
    await renderRequirements({ features: [], unassigned: [] });

    expect(await screen.findByText(/seed Features and Stories/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Artifacts" })).toHaveAttribute(
      "href",
      "/tabs/artifacts",
    );
  });
});

describe("Requirements — per-story actions (canvas jump, Open, Generate handoff)", () => {
  it("linked-node chip jumps the canvas selection", async () => {
    const selectNodes = vi.fn();
    await renderRequirements(undefined, { bus: { selectNodes } });
    await screen.findByText(/2 features/);

    fireEvent.click(screen.getByRole("button", { name: /Hero/ }));

    expect(selectNodes).toHaveBeenCalledWith(["1:2"]);
  });

  it("Open calls bridge.openPath with the story's filePath", async () => {
    const openPath = vi.fn().mockResolvedValue({ ok: true });
    await renderRequirements(undefined, { bridge: { openPath } });
    await screen.findByText(/2 features/);

    fireEvent.click(screen.getAllByRole("button", { name: "Open story in editor" })[0]!);

    expect(openPath).toHaveBeenCalledWith(".uxfactory/artifacts/stories/S-01.json");
  });

  it("Open shows a row-level error note when bridge.openPath rejects", async () => {
    const openPath = vi.fn().mockRejectedValue(new Error("nope"));
    await renderRequirements(undefined, { bridge: { openPath } });
    await screen.findByText(/2 features/);

    fireEvent.click(screen.getAllByRole("button", { name: "Open story in editor" })[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not open file");
  });

  it("Generate stores the combined pending intent (refs + unit + prompt) and navigates to the Generate tab", async () => {
    const { router } = await renderRequirements();
    await screen.findByText(/2 features/);

    fireEvent.click(screen.getAllByRole("button", { name: "Generate design for story" })[0]!);

    // First rendered story is S-01 — actor "Visitor", want "get onboarded quickly".
    expect(useAppStore.getState().pendingGenerate).toEqual({
      storyRefs: ["S-01"],
      unitType: "story",
      prompt: 'Revise coverage for "S-01" — Visitor: get onboarded quickly',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/tabs/prompt"));
  });

  it("Generate omits the actor prefix when the story has no actor", async () => {
    await renderRequirements({
      unassigned: [{ ...DEFAULT_TRACE.unassigned[0]!, actor: "" }],
    });
    await screen.findByText(/2 features/);

    fireEvent.click(screen.getAllByRole("button", { name: "Generate design for story" }).at(-1)!);

    expect(useAppStore.getState().pendingGenerate).toEqual({
      storyRefs: ["S-09"],
      unitType: "story",
      prompt: 'Revise coverage for "S-09" — reconcile invoices',
    });
  });
});
