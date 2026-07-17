// @vitest-environment jsdom
/**
 * screen-components.test.tsx — RTL tests for the Components screen.
 *
 * Test cases map to PRD §6 acceptance criteria:
 *   AC-1  Selection card updates from a fake bus selection event (incl. stylesInUse).
 *   AC-2  Link creates + persists via putLinks body assert + rollup updates.
 *   AC-3  Unlink removes from putLinks body.
 *   AC-4  Duplicate-pair is disabled (Link button disabled).
 *   AC-5  Zero-AC callout renders and "Artifacts →" navigates to /tabs/artifacts.
 *   AC-6  SKIP — missing-node row flag deferred (requires canvas lookup API).
 *   AC-7  Check CTA enqueues with linked ids, navigates to /tabs/checks?run=.
 *   AC-8  AC id click opens requirements path via bridge.openPath.
 *   AC-9  Unit-type change persists on linked rows (putLinks body updated).
 *
 * Fake bus and bridge are always injected — no module-level mocks.
 * The real useAppStore is reset before each test (setState pattern).
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type { Bridge, BridgeEvent, Link, ProjectSnapshot } from "../ui/lib/bridge.js";
import { BridgeError } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";
import { Components } from "../ui/screens/Components.js";
import { useAppStore } from "../ui/stores/app.js";
import { makeQueryClient, queryKeys } from "../ui/queries.js";
import { renderWithProviders } from "./test-utils.js";

// ─── Fake bus ─────────────────────────────────────────────────────────────────

type SelectionCb = (sel: unknown) => void;
type IdentityExtractionCb = (payload: unknown) => void;
type IdentityCropsCb = (payload: unknown) => void;

interface FakeBus extends PluginBus {
  _fireSelection(sel: unknown): void;
  _fireIdentityExtraction(payload: unknown): void;
  _fireIdentityCrops(payload: unknown): void;
}

function makeBus(): FakeBus {
  let selectionCbs: SelectionCb[] = [];
  let identityExtractionCbs: IdentityExtractionCb[] = [];
  let identityCropsCbs: IdentityCropsCb[] = [];
  return {
    storageGet: vi.fn().mockResolvedValue(undefined),
    storageSet: vi.fn().mockResolvedValue(undefined),
    fileInfo: vi.fn().mockResolvedValue({ name: "Test", fileKey: "fk" }),
    insertIcon: vi.fn().mockResolvedValue("node-1"),
    notify: vi.fn(),
    close: vi.fn(),
    onSelection(cb: SelectionCb) {
      selectionCbs.push(cb);
      return () => {
        selectionCbs = selectionCbs.filter((c) => c !== cb);
      };
    },
    selectNodes: vi.fn(),
    postReview: vi.fn(),
    requestIdentityScan: vi.fn(),
    onIdentityExtraction(cb: IdentityExtractionCb) {
      identityExtractionCbs.push(cb);
      return () => {
        identityExtractionCbs = identityExtractionCbs.filter((c) => c !== cb);
      };
    },
    requestIdentityCrops: vi.fn(),
    onIdentityCrops(cb: IdentityCropsCb) {
      identityCropsCbs.push(cb);
      return () => {
        identityCropsCbs = identityCropsCbs.filter((c) => c !== cb);
      };
    },
    _fireSelection(sel: unknown) {
      for (const cb of selectionCbs) cb(sel);
    },
    _fireIdentityExtraction(payload: unknown) {
      for (const cb of identityExtractionCbs) cb(payload);
    },
    _fireIdentityCrops(payload: unknown) {
      for (const cb of identityCropsCbs) cb(payload);
    },
  };
}

// ─── Fake bridge ──────────────────────────────────────────────────────────────

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn(),
    snapshot: vi.fn().mockResolvedValue({}),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi.fn(),
    logs: vi.fn(),
    enqueue: vi.fn().mockResolvedValue({ id: "run-abc" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn(),
    verify: vi.fn(),
    ...overrides,
  } as unknown as Bridge;
}

// ─── Snapshot factory ──────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    name: "Test Project",
    root: "/home/user/test",
    hasClassification: true,
    hasProfile: true,
    classification: null,
    profile: null,
    artifacts: [
      {
        key: "stories",
        group: "product" as const,
        label: "Stories",
        status: "up-to-date" as const,
        meta: "",
        path: "/docs/requirements.md",
      },
    ],
    requirements: [
      { id: "AC-101", title: "Payment declined error" },
      { id: "AC-102", title: "Loading state" },
    ],
    ...overrides,
  };
}

// ─── Store reset ───────────────────────────────────────────────────────────────

const BASE_APP_STATE = {
  connection: {
    status: "connected" as const,
    endpoint: "http://localhost:3779",
    repoPath: "/home/user/test",
    mode: "local" as const,
  },
  fileInfo: null,
  snapshot: makeSnapshot(),
  toasts: [],
};

function resetStores(snapshotOverride?: Partial<ProjectSnapshot>): void {
  useAppStore.setState({
    ...BASE_APP_STATE,
    snapshot:
      snapshotOverride !== undefined
        ? makeSnapshot(snapshotOverride)
        : makeSnapshot(),
  });
}

beforeEach(() => {
  resetStores();
});
afterEach(cleanup);

// ─── Helper: fake selection payload ───────────────────────────────────────────

function makeSelectionPayload(opts: {
  id?: string;
  name?: string;
  stylesInUse?: number;
} = {}) {
  return {
    page: "Page 1",
    fileName: "Test File",
    fileKey: "fk-123",
    nodes: [
      {
        id: opts.id ?? "12:308",
        name: opts.name ?? "Checkout / Error State",
        type: "FRAME",
        x: 0,
        y: 0,
        w: 375,
        h: 812,
      },
    ],
    stylesInUse: opts.stylesInUse ?? 5,
  };
}

// ─── AC-1: Selection card updates from bus selection ──────────────────────────

describe("AC-1: Selection card", () => {
  it("updates from a fake selection event including stylesInUse count", async () => {
    const bus = makeBus();
    const bridge = makeBridge();

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });

    // Wait for mount effects (getLinks) to settle.
    await waitFor(() => {
      expect(bridge.getLinks).toHaveBeenCalled();
    });

    // Empty state before selection.
    expect(
      screen.getByText("Select a frame on the canvas to link it"),
    ).toBeInTheDocument();

    // Fire selection from bus.
    act(() => {
      bus._fireSelection(makeSelectionPayload({ stylesInUse: 47 }));
    });

    // Node id (unique mono text) confirms selection card rendered.
    await waitFor(() => {
      expect(screen.getByText("12:308")).toBeInTheDocument();
    });

    // stylesInUse rendered.
    expect(screen.getByText("47 styles in use")).toBeInTheDocument();

    // Sync badge always "not mapped" in v1.
    expect(screen.getByText("not mapped")).toBeInTheDocument();

    // Unit-type select present.
    expect(screen.getByRole("combobox", { name: "Unit type" })).toBeInTheDocument();
  });
});

// ─── AC-2: Link creates + persists ────────────────────────────────────────────

describe("AC-2: Link creation", () => {
  it("creates a link, calls putLinks with correct body, and updates rollup", async () => {
    const bus = makeBus();
    const bridge = makeBridge();
    const user = userEvent.setup();

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    // Fire selection — wait for unique node id text (not unit name, which may appear in multiple places).
    act(() => {
      bus._fireSelection(
        makeSelectionPayload({ id: "12:308", name: "Checkout / Error State" }),
      );
    });
    await waitFor(() =>
      expect(screen.getByText("12:308")).toBeInTheDocument(),
    );

    // Select requirement.
    const reqSelect = screen.getByRole("combobox", { name: "Requirement to link" });
    await user.selectOptions(reqSelect, "AC-101");

    // Click Link.
    const linkBtn = screen.getByRole("button", { name: "Link unit to requirement" });
    expect(linkBtn).not.toBeDisabled();
    await user.click(linkBtn);

    // putLinks called with the new link.
    await waitFor(() => {
      expect(bridge.putLinks).toHaveBeenCalledWith([
        expect.objectContaining({
          nodeId: "12:308",
          unitName: "Checkout / Error State",
          acId: "AC-101",
          unitType: "Page",
        }),
      ]);
    });

    // Rollup shows "1 of 1 linked".
    await waitFor(() => {
      expect(screen.getByText("1 of 1 linked")).toBeInTheDocument();
    });

    // AC id chip appears in linked row.
    expect(screen.getByText("AC-101")).toBeInTheDocument();
  });
});

// ─── AC-3: Unlink removes from putLinks body ──────────────────────────────────

describe("AC-3: Unlink", () => {
  it("removes a link via hover→Unlink and calls putLinks with reduced body", async () => {
    const existingLink: Link = {
      nodeId: "12:100",
      unitName: "Checkout / Default",
      unitType: "Page",
      acId: "AC-101",
    };
    const bridge = makeBridge({
      getLinks: vi.fn().mockResolvedValue({ links: [existingLink] }),
    });
    const bus = makeBus();
    const user = userEvent.setup();

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });

    // Wait for initial links to load and render.
    await waitFor(() => {
      expect(screen.getByText("Checkout / Default")).toBeInTheDocument();
    });

    // Hover the row to reveal Unlink button (use fireEvent.mouseEnter; user.hover
    // does not reliably trigger onMouseEnter in jsdom with synthetic events).
    const unitNameBtn = screen.getByTitle("Node: 12:100");
    const row = unitNameBtn.closest("div")!;
    act(() => {
      fireEvent.mouseEnter(row);
    });

    const unlinkBtn = await screen.findByRole("button", {
      name: /unlink checkout \/ default from AC-101/i,
    });
    await user.click(unlinkBtn);

    // putLinks called with empty array (link removed).
    await waitFor(() => {
      expect(bridge.putLinks).toHaveBeenCalledWith([]);
    });

    // Row no longer displayed.
    await waitFor(() => {
      expect(screen.queryByText("Checkout / Default")).not.toBeInTheDocument();
    });
  });
});

// ─── AC-4: Duplicate-pair disabled ────────────────────────────────────────────

describe("AC-4: Duplicate pair", () => {
  it("disables Link button when the nodeId+acId pair already exists", async () => {
    const existingLink: Link = {
      nodeId: "12:308",
      unitName: "Checkout / Error State",
      unitType: "Page",
      acId: "AC-101",
    };
    const bridge = makeBridge({
      getLinks: vi.fn().mockResolvedValue({ links: [existingLink] }),
    });
    const bus = makeBus();
    const user = userEvent.setup();

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    // Fire selection matching the existing link's nodeId.
    act(() => {
      bus._fireSelection(
        makeSelectionPayload({ id: "12:308", name: "Checkout / Error State" }),
      );
    });
    // Wait for node id (unique text) to confirm selection card is showing.
    await waitFor(() =>
      expect(screen.getByText("12:308")).toBeInTheDocument(),
    );

    // Select the same AC already linked.
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Requirement to link" }),
      "AC-101",
    );

    // Link button must be disabled (duplicate pair).
    const linkBtn = screen.getByRole("button", { name: "Link unit to requirement" });
    expect(linkBtn).toBeDisabled();
  });
});

// ─── AC-5: Zero-AC callout ────────────────────────────────────────────────────

describe("AC-5: Zero-AC callout", () => {
  it("renders callout and navigates to /tabs/artifacts on click when no requirements exist", async () => {
    resetStores({ requirements: [] });
    const bridge = makeBridge();
    const bus = makeBus();
    const user = userEvent.setup();

    const { router } = await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    // Callout is visible.
    expect(
      screen.getByText(/no requirements yet/i),
    ).toBeInTheDocument();

    // Click "Artifacts →" link inside callout.
    const artifactsBtn = screen.getByRole("button", { name: /Artifacts →/i });
    await user.click(artifactsBtn);

    // Router navigates to /tabs/artifacts.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tabs/artifacts");
    });
  });
});

// ─── AC-6: Missing-node row — SKIP ────────────────────────────────────────────

describe("AC-6: Missing-node row (SKIP)", () => {
  it.skip(
    "flags a linked row as 'missing on canvas' when the node is not on canvas — deferred (requires canvas lookup API)",
    () => {
      // Deferred to a future task that adds bus.getNodeById() or equivalent.
    },
  );
});

// ─── AC-7: Check my design CTA ────────────────────────────────────────────────

describe("AC-7: Check my design", () => {
  it("enqueues check-design with linked nodeIds and navigates to /tabs/checks?run=", async () => {
    const existingLinks: Link[] = [
      { nodeId: "12:100", unitName: "Checkout / Default", unitType: "Page", acId: "AC-101" },
      { nodeId: "12:101", unitName: "Checkout / Loading", unitType: "Template", acId: "AC-102" },
    ];
    const bridge = makeBridge({
      getLinks: vi.fn().mockResolvedValue({ links: existingLinks }),
    });
    const bus = makeBus();
    const user = userEvent.setup();

    const { router } = await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });

    // Wait for links to load.
    await waitFor(() => {
      expect(screen.getByText("Checkout / Default")).toBeInTheDocument();
    });

    const checkBtn = screen.getByRole("button", { name: "Check my design" });
    expect(checkBtn).not.toBeDisabled();
    await user.click(checkBtn);

    // enqueue called with the linked node ids.
    await waitFor(() => {
      expect(bridge.enqueue).toHaveBeenCalledWith({
        kind: "check-design",
        payload: {
          nodeIds: expect.arrayContaining(["12:100", "12:101"]),
        },
      });
    });

    // Router navigates to /tabs/checks with the run id as search param.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tabs/checks");
      expect(router.state.location.search).toEqual({ run: "run-abc" });
    });
  });
});

// ─── AC-8: AC id click opens requirements path ────────────────────────────────

describe("AC-8: AC id click", () => {
  it("calls bridge.openPath with the requirements artifact path on AC id click", async () => {
    const existingLink: Link = {
      nodeId: "12:100",
      unitName: "Checkout / Default",
      unitType: "Page",
      acId: "AC-101",
    };
    const bridge = makeBridge({
      getLinks: vi.fn().mockResolvedValue({ links: [existingLink] }),
    });
    const bus = makeBus();
    const user = userEvent.setup();

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });

    await waitFor(() => {
      expect(screen.getByText("AC-101")).toBeInTheDocument();
    });

    // Click AC id chip.
    await user.click(screen.getByRole("button", { name: "Open AC-101" }));

    await waitFor(() => {
      expect(bridge.openPath).toHaveBeenCalledWith("/docs/requirements.md");
    });
  });
});

// ─── AC-9: Unit-type change persists on linked rows ───────────────────────────

describe("AC-9: Unit-type change persists on linked row", () => {
  it("calls putLinks with updated unitType when type is changed for an already-linked node", async () => {
    const existingLink: Link = {
      nodeId: "12:308",
      unitName: "Checkout / Error State",
      unitType: "Page",
      acId: "AC-101",
    };
    const bridge = makeBridge({
      getLinks: vi.fn().mockResolvedValue({ links: [existingLink] }),
    });
    const bus = makeBus();
    const user = userEvent.setup();

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });

    // Load links + fire selection for the linked node.
    await waitFor(() =>
      expect(screen.getByText("Checkout / Error State")).toBeInTheDocument(),
    );

    act(() => {
      bus._fireSelection(
        makeSelectionPayload({ id: "12:308", name: "Checkout / Error State" }),
      );
    });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Unit type" })).toBeInTheDocument(),
    );

    // Change unit type from "Page" to "Organism".
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Unit type" }),
      "Organism",
    );

    // putLinks should be called with the updated unitType on the existing row.
    await waitFor(() => {
      expect(bridge.putLinks).toHaveBeenCalledWith([
        expect.objectContaining({
          nodeId: "12:308",
          acId: "AC-101",
          unitType: "Organism",
        }),
      ]);
    });
  });
});

// ─── Scan identities (node-identity feature, Task 4) ──────────────────────────

function makeIdentityExtractionPayload(overrides: { truncated?: number } = {}) {
  return {
    extraction: {
      version: 1 as const,
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
      nodes: [
        { durableId: "n-1", figmaNodeId: "1:1", parentDurableId: null, ordinal: 0, kind: "FRAME", width: 375, currentName: "Hero", resolvedModes: {}, mainComponent: null, variantProperties: null, isPageChild: true },
        { durableId: "n-2", figmaNodeId: "1:2", parentDurableId: "n-1", ordinal: 0, kind: "TEXT", width: null, currentName: "Headline", resolvedModes: {}, mainComponent: null, variantProperties: null, isPageChild: false },
      ],
    },
    components: [
      { key: "c1", roleName: "icon", source: "figma-document" as const, matchability: "matchable" as const },
    ],
    truncated: overrides.truncated ?? 0,
  };
}

describe("Scan identities", () => {
  it("requests a scan on click and shows a scanning state", async () => {
    const bus = makeBus();
    const bridge = makeBridge();
    const user = userEvent.setup();

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    const scanBtn = screen.getByRole("button", { name: "Scan identities" });
    await user.click(scanBtn);

    expect(bus.requestIdentityScan).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Scan identities" })).toHaveTextContent("Scanning…");
  });

  it("on reply: PUTs components, POSTs the extraction, and renders the one-line result plus the assembled count/addresses", async () => {
    const bus = makeBus();
    const putIdentityComponents = vi.fn().mockResolvedValue({ ok: true });
    const postIdentityExtraction = vi
      .fn()
      .mockResolvedValue({ ok: true, count: 2, addresses: ["hero@mobile", "hero/headline@mobile"] });
    const bridge = makeBridge({ putIdentityComponents, postIdentityExtraction });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    const payload = makeIdentityExtractionPayload();
    act(() => {
      bus._fireIdentityExtraction(payload);
    });

    await waitFor(() => {
      expect(putIdentityComponents).toHaveBeenCalledWith(payload.components);
    });
    expect(postIdentityExtraction).toHaveBeenCalledWith(payload.extraction);

    expect(
      screen.getByText("2 nodes scanned, 1 components harvested"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText("2 node identities assembled (e.g. hero@mobile, hero/headline@mobile)"),
      ).toBeInTheDocument();
    });

    // Button returns to its idle label once the reply lands.
    expect(screen.getByRole("button", { name: "Scan identities" })).toHaveTextContent("Scan identities");
  });

  it("invalidates the identity manifest query after a successful extraction POST (Task 11)", async () => {
    const bus = makeBus();
    const getIdentityManifest = vi.fn().mockResolvedValue({
      manifest: { version: 1, records: {} },
    });
    const bridge = makeBridge({
      putIdentityComponents: vi.fn().mockResolvedValue({ ok: true }),
      postIdentityExtraction: vi
        .fn()
        .mockResolvedValue({ ok: true, count: 2, addresses: ["hero@mobile"] }),
      getIdentityManifest,
    });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(getIdentityManifest).toHaveBeenCalled());
    const callsBeforeExtraction = getIdentityManifest.mock.calls.length;

    act(() => {
      bus._fireIdentityExtraction(makeIdentityExtractionPayload());
    });

    await waitFor(() => {
      expect(getIdentityManifest.mock.calls.length).toBeGreaterThan(callsBeforeExtraction);
    });
  });

  it("tolerates a 404 from postIdentityExtraction (older bridge build without this route) — toasts, never crashes", async () => {
    const bus = makeBus();
    const postIdentityExtraction = vi
      .fn()
      .mockRejectedValue(new BridgeError(404, { error: "not found" }));
    const bridge = makeBridge({
      putIdentityComponents: vi.fn().mockResolvedValue({ ok: true }),
      postIdentityExtraction,
    });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    const payload = makeIdentityExtractionPayload();
    act(() => {
      bus._fireIdentityExtraction(payload);
    });

    await waitFor(() => {
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes("Bridge not ready for identity extraction yet")),
      ).toBe(true);
    });

    // The scan result still rendered — a 404 on the extraction POST doesn't
    // blank out what the scan itself found.
    expect(
      screen.getByText("2 nodes scanned, 1 components harvested"),
    ).toBeInTheDocument();
  });

  it("does not crash when the bridge lacks putIdentityComponents/postIdentityExtraction (legacy fixture)", async () => {
    const bus = makeBus();
    const bridge = makeBridge(); // no identity methods at all

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    act(() => {
      bus._fireIdentityExtraction(makeIdentityExtractionPayload());
    });

    await waitFor(() => {
      expect(
        screen.getByText("2 nodes scanned, 1 components harvested"),
      ).toBeInTheDocument();
    });
  });

  // Post-review fix (must-fix #4): the extraction route reads
  // component-registry.json off disk, so firing the PUT and the extraction
  // POST concurrently could race the POST against a PUT that hasn't
  // committed yet, matching against a stale/empty registry. This proves the
  // POST is genuinely BLOCKED on the PUT settling, not merely observed after
  // it by coincidence — the PUT is held pending on a manually-controlled
  // promise, and the POST is asserted not-yet-called across several
  // microtask turns before the PUT is released.
  it("must-fix #4: does not POST the extraction until the components PUT resolves", async () => {
    const bus = makeBus();
    let resolvePut: (() => void) | undefined;
    const putIdentityComponents = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolvePut = () => resolve({ ok: true });
        }),
    );
    const postIdentityExtraction = vi
      .fn()
      .mockResolvedValue({ ok: true, count: 2, addresses: ["hero@mobile"] });
    const bridge = makeBridge({ putIdentityComponents, postIdentityExtraction });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    const payload = makeIdentityExtractionPayload();
    act(() => {
      bus._fireIdentityExtraction(payload);
    });

    await waitFor(() => expect(putIdentityComponents).toHaveBeenCalledWith(payload.components));

    // Give the microtask queue several turns — if the POST were still firing
    // concurrently (the bug), it would have run by now.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(postIdentityExtraction).not.toHaveBeenCalled();

    // Only once the PUT resolves does the POST fire.
    await act(async () => {
      resolvePut?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(postIdentityExtraction).toHaveBeenCalledWith(payload.extraction));
  });
});

// ─── Root-tier identity crops (Task 9) ─────────────────────────────────────

describe("Identity crops (Task 9)", () => {
  it("requests crops only AFTER a successful extraction POST", async () => {
    const bus = makeBus();
    const postIdentityExtraction = vi
      .fn()
      .mockResolvedValue({ ok: true, count: 2, addresses: ["hero@mobile"] });
    const bridge = makeBridge({
      putIdentityComponents: vi.fn().mockResolvedValue({ ok: true }),
      postIdentityExtraction,
    });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    act(() => {
      bus._fireIdentityExtraction(makeIdentityExtractionPayload());
    });

    await waitFor(() => {
      expect(bus.requestIdentityCrops).toHaveBeenCalledTimes(1);
    });
  });

  it("does NOT request crops when the extraction POST fails", async () => {
    const bus = makeBus();
    const postIdentityExtraction = vi
      .fn()
      .mockRejectedValue(new BridgeError(404, { error: "not found" }));
    const bridge = makeBridge({
      putIdentityComponents: vi.fn().mockResolvedValue({ ok: true }),
      postIdentityExtraction,
    });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    act(() => {
      bus._fireIdentityExtraction(makeIdentityExtractionPayload());
    });

    await waitFor(() => {
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes("Bridge not ready for identity extraction yet")),
      ).toBe(true);
    });
    expect(bus.requestIdentityCrops).not.toHaveBeenCalled();
  });

  it("on identity-crops reply: base64-encodes each crop's bytes and POSTs them to the bridge", async () => {
    const bus = makeBus();
    const postIdentityCrops = vi.fn().mockResolvedValue({ ok: true, written: 2 });
    const bridge = makeBridge({ postIdentityCrops });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    const cropsPayload = {
      crops: [
        { durableId: "n-hero123456", figmaNodeId: "1:1", bytes: new Uint8Array([137, 80, 78, 71]) },
        { durableId: "n-footer12345", figmaNodeId: "1:2", bytes: new Uint8Array([1, 2, 3]) },
      ],
    };
    act(() => {
      bus._fireIdentityCrops(cropsPayload);
    });

    await waitFor(() => {
      expect(postIdentityCrops).toHaveBeenCalledTimes(1);
    });
    const [sent] = postIdentityCrops.mock.calls[0] as [Array<{ durableId: string; base64: string }>];
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      durableId: "n-hero123456",
      base64: Buffer.from([137, 80, 78, 71]).toString("base64"),
    });
    expect(sent[1]).toEqual({
      durableId: "n-footer12345",
      base64: Buffer.from([1, 2, 3]).toString("base64"),
    });
  });

  it("tolerates a 404 from postIdentityCrops (older bridge build without this route) — toasts, never crashes", async () => {
    const bus = makeBus();
    const postIdentityCrops = vi
      .fn()
      .mockRejectedValue(new BridgeError(404, { error: "not found" }));
    const bridge = makeBridge({ postIdentityCrops });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    act(() => {
      bus._fireIdentityCrops({
        crops: [{ durableId: "n-hero123456", figmaNodeId: "1:1", bytes: new Uint8Array([1]) }],
      });
    });

    await waitFor(() => {
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes("Bridge not ready for identity crops yet")),
      ).toBe(true);
    });
  });

  it("does not crash when the bridge lacks postIdentityCrops (legacy fixture)", async () => {
    const bus = makeBus();
    const bridge = makeBridge(); // no postIdentityCrops at all

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    act(() => {
      bus._fireIdentityCrops({
        crops: [{ durableId: "n-hero123456", figmaNodeId: "1:1", bytes: new Uint8Array([1]) }],
      });
    });

    // No crash — nothing else to assert (bridge silently has no crops route).
  });
});

// ─── Interpret identities (Task 11 — Phase 3 vision proposals) ────────────────

/** A node-identity manifest with `count` records — enough to enable Interpret. */
function makeManifest(count: number) {
  const records: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    records[`n-${i}`] = { durableId: `n-${i}`, address: `node-${i}@desktop` };
  }
  return { manifest: { version: 1, records } };
}

/** Bridge whose `events()` capture handler is exposed for manual SSE emission. */
function makeEventfulBridge(overrides: Partial<Bridge> = {}): {
  bridge: Bridge;
  emit: (ev: BridgeEvent) => void;
} {
  let handler: ((ev: BridgeEvent) => void) | null = null;
  const bridge = makeBridge({
    events: vi.fn((cb: (ev: BridgeEvent) => void) => {
      handler = cb;
      return () => {
        handler = null;
      };
    }),
    ...overrides,
  });
  return {
    bridge,
    emit: (ev) => {
      if (handler !== null) handler(ev);
    },
  };
}

describe("Interpret identities (Task 11)", () => {
  it("is disabled when the node-identity manifest has no records", async () => {
    const bus = makeBus();
    const bridge = makeBridge({
      getIdentityManifest: vi.fn().mockResolvedValue(makeManifest(0)),
    });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getIdentityManifest).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Interpret" })).toBeDisabled();
  });

  it("is disabled when the bridge lacks getIdentityManifest (legacy fixture)", async () => {
    const bus = makeBus();
    const bridge = makeBridge(); // no getIdentityManifest at all

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Interpret" })).toBeDisabled();
  });

  it("is enabled once the manifest has records, and clicking enqueues identity-interpret for the active root", async () => {
    const bus = makeBus();
    const user = userEvent.setup();
    const bridge = makeBridge({
      getIdentityManifest: vi.fn().mockResolvedValue(makeManifest(2)),
      getProjectRoot: vi.fn().mockReturnValue("/repo/root"),
      enqueue: vi.fn().mockResolvedValue({ id: "job-1" }),
    });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });

    const interpretBtn = await screen.findByRole("button", { name: "Interpret" });
    await waitFor(() => expect(interpretBtn).not.toBeDisabled());

    await user.click(interpretBtn);

    await waitFor(() => {
      expect(bridge.enqueue).toHaveBeenCalledWith({
        kind: "identity-interpret",
        payload: { root: "/repo/root" },
      });
    });

    // Running state shown while the job is tracked.
    expect(screen.getByRole("button", { name: "Interpret" })).toHaveTextContent(
      "Interpreting…",
    );
  });

  it("invalidates the identity manifest query once the enqueue resolves", async () => {
    const bus = makeBus();
    const user = userEvent.setup();
    const getIdentityManifest = vi.fn().mockResolvedValue(makeManifest(1));
    const bridge = makeBridge({
      getIdentityManifest,
      enqueue: vi.fn().mockResolvedValue({ id: "job-1" }),
    });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });

    const interpretBtn = await screen.findByRole("button", { name: "Interpret" });
    await waitFor(() => expect(interpretBtn).not.toBeDisabled());

    const callsBeforeClick = getIdentityManifest.mock.calls.length;
    await user.click(interpretBtn);

    // The invalidated query refetches — a fresh getIdentityManifest call
    // beyond whatever ran at mount.
    await waitFor(() => {
      expect(getIdentityManifest.mock.calls.length).toBeGreaterThan(callsBeforeClick);
    });
  });

  it("clears the running state, shows an error, and re-invalidates the manifest on an SSE failure frame for the tracked job", async () => {
    const bus = makeBus();
    const user = userEvent.setup();
    const getIdentityManifest = vi.fn().mockResolvedValue(makeManifest(1));
    const { bridge, emit } = makeEventfulBridge({
      getIdentityManifest,
      enqueue: vi.fn().mockResolvedValue({ id: "job-err" }),
    });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });

    const interpretBtn = await screen.findByRole("button", { name: "Interpret" });
    await waitFor(() => expect(interpretBtn).not.toBeDisabled());
    await user.click(interpretBtn);

    await waitFor(() => expect(bridge.events).toHaveBeenCalled());
    const callsBeforeEmit = getIdentityManifest.mock.calls.length;

    act(() => {
      emit({ requestId: "job-err", event: { type: "error" }, seq: 1 });
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Interpretation failed — see worker logs",
      );
    });
    expect(screen.getByRole("button", { name: "Interpret" })).toHaveTextContent("Interpret");
    await waitFor(() => {
      expect(getIdentityManifest.mock.calls.length).toBeGreaterThan(callsBeforeEmit);
    });
  });

  it("does not fire enqueue when disabled (empty manifest) even if clicked", async () => {
    const bus = makeBus();
    const user = userEvent.setup();
    const bridge = makeBridge({
      getIdentityManifest: vi.fn().mockResolvedValue(makeManifest(0)),
      enqueue: vi.fn().mockResolvedValue({ id: "job-1" }),
    });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getIdentityManifest).toHaveBeenCalled());

    const interpretBtn = screen.getByRole("button", { name: "Interpret" });
    await user.click(interpretBtn);

    expect(bridge.enqueue).not.toHaveBeenCalled();
  });

  // ── Completion via GET /pipeline/result/:id (post-review fix) ────────────

  it(
    "polling the pipeline result to a done (status 0) outcome clears the running state and invalidates the manifest query",
    async () => {
      const bus = makeBus();
      const user = userEvent.setup();
      const getIdentityManifest = vi.fn().mockResolvedValue(makeManifest(1));
      const getPipelineResult = vi
        .fn()
        .mockResolvedValueOnce({ state: "pending" })
        .mockResolvedValue({ state: "done", status: 0, result: { applied: 3, skipped: 0 } });
      const bridge = makeBridge({
        getIdentityManifest,
        getPipelineResult,
        enqueue: vi.fn().mockResolvedValue({ id: "job-poll-ok" }),
      });

      await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
        initialEntries: ["/tabs/components"],
      });

      const interpretBtn = await screen.findByRole("button", { name: "Interpret" });
      await waitFor(() => expect(interpretBtn).not.toBeDisabled());

      const callsBeforeClick = getIdentityManifest.mock.calls.length;
      await user.click(interpretBtn);

      // First poll tick (immediate) resolves "pending" — still running.
      await waitFor(() => expect(getPipelineResult).toHaveBeenCalledWith("job-poll-ok"));
      expect(screen.getByRole("button", { name: "Interpret" })).toHaveTextContent(
        "Interpreting…",
      );

      // A later poll tick resolves "done" with a zero exit status — success.
      await waitFor(
        () => {
          expect(getPipelineResult.mock.calls.length).toBeGreaterThan(1);
        },
        { timeout: 6000 },
      );
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Interpret" }),
        ).toHaveTextContent(/^Interpret$/);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(getIdentityManifest.mock.calls.length).toBeGreaterThan(callsBeforeClick);
      });
    },
    8000,
  );

  it(
    "polling the pipeline result to a done outcome with a nonzero exit status shows the error note and invalidates the manifest",
    async () => {
      const bus = makeBus();
      const user = userEvent.setup();
      const getIdentityManifest = vi.fn().mockResolvedValue(makeManifest(1));
      const getPipelineResult = vi
        .fn()
        .mockResolvedValue({ state: "done", status: 2, result: { error: "setup failure" } });
      const bridge = makeBridge({
        getIdentityManifest,
        getPipelineResult,
        enqueue: vi.fn().mockResolvedValue({ id: "job-poll-fail" }),
      });

      await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
        initialEntries: ["/tabs/components"],
      });

      const interpretBtn = await screen.findByRole("button", { name: "Interpret" });
      await waitFor(() => expect(interpretBtn).not.toBeDisabled());

      const callsBeforeClick = getIdentityManifest.mock.calls.length;
      await user.click(interpretBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Interpretation failed — see worker logs",
        );
      });
      expect(
        screen.getByRole("button", { name: "Interpret" }),
      ).toHaveTextContent(/^Interpret$/);
      await waitFor(() => {
        expect(getIdentityManifest.mock.calls.length).toBeGreaterThan(callsBeforeClick);
      });
    },
    8000,
  );

  it("the 5-minute timeout backstop clears the running state and invalidates the manifest when nothing ever reports back", async () => {
    const bus = makeBus();
    const getIdentityManifest = vi.fn().mockResolvedValue(makeManifest(1));
    const bridge = makeBridge({
      getIdentityManifest,
      enqueue: vi.fn().mockResolvedValue({ id: "job-timeout" }),
      // No getPipelineResult — the poll effect never starts (mirrors a
      // legacy bridge build); only the timeout backstop can clear this run.
    });

    // Pre-seed the QueryClient with a non-empty manifest so the button is
    // enabled synchronously on first render — needed below since, once fake
    // timers are active, RTL's waitFor/findBy* (which poll via a real
    // setInterval) would never re-check and hang forever.
    const queryClient = makeQueryClient();
    queryClient.setQueryData(queryKeys.identityManifest(null), makeManifest(1));
    queryClient.setQueryData(queryKeys.links(null), { links: [] });

    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
      queryClient,
    });

    // Still real timers here — confirm the button is enabled before switching.
    const interpretBtn = screen.getByRole("button", { name: "Interpret" });
    expect(interpretBtn).not.toBeDisabled();

    vi.useFakeTimers();
    try {
      // fireEvent (not userEvent) + plain getByRole (not waitFor/findBy*) for
      // the remainder — RTL's async queries poll via a real setInterval that
      // fake timers freeze, so only synchronous assertions are safe here.
      fireEvent.click(interpretBtn);
      await act(async () => {}); // flush enqueue resolution (microtasks still run under fake timers)

      expect(screen.getByRole("button", { name: "Interpret" })).toHaveTextContent(
        "Interpreting…",
      );

      const callsBeforeTimeout = getIdentityManifest.mock.calls.length;

      // Just before the 5-minute mark: still running.
      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000 - 1000);
      });
      expect(screen.getByRole("button", { name: "Interpret" })).toHaveTextContent(
        "Interpreting…",
      );

      // Cross the 5-minute mark → running clears, manifest re-invalidated.
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(
        screen.getByRole("button", { name: "Interpret" }),
      ).toHaveTextContent(/^Interpret$/);
      expect(getIdentityManifest.mock.calls.length).toBeGreaterThan(callsBeforeTimeout);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Trace hint — trace tree moved to the Requirements tab ────────────────────

describe("Trace hint (moved to Requirements)", () => {
  it("renders a subdued hint linking to the Requirements tab, and no trace tree", async () => {
    resetStores();
    const bridge = makeBridge();
    const bus = makeBus();

    const { router } = await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await waitFor(() => expect(bridge.getLinks).toHaveBeenCalled());

    // The old trace-tree heading ("Trace") must be gone.
    expect(screen.queryByText("Trace")).not.toBeInTheDocument();

    // The hint renders and links to the Requirements tab.
    const hintLink = screen.getByRole("button", {
      name: /Trace moved.*Requirements tab/i,
    });
    expect(hintLink).toBeInTheDocument();

    await userEvent.setup().click(hintLink);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tabs/requirements");
    });
  });
});
