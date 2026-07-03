// @vitest-environment jsdom
/**
 * screen-checks.test.tsx — RTL tests for the Checks screen.
 *
 * Test names map 1-to-1 with PRD §7 acceptance criteria (AC-1 … AC-7).
 *
 * Most tests drive `ChecksView` directly with fixture TierModels (the
 * presentational seam described in spec §5 Checks + Checks.tsx). The AC-2
 * annotation test drives the `Checks` container to verify the actual
 * postMessage call.
 *
 * Selector discipline: stores are reset to primitives before each test.
 * Bus and bridge are always injected as fakes.
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type { Bridge } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";
import { toTierModel } from "../ui/lib/tiers.js";
import type { TierModel } from "../ui/lib/tiers.js";
import { ChecksView } from "../ui/screens/Checks.js";
import type { ChecksViewProps, HistoryEntry } from "../ui/screens/Checks.js";
import { Checks } from "../ui/screens/Checks.js";
import { useAppStore } from "../ui/stores/app.js";
import { useRunsStore } from "../ui/stores/runs.js";
import { renderWithProviders } from "./test-utils.js";

// ─── Store reset ─────────────────────────────────────────────────────────────

const BASE_APP_STATE = {
  connection: {
    status: "connected" as const,
    endpoint: "http://localhost:3779",
    repoPath: "/home/user/meridian",
    mode: "local" as const,
  },
  fileInfo: { name: "Meridian Health", fileKey: "file-abc" },
  snapshot: {
    name: "Meridian Health",
    root: "/home/user/meridian",
    hasClassification: true,
    hasProfile: true,
    classification: null,
    profile: null,
    artifacts: [],
    requirements: [],
  },
  route: { screen: "tabs" as const, tab: "checks" as const },
  toasts: [],
};

function resetStores(): void {
  useAppStore.setState(BASE_APP_STATE);
  useRunsStore.setState({
    runs: [],
    composerUnitType: "page",
    composerPlatforms: [],
  });
}

beforeEach(resetStores);
afterEach(cleanup);

// ─── Fixture TierModels ───────────────────────────────────────────────────────

/** Model with T2 (integrity) failing — one token finding. */
const FAILING_MODEL: TierModel = toTierModel({
  batchReport: {
    checks: [
      { id: "render-coverage", status: "pass", severity: "must", findings: [] },
      { id: "a11y", status: "pass", severity: "must", findings: [] },
      { id: "contrast", status: "pass", severity: "must", findings: [] },
      {
        id: "token-conformance",
        status: "fail",
        severity: "must",
        findings: [
          {
            detail:
              'Fill #E24C4C is not a resolved token — nearest: semantic/danger-500',
            ref: "#E24C4C",
          },
        ],
      },
    ],
  },
});

/** Model with T2 having 3 integrity failures (contrast + a11y + token). */
const FAILING_MODEL_3: TierModel = toTierModel({
  batchReport: {
    checks: [
      { id: "render-coverage", status: "pass", severity: "must", findings: [] },
      {
        id: "a11y",
        status: "fail",
        severity: "must",
        findings: [
          {
            detail: "page › view: Touch targets (target-size)",
            ref: ".dismiss-btn",
          },
        ],
      },
      {
        id: "contrast",
        status: "fail",
        severity: "must",
        findings: [
          {
            detail: 'page › view: "Retry payment" label insufficient color contrast',
            ref: ".retry-label",
          },
        ],
      },
      {
        id: "token-conformance",
        status: "fail",
        severity: "must",
        findings: [
          {
            detail: "page: painted color #E24C4C at .icon is not a registered token",
            ref: "#E24C4C",
          },
        ],
      },
    ],
  },
});

/** Fully clean model — all tiers pass including VLM. */
const CLEAN_MODEL: TierModel = toTierModel({
  batchReport: {
    checks: [
      { id: "render-coverage", status: "pass", severity: "must", findings: [] },
      { id: "a11y", status: "pass", severity: "must", findings: [] },
      { id: "contrast", status: "pass", severity: "must", findings: [] },
      { id: "token-conformance", status: "pass", severity: "must", findings: [] },
    ],
  },
  verifyResult: {
    status: "PASS",
    checks: [{ id: "geometry", status: "PASS" }],
    failures: [],
    summary: { checks: 1, passed: 1, failed: 0, skipped: 0 },
  },
  craftReport: {
    version: 1,
    overall: 4,
    pass: true,
    reliability: "best-effort",
    dimensions: [
      { name: "hierarchy", score: 4, findings: [] },
      { name: "typography", score: 4, findings: [] },
      { name: "spacing", score: 4, findings: [] },
      { name: "color", score: 4, findings: [] },
      { name: "components", score: 4, findings: [] },
      { name: "depth", score: 4, findings: [] },
      { name: "brand-fit", score: 4, findings: [] },
      { name: "production-readiness", score: 4, findings: [] },
    ],
  },
});

/** Model with T3 conformance failure + nodeId. */
const GATE_FAIL_MODEL: TierModel = toTierModel({
  verifyResult: {
    status: "FAIL",
    checks: [
      { id: "editorType", status: "PASS" },
      { id: "geometry", status: "FAIL" },
    ],
    failures: [
      {
        check: "geometry",
        nodeId: "12:341",
        name: "Retry Button",
        property: "x",
        expected: 100,
        actual: 120,
      },
    ],
    summary: { checks: 2, passed: 1, failed: 1, skipped: 0 },
  },
});

// ─── Default props helpers ────────────────────────────────────────────────────

function makeDefaultProps(overrides: Partial<ChecksViewProps> = {}): ChecksViewProps {
  return {
    model: FAILING_MODEL,
    isEmpty: false,
    runMeta: { unit: "page", runNumber: 38, escalationSkipped: true },
    hasAnnotations: false,
    // I-3: isAnnotating removed from ChecksViewProps
    historyEntries: [],
    onCopyReport: vi.fn(),
    onAnnotate: vi.fn(),
    onClearAnnotations: vi.fn(),
    onNodeRef: vi.fn(),
    onComponentsLink: vi.fn(),
    onSelectHistory: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

// ─── Fake bridge factory ──────────────────────────────────────────────────────

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn().mockResolvedValue({ ok: true, snapshot: BASE_APP_STATE.snapshot }),
    snapshot: vi.fn().mockResolvedValue(BASE_APP_STATE.snapshot),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi.fn().mockResolvedValue({ version: "0.0.0", uptimeMs: 0, runsRelayed: 0, tokenCount: null }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    enqueue: vi.fn().mockResolvedValue({ id: "req-1" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeBus(storedByKey: Record<string, unknown> = {}): PluginBus {
  return {
    storageGet: vi.fn().mockImplementation(async (key: string) => storedByKey[key]),
    storageSet: vi.fn().mockResolvedValue(undefined),
    fileInfo: vi.fn().mockResolvedValue({ name: "Meridian Health", fileKey: "file-abc" }),
    insertIcon: vi.fn().mockResolvedValue("node-1"),
    notify: vi.fn(),
    close: vi.fn(),
    onSelection: vi.fn().mockReturnValue(() => {}),
    selectNodes: vi.fn(),
    postReview: vi.fn(),
  };
}

// ─── AC-1: Failing run renders banner + tiers + findings + skip cascade ───────

describe("AC-1: failing run renders banner with tier name, per-tier stats, findings, skip cascade", () => {
  it("red banner mentions the failing tier name", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    // T2 fails → banner should say "Run failed at T2 · Integrity"
    expect(screen.getByRole("banner")).toHaveTextContent("T2");
    expect(screen.getByRole("banner")).toHaveTextContent("Integrity");
  });

  it("run metadata appears in the banner", () => {
    render(
      <ChecksView
        {...makeDefaultProps({
          model: FAILING_MODEL,
          runMeta: { unit: "page", runNumber: 38, escalationSkipped: true },
        })}
      />,
    );
    expect(screen.getByRole("banner")).toHaveTextContent("run #38");
    expect(screen.getByRole("banner")).toHaveTextContent("escalation skipped");
  });

  it("all five tier rows render", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    for (const label of ["T0", "T1", "T2", "T3", "VLM"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("T3 row shows skip reason 'short-circuit'", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    expect(screen.getByText("short-circuit")).toBeInTheDocument();
  });

  it("VLM row shows 'requires local pass'", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    expect(screen.getByText("requires local pass")).toBeInTheDocument();
  });

  it("failing tier (T2) auto-expands to show findings", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    // The token finding ruleId should be visible
    expect(screen.getByText("token.color-raw")).toBeInTheDocument();
  });

  it("finding card shows the finding message (stripped of nearest: suffix)", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    expect(screen.getByText(/Fill #E24C4C is not a resolved token/)).toBeInTheDocument();
  });

  it("3-finding model expands with 3 finding cards", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL_3 })} />);
    // a11y, contrast, token findings
    expect(screen.getByText("a11y.target-size")).toBeInTheDocument();
    expect(screen.getByText("contrast.text-min")).toBeInTheDocument();
    expect(screen.getByText("token.color-raw")).toBeInTheDocument();
  });
});

// ─── I-1: Hint rendering with hintPrefix ─────────────────────────────────────

describe("I-1: hint rendered with hintPrefix — 'nearest: ' for token, none for craft", () => {
  it("token finding with nearest hint renders 'nearest: <token>'", () => {
    // FAILING_MODEL token finding has nearest: semantic/danger-500
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    expect(screen.getByText(/nearest: semantic\/danger-500/)).toBeInTheDocument();
  });

  it("craft finding renders fix without 'nearest: ' prefix", () => {
    const craftFailModel = toTierModel({
      batchReport: {
        checks: [
          { id: "render-coverage", status: "pass", severity: "must", findings: [] },
          { id: "a11y", status: "pass", severity: "must", findings: [] },
          { id: "contrast", status: "pass", severity: "must", findings: [] },
          { id: "token-conformance", status: "pass", severity: "must", findings: [] },
        ],
      },
      verifyResult: {
        status: "PASS",
        checks: [{ id: "geometry", status: "PASS" }],
        failures: [],
        summary: { checks: 1, passed: 1, failed: 0, skipped: 0 },
      },
      craftReport: {
        version: 1,
        overall: 4,
        pass: false,
        reliability: "best-effort",
        dimensions: [
          {
            name: "hierarchy",
            score: 2,
            findings: [
              {
                screen: "Error State",
                issue: "Poor CTA hierarchy",
                fix: "Increase contrast between heading and button",
              },
            ],
          },
        ],
      },
    });
    render(<ChecksView {...makeDefaultProps({ model: craftFailModel })} />);
    // VLM auto-expands (failedTier = VLM). Fix shows without "nearest: " prefix.
    expect(
      screen.getByText("Increase contrast between heading and button"),
    ).toBeInTheDocument();
    // Must NOT appear with "nearest: " prefix
    expect(
      screen.queryByText(/nearest: Increase contrast/),
    ).not.toBeInTheDocument();
  });
});

// ─── I-2: Annotation routing field assertions ─────────────────────────────────

describe("I-2: annotation routing — coverage vs element finding fields", () => {
  it("T1 coverage finding routes as CoverageGap (requirement field set in report)", async () => {
    const user = userEvent.setup();

    // Coverage fail: batchReport only — no status PASS/FAIL so M-2 guard allows it
    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        checks: [
          {
            id: "render-coverage",
            status: "fail",
            findings: [
              {
                detail: "story checkout-success error state not covered",
                ref: "checkout-success/error",
              },
            ],
          },
        ],
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Annotate/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Annotate/i }));

    const report = (bus.postReview as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      findings: Array<{ requirement?: string; property?: string; status: string }>;
    };
    const findings = report.findings;
    // T1 coverage finding → CoverageGap: requirement is set, status = "unmet"
    expect(findings[0]!.requirement).toBe("checkout-success · error");
    expect(findings[0]!.status).toBe("unmet");
  });

  it("T3 element finding routes as ElementFlag (property = nodeName)", async () => {
    const user = userEvent.setup();

    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [{ id: "geometry", status: "FAIL" }],
        failures: [
          {
            check: "geometry",
            nodeId: "12:341",
            name: "Retry Button",
            property: "x",
            expected: 100,
            actual: 120,
          },
        ],
        summary: { checks: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Annotate/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Annotate/i }));

    const report = (bus.postReview as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      findings: Array<{ requirement?: string; property?: string }>;
    };
    const findings = report.findings;
    // T3 element finding → ElementFlag: no requirement, property = nodeName ("Retry Button")
    expect(findings[0]!.requirement).toBeUndefined();
    expect(findings[0]!.property).toBe("Retry Button");
  });
});

// ─── I-3: isAnnotating removed ───────────────────────────────────────────────

describe("I-3: isAnnotating removed — annotate button is fire-and-forget", () => {
  it("annotate button is not disabled after first click (no 500ms gate)", async () => {
    const user = userEvent.setup();

    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [{ id: "geometry", status: "FAIL" }],
        failures: [
          {
            check: "geometry",
            nodeId: "12:341",
            name: "Btn",
            property: "x",
            expected: 1,
            actual: 2,
          },
        ],
        summary: { checks: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    const btn = await screen.findByRole("button", { name: /Annotate/i });
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    // Button remains enabled after click — fire-and-forget
    expect(btn).not.toBeDisabled();
  });
});

// ─── M-3: Annotate toast for non-placeable findings ──────────────────────────

describe("M-3: annotate toast 'M placeable · K without canvas targets' when K>0", () => {
  it("toasts with placeable + non-placeable counts when some findings lack canvas target", async () => {
    const user = userEvent.setup();

    // Two failures: one with name (placeable), one without name or nodeId (non-placeable)
    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [
          { id: "geometry", status: "FAIL" },
          { id: "counts", status: "FAIL" },
        ],
        failures: [
          {
            check: "geometry",
            nodeId: "12:341",
            name: "Retry Button",
            property: "x",
            expected: 100,
            actual: 120,
          },
          {
            // No nodeId, no name → non-placeable
            check: "counts",
            property: "frames",
            expected: 3,
            actual: 2,
          },
        ],
        summary: { checks: 2, passed: 0, failed: 2, skipped: 0 },
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Annotate 2 failures/i }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Annotate 2 failures/i }));

    // Toast should note the 1 non-placeable and 1 placeable
    const toasts = useAppStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toMatch(/1 placeable/);
    expect(toasts[0]!.message).toMatch(/1 without canvas targets/);
  });

  it("no toast when all findings are placeable", async () => {
    const user = userEvent.setup();

    // All failures have name → all placeable
    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [{ id: "geometry", status: "FAIL" }],
        failures: [
          {
            check: "geometry",
            nodeId: "12:341",
            name: "Retry Button",
            property: "x",
            expected: 100,
            actual: 120,
          },
        ],
        summary: { checks: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Annotate/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Annotate/i }));

    // No toast — all findings are placeable
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });
});

// ─── M-5: persisted run counter ──────────────────────────────────────────────

describe("M-5: runNumber from persisted monotonic counter (not history.length + 1)", () => {
  it("uses runCounter from new ChecksStorage shape for runNumber", async () => {
    // Storage has counter=43 — this run should be #43 even though there are 2 history entries
    const storedPayload = {
      entries: [
        { id: "run-42", label: "Run #42 · pass", model: CLEAN_MODEL },
        { id: "run-41", label: "Run #41 · pass", model: CLEAN_MODEL },
      ],
      runCounter: 43,
    };

    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [{ id: "geometry", status: "FAIL" }],
        failures: [
          {
            check: "geometry",
            nodeId: "12:341",
            name: "Btn",
            property: "x",
            expected: 1,
            actual: 2,
          },
        ],
        summary: { checks: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    });
    const bus = makeBus({ "checks:v1:file-abc": storedPayload });

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    // Run #43 should appear in the banner (from persisted counter, not history.length+1=3)
    await waitFor(() =>
      expect(screen.getByRole("banner")).toHaveTextContent(/run #43/i),
    );
  });

  it("legacy HistoryEntry[] format still loads history entries", async () => {
    // Old format: plain array (no runCounter)
    const storedHistory: HistoryEntry[] = [
      { id: "h-1", label: "Run #1 · pass", model: CLEAN_MODEL },
    ];

    const bridge = makeBridge({ latestRender: vi.fn().mockResolvedValue(null) });
    const bus = makeBus({ "checks:v1:file-abc": storedHistory });

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Run #1 · pass" }),
      ).toBeInTheDocument(),
    );
  });

  it("saves incremented counter back to storage after live run", async () => {
    const storedPayload = {
      entries: [],
      runCounter: 10,
    };

    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [{ id: "geometry", status: "FAIL" }],
        failures: [
          { check: "geometry", nodeId: "12:341", name: "Btn", property: "x", expected: 1, actual: 2 },
        ],
        summary: { checks: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    });
    const bus = makeBus({ "checks:v1:file-abc": storedPayload });

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    // Banner should show run #10 (from persisted counter)
    await waitFor(() =>
      expect(screen.getByRole("banner")).toHaveTextContent(/run #10/i),
    );

    // storageSet should have been called with runCounter=11 (next run)
    await waitFor(() =>
      expect(bus.storageSet).toHaveBeenCalledWith(
        "checks:v1:file-abc",
        expect.objectContaining({ runCounter: 11 }),
      ),
    );
  });
});

// ─── AC-2: Annotate posts a review message (drives Checks container) ──────────

describe("AC-2: Annotate N failures posts review message + idempotent second press", () => {
  it("posts a {type:'review'} pluginMessage when annotate button is clicked", async () => {
    const user = userEvent.setup();

    // Return a GateResult so T3 fails and the annotate button appears
    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [{ id: "geometry", status: "FAIL" }],
        failures: [
          {
            check: "geometry",
            nodeId: "12:341",
            name: "Retry Button",
            property: "x",
            expected: 100,
            actual: 120,
          },
        ],
        summary: { checks: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    // Wait for the annotate button to appear (data loaded)
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Annotate/i }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Annotate/i }));

    // Should have called bus.postReview with a report
    expect(bus.postReview).toHaveBeenCalledTimes(1);
  });

  it("second press also posts (idempotent — clears then re-draws)", async () => {
    const user = userEvent.setup();

    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [{ id: "geometry", status: "FAIL" }],
        failures: [
          {
            check: "geometry",
            nodeId: "12:341",
            name: "Retry Button",
            property: "x",
            expected: 100,
            actual: 120,
          },
        ],
        summary: { checks: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Annotate/i }),
      ).toBeInTheDocument(),
    );

    // Click twice — I-3: no disable gate; both clicks fire (fire-and-forget)
    await user.click(screen.getByRole("button", { name: /Annotate/i }));
    await user.click(screen.getByRole("button", { name: /Annotate/i }));

    // Called twice — idempotent (no duplicate prevention)
    expect(bus.postReview).toHaveBeenCalledTimes(2);
  });

  it("after annotating, Clear annotations button appears", async () => {
    const user = userEvent.setup();
    const onAnnotate = vi.fn();

    render(
      <ChecksView
        {...makeDefaultProps({
          model: FAILING_MODEL,
          hasAnnotations: false,
          onAnnotate,
        })}
      />,
    );

    // No clear button initially
    expect(
      screen.queryByRole("button", { name: /Clear annotations/i }),
    ).not.toBeInTheDocument();

    // Simulate annotate click; re-render with hasAnnotations=true
    cleanup();
    render(
      <ChecksView
        {...makeDefaultProps({
          model: FAILING_MODEL,
          hasAnnotations: true,
          onAnnotate,
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Clear annotations/i }),
    ).toBeInTheDocument();
  });

  it("review message contains N findings equal to openFindings", async () => {
    const user = userEvent.setup();

    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [
          { id: "geometry", status: "FAIL" },
          { id: "counts", status: "FAIL" },
        ],
        failures: [
          {
            check: "geometry",
            nodeId: "12:341",
            name: "Btn",
            property: "x",
            expected: 10,
            actual: 20,
          },
          {
            check: "counts",
            property: "frames",
            expected: 3,
            actual: 2,
          },
        ],
        summary: { checks: 2, passed: 0, failed: 2, skipped: 0 },
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Annotate 2 failures/i }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Annotate 2 failures/i }));

    const report = (bus.postReview as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      findings: unknown[];
    };
    expect(report.findings).toHaveLength(2);
  });
});

// ─── AC-3: Node ref renders ───────────────────────────────────────────────────

describe("AC-3: node ref renders as a clickable chip in finding cards", () => {
  it("renders a node ref chip for findings with nodeId", () => {
    render(
      <ChecksView
        {...makeDefaultProps({ model: GATE_FAIL_MODEL })}
      />,
    );
    // T3 has geometry failure with nodeId 12:341
    expect(screen.getByLabelText("node 12:341")).toBeInTheDocument();
  });

  it("clicking node ref chip calls onNodeRef with the node id", async () => {
    const user = userEvent.setup();
    const onNodeRef = vi.fn();

    render(
      <ChecksView
        {...makeDefaultProps({ model: GATE_FAIL_MODEL, onNodeRef })}
      />,
    );

    await user.click(screen.getByLabelText("node 12:341"));
    expect(onNodeRef).toHaveBeenCalledWith("12:341");
  });

  it("token finding (no nodeId) does not render a node chip", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    // Token finding has no nodeId, so no node chip
    expect(screen.queryByLabelText(/^node /i)).not.toBeInTheDocument();
  });
});

// ─── AC-4: Copy report determinism ───────────────────────────────────────────

describe("AC-4: Copy report writes a deterministic markdown report to clipboard", () => {
  it("calls onCopyReport when Copy report button is clicked", async () => {
    const user = userEvent.setup();
    const onCopyReport = vi.fn();

    render(
      <ChecksView
        {...makeDefaultProps({ model: FAILING_MODEL, onCopyReport })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Copy report/i }));
    expect(onCopyReport).toHaveBeenCalledOnce();
  });

  it("Checks container Copy report writes to clipboard (integration)", async () => {
    const user = userEvent.setup();

    // Mock clipboard
    const writtenText: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockImplementation((text: string) => {
          writtenText.push(text);
          return Promise.resolve();
        }),
      },
    });

    const bridge = makeBridge({
      latestRender: vi.fn().mockResolvedValue({
        status: "FAIL",
        checks: [{ id: "geometry", status: "FAIL" }],
        failures: [
          {
            check: "geometry",
            nodeId: "12:341",
            name: "Hero Button",
            property: "x",
            expected: 100,
            actual: 120,
          },
        ],
        summary: { checks: 1, passed: 0, failed: 1, skipped: 0 },
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Copy report/i }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Copy report/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
    const text = writtenText[0] ?? "";
    expect(text).toContain("UXFactory Check Report");
    expect(text).toContain("conform.geometry");

    vi.unstubAllGlobals();
  });
});

// ─── AC-6: History dropdown ───────────────────────────────────────────────────

describe("AC-6: History dropdown renders last 20 run entries; selecting one loads frozen report", () => {
  const HISTORY: HistoryEntry[] = [
    {
      id: "run-37",
      label: "Run #37 · T2 fail",
      model: FAILING_MODEL,
    },
    {
      id: "run-36",
      label: "Run #36 · pass",
      model: CLEAN_MODEL,
    },
  ];

  it("renders history entries in the dropdown", () => {
    render(
      <ChecksView
        {...makeDefaultProps({
          model: FAILING_MODEL,
          historyEntries: HISTORY,
        })}
      />,
    );

    // Both history labels should be options in the select
    expect(
      screen.getByRole("option", { name: "Run #37 · T2 fail" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Run #36 · pass" }),
    ).toBeInTheDocument();
  });

  it("selecting a history entry calls onSelectHistory with the entry id", async () => {
    const user = userEvent.setup();
    const onSelectHistory = vi.fn();

    render(
      <ChecksView
        {...makeDefaultProps({
          model: FAILING_MODEL,
          historyEntries: HISTORY,
          onSelectHistory,
        })}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Run history" }),
      "run-36",
    );

    expect(onSelectHistory).toHaveBeenCalledWith("run-36");
  });

  it("Checks container loads history from bus storage (legacy HistoryEntry[] format)", async () => {
    const storedHistory: HistoryEntry[] = [
      { id: "h-1", label: "Run #1 · pass", model: CLEAN_MODEL },
    ];

    const bridge = makeBridge({ latestRender: vi.fn().mockResolvedValue(null) });
    const bus = makeBus({ "checks:v1:file-abc": storedHistory });

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Run #1 · pass" }),
      ).toBeInTheDocument(),
    );
  });
});

// ─── AC-7: Clean run — green banner + VLM craft summary ──────────────────────

describe("AC-7: fully green run — clean banner and VLM craft score summary", () => {
  it("renders green banner '✓ Run passed'", () => {
    render(
      <ChecksView
        {...makeDefaultProps({
          model: CLEAN_MODEL,
          runMeta: { runNumber: 10, escalationSkipped: true },
        })}
      />,
    );

    expect(screen.getByRole("banner")).toHaveTextContent("✓ Run passed");
  });

  it("VLM row shows craft score summary", () => {
    render(
      <ChecksView
        {...makeDefaultProps({ model: CLEAN_MODEL })}
      />,
    );

    // VLM stats: "craft 4/5 · pass"
    expect(screen.getByText(/craft 4\/5/i)).toBeInTheDocument();
  });

  it("no Annotate button when openFindings is 0", () => {
    render(<ChecksView {...makeDefaultProps({ model: CLEAN_MODEL })} />);
    expect(
      screen.queryByRole("button", { name: /Annotate/i }),
    ).not.toBeInTheDocument();
  });

  it("Copy report button is present as primary action for clean run", () => {
    render(<ChecksView {...makeDefaultProps({ model: CLEAN_MODEL })} />);
    expect(
      screen.getByRole("button", { name: /Copy report/i }),
    ).toBeInTheDocument();
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("Empty state: no runs yet", () => {
  it("renders empty state message when isEmpty=true", () => {
    render(
      <ChecksView
        {...makeDefaultProps({ model: toTierModel({}), isEmpty: true })}
      />,
    );

    expect(screen.getByText(/No checks yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Check my design/i)).toBeInTheDocument();
  });

  it("empty state links to Components tab via onComponentsLink", async () => {
    const user = userEvent.setup();
    const onComponentsLink = vi.fn();

    render(
      <ChecksView
        {...makeDefaultProps({
          model: toTierModel({}),
          isEmpty: true,
          onComponentsLink,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Go to Components/i }));
    expect(onComponentsLink).toHaveBeenCalledOnce();
  });

  it("Checks container shows empty state when bridge returns null", async () => {
    const bridge = makeBridge({ latestRender: vi.fn().mockResolvedValue(null) });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    // After data fetch resolves, should still show empty state
    await act(async () => {});

    expect(screen.getByText(/No checks yet/i)).toBeInTheDocument();
  });

  it("empty state does NOT render tier rows", () => {
    render(
      <ChecksView
        {...makeDefaultProps({ model: toTierModel({}), isEmpty: true })}
      />,
    );

    expect(screen.queryByText("T0")).not.toBeInTheDocument();
    expect(screen.queryByText("VLM")).not.toBeInTheDocument();
  });

  it("Components tab is navigated to when Checks empty state link is used from container", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({ latestRender: vi.fn().mockResolvedValue(null) });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    await act(async () => {});

    await user.click(screen.getByRole("button", { name: /Go to Components/i }));

    expect(useAppStore.getState().route.tab).toBe("components");
  });
});

// ─── Annotate button label reflects finding count ─────────────────────────────

describe("Annotate button label", () => {
  it("shows singular 'failure' when openFindings === 1", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    // FAILING_MODEL has 1 open finding
    expect(
      screen.getByRole("button", { name: /Annotate 1 failure on canvas/i }),
    ).toBeInTheDocument();
  });

  it("shows plural 'failures' when openFindings > 1", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL_3 })} />);
    // FAILING_MODEL_3 has 3 open findings
    expect(
      screen.getByRole("button", { name: /Annotate 3 failures on canvas/i }),
    ).toBeInTheDocument();
  });
});

// ─── Tier expand/collapse ─────────────────────────────────────────────────────

describe("Tier row expand/collapse", () => {
  it("failing tier with findings is expandable (aria-expanded present)", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    // The T2 row button should have aria-expanded (it has findings)
    const t2btn = screen.getByRole("button", {
      name: /T2 Integrity fail/i,
    });
    expect(t2btn).toHaveAttribute("aria-expanded");
  });

  it("pass tier without findings is not expandable (disabled button)", () => {
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);
    // T0 Schema passes and has no findings — its button is disabled
    const t0btn = screen.getByRole("button", {
      name: /T0 Schema pass/i,
    });
    expect(t0btn).toBeDisabled();
  });

  it("clicking an expanded tier collapses it", async () => {
    const user = userEvent.setup();
    render(<ChecksView {...makeDefaultProps({ model: FAILING_MODEL })} />);

    // T2 auto-expands. Clicking its button should collapse.
    const t2btn = screen.getByRole("button", { name: /T2 Integrity fail/i });
    expect(t2btn).toHaveAttribute("aria-expanded", "true");
    await user.click(t2btn);
    expect(t2btn).toHaveAttribute("aria-expanded", "false");
  });
});

// ─── Search-param-driven refresh (generate→Checks navigation) ─────────────────

describe("focus.runId intent — Checks refetches on navigate from generate", () => {
  it("re-fetches latestRender when the run search param changes", async () => {
    const latestRender = vi.fn().mockResolvedValue(null);
    const bridge = makeBridge({ latestRender });
    const bus = makeBus();
    const { router } = await renderWithProviders(<Checks bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/checks"],
    });
    await waitFor(() => expect(latestRender).toHaveBeenCalledTimes(1));
    await act(async () => {
      await router.navigate({ to: "/tabs/checks", search: { run: "run-gen-1" } });
    });
    await waitFor(() => expect(latestRender).toHaveBeenCalledTimes(2));
  });

  it("Refresh button triggers refetch of latestRender", async () => {
    const user = userEvent.setup();
    const latestRender = vi.fn().mockResolvedValue(null);
    const bridge = makeBridge({ latestRender });
    const bus = makeBus();

    await renderWithProviders(<Checks bridge={bridge} bus={bus} />, { initialEntries: ["/tabs/checks"] });

    // Wait for the mount fetch (empty state — latestRender returns null)
    await waitFor(() => expect(latestRender).toHaveBeenCalledTimes(1));

    // Refresh button is visible in the Checks header even during empty state
    await user.click(screen.getByRole("button", { name: /Refresh/i }));

    // latestRender must have been called again
    await waitFor(() => expect(latestRender).toHaveBeenCalledTimes(2));
  });
});
