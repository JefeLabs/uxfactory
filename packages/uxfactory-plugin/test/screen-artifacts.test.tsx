// @vitest-environment jsdom
/**
 * screen-artifacts.test.tsx — RTL tests for the Artifacts screen and
 * ExpandedHeader component.
 *
 * Test names map 1-to-1 with PRD §6 acceptance criteria (AC-1 … AC-7).
 *
 * Fixture: MERIDIAN_SNAPSHOT — 15 registered concerns, 10 up-to-date,
 * 1 draft (sitemap), 1 missing (illustrations). Matches the "10 of 12"
 * rollup shown in the mock screenshot.
 *
 * Strategy:
 *   - AC-1, 2, 3, 6, 7: drive <Artifacts> directly.
 *   - AC-4, 5: drive <ExpandedHeader> directly.
 *   - All store state set via setState; bridge is always a fake.
 *
 * Open-behavior (v2): "Open" button mounts ArtifactEditor in-panel; a new
 * "↗" icon button keeps the old external-open behavior via bridge.openPath.
 * AC-2 and keyboard tests updated accordingly.
 *
 * MDXEditor mock: ArtifactEditor imports @mdxeditor/editor which is mocked
 * here with a thin textarea stub so jsdom tests work without browser APIs.
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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type {
  Bridge,
  BridgeEvent,
  ArtifactRow,
  ArtifactContent,
  ProjectSnapshot,
} from "../ui/lib/bridge.js";
import { BridgeError } from "../ui/lib/bridge.js";
import { Artifacts } from "../ui/screens/Artifacts.js";
import { ExpandedHeader } from "../ui/components/ExpandedHeader.js";
import { useAppStore } from "../ui/stores/app.js";
import { useWizardStore } from "../ui/stores/wizard.js";
import { renderWithProviders } from "./test-utils.js";
import { makeQueryClient, queryKeys } from "../ui/queries.js";

// ─── MDXEditor mock ──────────────────────────────────────────────────────────
// ArtifactEditor (mounted when "Open" is clicked) imports @mdxeditor/editor.
// We replace it with a thin textarea stub so jsdom tests don't need browser APIs.

vi.mock("@mdxeditor/editor", async () => {
  const { createElement } = await import("react");
  return {
    MDXEditor: ({
      markdown,
      onChange,
    }: {
      markdown: string;
      onChange?: (v: string) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [k: string]: any;
    }) =>
      createElement("textarea", {
        "data-testid": "mdxeditor",
        value: markdown,
        readOnly: onChange === undefined,
        onChange: onChange
          ? (e: { target: { value: string } }) => onChange(e.target.value)
          : undefined,
      }),
    headingsPlugin: () => ({}),
    listsPlugin: () => ({}),
    quotePlugin: () => ({}),
    linkPlugin: () => ({}),
    tablePlugin: () => ({}),
    thematicBreakPlugin: () => ({}),
    codeBlockPlugin: () => ({}),
    useCodeBlockEditorContext: () => ({ setCode: () => {} }),
    markdownShortcutPlugin: () => ({}),
  };
});

// ─── Minimal brief artifact for editor tests ──────────────────────────────────

const BRIEF_ARTIFACT: ArtifactContent = {
  key: "brief",
  path: "/home/user/meridian/brief.md",
  format: "markdown",
  content: "## Overview\nThis is an overview.",
};

// ─── Meridian fixture artifacts ───────────────────────────────────────────────
// 15 registered concerns · 10 up-to-date · 1 draft · 1 missing = "10 of 12"

const MERIDIAN_ARTIFACTS: ArtifactRow[] = [
  {
    key: "brief",
    group: "product",
    label: "Brief",
    status: "up-to-date",
    meta: "brief.md",
    path: "/home/user/meridian/brief.md",
  },
  {
    key: "stories",
    group: "product",
    label: "Stories",
    status: "up-to-date",
    meta: "3 stories",
    path: "/home/user/meridian/.uxfactory/artifacts/stories",
  },
  {
    key: "personas",
    group: "product",
    label: "Personas",
    status: "missing",
    meta: "",
    path: null,
  },
  {
    key: "sitemap",
    group: "ia-ux",
    label: "Sitemap",
    status: "draft",
    meta: "draft",
    path: "/home/user/meridian/design/sitemap.json",
  },
  {
    key: "flows",
    group: "ia-ux",
    label: "Flows",
    status: "up-to-date",
    meta: "checkout, returns",
    path: "/home/user/meridian/design/flows.json",
  },
  {
    key: "brand-colors",
    group: "design",
    label: "Brand Colors",
    status: "up-to-date",
    meta: "",
    path: "/home/user/meridian/design/design-system.json",
  },
  {
    key: "palettes",
    group: "design",
    label: "Palettes",
    status: "up-to-date",
    meta: "",
    path: "/home/user/meridian/design/design-system.json",
  },
  {
    key: "fonts",
    group: "design",
    label: "Fonts",
    status: "up-to-date",
    meta: "",
    path: "/home/user/meridian/design/design-system.json",
  },
  {
    key: "grid",
    group: "design",
    label: "Grid",
    status: "up-to-date",
    meta: "",
    path: "/home/user/meridian/design/design-system.json",
  },
  {
    key: "typography",
    group: "design",
    label: "Typography",
    status: "missing",
    meta: "",
    path: null,
  },
  {
    key: "a11y-spec",
    group: "design",
    label: "A11y Spec",
    status: "missing",
    meta: "",
    path: null,
  },
  {
    key: "tokens",
    group: "design",
    label: "Tokens",
    status: "up-to-date",
    meta: "1204 colors",
    path: "/home/user/meridian/design/token-set.json",
  },
  {
    key: "icons",
    group: "assets",
    label: "Icons",
    status: "up-to-date",
    meta: "",
    path: "/home/user/meridian/design/assets/icons.json",
  },
  {
    key: "photography",
    group: "assets",
    label: "Photography",
    status: "up-to-date",
    meta: "",
    path: "/home/user/meridian/design/assets/photography.json",
  },
  {
    key: "illustrations",
    group: "assets",
    label: "Illustrations",
    status: "missing",
    meta: "",
    path: null,
  },
];

// ─── Snapshot factories ───────────────────────────────────────────────────────

function makeMeridianSnapshot(
  overrides: Partial<ProjectSnapshot> = {},
): ProjectSnapshot {
  return {
    name: "Meridian Health",
    root: "/home/user/meridian",
    hasClassification: true,
    hasProfile: true,
    classification: {
      category: "ecommerce",
      industry: "corporate",
      locale: "en-US",
      ageGroup: "18-39",
      platforms: ["desktop", "mobile"],
      layout: "responsive",
      style: "mix",
    },
    profile: {
      scope: {
        visual: "high",
        editorial: "medium",
        flow: "low",
        coverage: "medium",
      },
      experimental: {
        coherence: "high",
      },
    },
    artifacts: MERIDIAN_ARTIFACTS,
    requirements: [],
    ...overrides,
  };
}

// ─── Fake bridge factory ──────────────────────────────────────────────────────

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn().mockResolvedValue({
      ok: true,
      snapshot: makeMeridianSnapshot(),
    }),
    snapshot: vi.fn().mockResolvedValue(makeMeridianSnapshot()),
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
    getArtifact: vi.fn().mockResolvedValue(BRIEF_ARTIFACT),
    putArtifact: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

// ─── Store reset ──────────────────────────────────────────────────────────────

function resetStores(snapshot?: ProjectSnapshot): void {
  useAppStore.setState({
    connection: {
      status: "connected",
      endpoint: "http://localhost:3779",
      repoPath: "/home/user/meridian",
      mode: "local",
    },
    fileInfo: { name: "Meridian Health", fileKey: "file-meridian" },
    snapshot: snapshot ?? makeMeridianSnapshot(),
    toasts: [],
  });
  useWizardStore.setState({
    classification: {
      category: "ecommerce",
      industry: "corporate",
      locale: "en-US",
      platforms: ["desktop", "mobile"],
      layout: "responsive",
      ageGroup: "18-39",
      startingMode: "start-fresh",
    },
    defaults: {
      style: "mix",
      visual: "high",
      editorial: "medium",
      flow: "low",
      coverage: "medium",
      coherence: "high",
    },
    userEdited: {
      style: false,
      visual: false,
      editorial: false,
      flow: false,
      coverage: false,
      coherence: false,
    },
  });
}

beforeEach(() => resetStores());
afterEach(cleanup);

// ─── Dialog-flow helper ───────────────────────────────────────────────────────

/**
 * Click a Create/Regenerate row action, wait for the elicitation dialog,
 * answer every required interview question, optionally type guidance, then
 * click Generate.
 */
async function generateViaDialog(
  user: ReturnType<typeof userEvent.setup>,
  rowButtonName: RegExp,
  guidance?: string,
): Promise<void> {
  const button = await screen.findByRole("button", { name: rowButtonName });
  await user.click(button);
  const dialog = await screen.findByRole("dialog");
  // Required [E] interview questions block Generate until answered.
  for (const box of within(dialog).getAllByRole("textbox")) {
    if (box.getAttribute("aria-required") === "true" && (box as HTMLTextAreaElement).value === "") {
      await user.type(box, "test answer");
    }
  }
  if (guidance !== undefined && guidance !== "") {
    const label = /^Guidance for /;
    const guidanceBox = within(dialog)
      .getAllByRole("textbox")
      .find((b) => label.test(b.getAttribute("aria-label") ?? ""))!;
    await user.type(guidanceBox, guidance);
  }
  await user.click(within(dialog).getByRole("button", { name: /^Generate$/i }));
}

// ─── TanStack: invalidates snapshot query after Generate ──────────────────────

describe("TanStack: snapshot query invalidation after Generate", () => {
  it("invalidates the snapshot query after Generate resolves (refetch)", async () => {
    const user = userEvent.setup();
    const snapshotMock = vi.fn().mockResolvedValue(makeMeridianSnapshot());
    const bridge = makeBridge({
      enqueue: vi.fn().mockResolvedValue({ id: "req-1" }),
      snapshot: snapshotMock,
    });
    await renderWithProviders(<Artifacts bridge={bridge} />, {
      initialEntries: ["/tabs/artifacts"],
    });
    await generateViaDialog(user, /Create Illustrations/i);
    await waitFor(() => expect(snapshotMock).toHaveBeenCalled());
  });
});

// ─── AC-1: Inventory groups/rollup exact for Meridian-shaped snapshot ─────────

describe("AC-1: inventory groups / rollup for Meridian fixture (10 of 12)", () => {
  it("renders the heading with the project name", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Meridian Health artifacts/i }),
      ).toBeInTheDocument(),
    );
  });

  it("displays '10 of 15 up to date' rollup", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() =>
      expect(screen.getByText(/10 of 15 up to date/i)).toBeInTheDocument(),
    );
  });

  it("renders the verbatim subcopy", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() =>
      expect(
        screen.getByText(
          "The specifications your designs are verified against.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("renders PRODUCT section with Brief and Stories", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() => {
      const productSection = screen.getByRole("region", { name: "PRODUCT" });
      expect(within(productSection).getByText("Brief")).toBeInTheDocument();
      expect(within(productSection).getByText("Stories")).toBeInTheDocument();
    });
  });

  it("renders IA & UX section with Sitemap and Flows", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() => {
      const section = screen.getByRole("region", { name: "IA & UX" });
      expect(within(section).getByText("Sitemap")).toBeInTheDocument();
      expect(within(section).getByText("Flows")).toBeInTheDocument();
    });
  });

  it("renders DESIGN section with Brand Colors, Palettes, Fonts, Grid, Tokens", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() => {
      const section = screen.getByRole("region", { name: "DESIGN" });
      for (const label of [
        "Brand Colors",
        "Palettes",
        "Fonts",
        "Grid",
        "Tokens",
      ]) {
        expect(within(section).getByText(label)).toBeInTheDocument();
      }
    });
  });

  it("renders ASSETS section with Icons, Photography, Illustrations", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() => {
      const section = screen.getByRole("region", { name: "ASSETS" });
      for (const label of ["Icons", "Photography", "Illustrations"]) {
        expect(within(section).getByText(label)).toBeInTheDocument();
      }
    });
  });

  it("shows 'Create' for missing Illustrations and 'Open' for up-to-date icons", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Create Illustrations/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Open Icons/i }),
      ).toBeInTheDocument();
    });
  });
});

// ─── AC-2: Open mounts editor; ↗ icon calls openPath ─────────────────────────
// v2 open behavior: "Open" button mounts ArtifactEditor in-panel; the new
// "↗" secondary icon button calls bridge.openPath (external editor).

describe("AC-2: Open mounts ArtifactEditor; ↗ icon calls openPath; BridgeError → row-level note", () => {
  it("Open button mounts the ArtifactEditor (shows Back button)", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(await screen.findByRole("button", { name: /Open Brief/i }));

    // ArtifactEditor header has a "Back to artifacts" button
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Back to artifacts/i }),
      ).toBeInTheDocument();
    });
  });

  it("Regenerate inside the editor opens the guided dialog", async () => {
    // Regression: the dialog was only mounted in the inventory branch — the
    // editor branch returned early, so Regenerate set state into a void.
    const user = userEvent.setup();
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(await screen.findByRole("button", { name: /Open Brief/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Back to artifacts/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Regenerate$/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByRole("textbox", { name: /Guidance for Brief/i }),
      ).toBeInTheDocument();
    });
  });

  it("Back button in editor returns to inventory", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(await screen.findByRole("button", { name: /Open Brief/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Back to artifacts/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Back to artifacts/i }));

    // Inventory heading is back
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Meridian Health artifacts/i }),
      ).toBeInTheDocument();
    });
  });

  it("↗ icon button calls bridge.openPath with the artifact path (external open)", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    const externalButtons = await screen.findAllByRole("button", {
      name: /Open in external editor/i,
    });
    // Click the first one (Brief row)
    await user.click(externalButtons[0]!);

    expect(bridge.openPath).toHaveBeenCalledWith(
      "/home/user/meridian/brief.md",
    );
  });

  it("BridgeError on external open renders a row-level alert (no modal)", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      openPath: vi
        .fn()
        .mockRejectedValue(new BridgeError(404, { error: "not found" })),
    });
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    const externalButtons = await screen.findAllByRole("button", {
      name: /Open in external editor/i,
    });
    await user.click(externalButtons[0]!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // Alert contains an error message mentioning status 404
    expect(screen.getByRole("alert")).toHaveTextContent(/404/);

    // No modal dialog should appear
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("non-BridgeError on external open renders a generic row-level alert", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      openPath: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    const externalButtons = await screen.findAllByRole("button", {
      name: /Open in external editor/i,
    });
    // Click the second one (Requirements row)
    await user.click(externalButtons[1]!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Could not open file/i,
      );
    });
  });
});

// ─── AC-3: Create enqueues, shows progress, flips green after snapshot update ─

describe("AC-3: Create → dialog → Generate enqueues, shows generating…, flips green", () => {
  it("Create on Illustrations opens the dialog; interview gates Generate", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    // Clicking Create alone does NOT enqueue — it opens the elicitation dialog
    await user.click(
      await screen.findByRole("button", { name: /Create Illustrations/i }),
    );
    expect(bridge.enqueue).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Generate is blocked until the required [E] question is answered.
    expect(screen.getByRole("button", { name: /^Generate$/i })).toBeDisabled();
    await user.type(screen.getByLabelText("Illustration style in a phrase"), "flat geometric");
    await user.click(screen.getByRole("button", { name: /^Generate$/i }));

    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-artifact",
      payload: {
        artifact: "illustrations",
        guidance: "Illustration style in a phrase\nflat geometric",
      },
    });
  });

  it("Generate shows 'generating…' inline while enqueue is in flight", async () => {
    const user = userEvent.setup();

    // Enqueue never resolves during this test
    const bridge = makeBridge({
      enqueue: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await generateViaDialog(user, /Create Illustrations/i);

    expect(screen.getByText("generating…")).toBeInTheDocument();
  });

  it("row flips to Open (green) after snapshot returns updated status", async () => {
    const user = userEvent.setup();

    const updatedSnapshot = makeMeridianSnapshot({
      artifacts: MERIDIAN_ARTIFACTS.map((a) =>
        a.key === "illustrations"
          ? ({
              ...a,
              status: "up-to-date" as const,
              path: "/home/user/meridian/design/assets/illustrations.json",
            } satisfies ArtifactRow)
          : a,
      ),
    });

    const bridge = makeBridge({
      enqueue: vi.fn().mockResolvedValue({ id: "req-1" }),
      // First call returns base snapshot (illustrations missing); subsequent calls return updated
      snapshot: vi.fn()
        .mockResolvedValueOnce(makeMeridianSnapshot())
        .mockResolvedValue(updatedSnapshot),
    });

    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    // Initially "Create" is visible (initial snapshot has illustrations missing)
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Create Illustrations/i }),
      ).toBeInTheDocument(),
    );

    await generateViaDialog(user, /Create Illustrations/i);

    // After enqueue + refreshSnapshot, the snapshot updates and the row flips
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Open Illustrations/i }),
      ).toBeInTheDocument();
    });

    // "Create" button should be gone
    expect(
      screen.queryByRole("button", { name: /Create Illustrations/i }),
    ).not.toBeInTheDocument();
  });
});

// ─── AC-4: Quick dial — click Visual → Segmented → select Low → putProfile ────

describe("AC-4: quick dial — Visual chip → Segmented → Low → putProfile({visual:'low'}) + toast", () => {
  it("clicking a dial chip reveals the Segmented control", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    // Initially no radiogroup visible
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

    // Click the Visual chip
    const visualChip = screen.getByRole("checkbox", { name: /Visual/i });
    await user.click(visualChip);

    // Quick-dial Segmented appears
    expect(
      screen.getByRole("radiogroup", { name: /Visual fidelity/i }),
    ).toBeInTheDocument();
  });

  it("Segmented shows Low/Medium/High options for Visual", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(screen.getByRole("checkbox", { name: /Visual/i }));

    const group = screen.getByRole("radiogroup", { name: /Visual fidelity/i });
    expect(within(group).getByRole("radio", { name: "Low" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Medium" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "High" })).toBeInTheDocument();
  });

  it("current engine value 'high' is reflected as selected in the Segmented", async () => {
    const user = userEvent.setup();
    // Fixture snapshot has profile.scope.visual = "high"
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(screen.getByRole("checkbox", { name: /Visual/i }));

    // "High" radio should be checked
    const highRadio = screen.getByRole("radio", { name: "High" });
    expect(highRadio).toHaveAttribute("aria-checked", "true");
  });

  it("selecting Low calls putProfile with exact flat {visual:'low'}", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<ExpandedHeader bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(screen.getByRole("checkbox", { name: /Visual/i }));

    const lowRadio = screen.getByRole("radio", { name: "Low" });
    await user.click(lowRadio);

    await waitFor(() => {
      expect(bridge.putProfile).toHaveBeenCalledWith({ visual: "low" });
    });
  });

  it("dial change fires toast 'Applies to new runs'", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<ExpandedHeader bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(screen.getByRole("checkbox", { name: /Visual/i }));
    await user.click(screen.getByRole("radio", { name: "Low" }));

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts;
      expect(toasts.some((t) => t.message === "Applies to new runs")).toBe(true);
    });
  });

  it("clicking the same dial chip again collapses the quick-dial row", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    const visualChip = screen.getByRole("checkbox", { name: /Visual/i });
    await user.click(visualChip); // open
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();

    await user.click(visualChip); // close
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("Flows dial uses Shallow/Medium/Deep labels (not Low/Medium/High)", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(screen.getByRole("checkbox", { name: /Flows/i }));

    const group = screen.getByRole("radiogroup", { name: /Flows fidelity/i });
    expect(within(group).getByRole("radio", { name: "Shallow" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Deep" })).toBeInTheDocument();
  });

  it("putProfile for flows uses wire key 'flow' (not 'flows')", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<ExpandedHeader bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(screen.getByRole("checkbox", { name: /Flows/i }));
    await user.click(screen.getByRole("radio", { name: "Deep" }));

    await waitFor(() => {
      expect(bridge.putProfile).toHaveBeenCalledWith({ flow: "high" });
    });
  });
});

// ─── AC-5: Classification chip click → prefillFrom + route setup-1 ────────────

describe("AC-5: classification chip click → prefillFrom(snapshot) + navigate('/setup/classification')", () => {
  it("clicking Category chip prefills wizard from snapshot", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    const categoryChip = within(
      screen.getByRole("group", { name: "Classification" }),
    ).getByRole("checkbox", { name: /Category/i });

    await user.click(categoryChip);

    // Prefilled from snapshot; legacy "ecommerce" normalizes to the taxonomy id.
    expect(useWizardStore.getState().classification.category).toBe("ecommerce-storefront");
  });

  it("clicking any classification chip navigates to /setup/classification", async () => {
    const user = userEvent.setup();
    const result = await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    const industryChip = within(
      screen.getByRole("group", { name: "Classification" }),
    ).getByRole("checkbox", { name: /Industry/i });

    await user.click(industryChip);

    await waitFor(() =>
      expect(result.router.state.location.pathname).toBe("/setup/classification"),
    );
  });

  it("dial chip click does NOT navigate to setup-1", async () => {
    const user = userEvent.setup();
    const result = await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(screen.getByRole("checkbox", { name: /Visual/i }));

    // Route should stay on the artifacts tab
    expect(result.router.state.location.pathname).toBe("/tabs/artifacts");
  });
});

// ─── AC-6: focus.artifactKey consumption ─────────────────────────────────────

describe("AC-6: focus search param → row highlighted + search cleared", () => {
  it("mounts with focus set → targeted row receives highlighted style", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, {
      initialEntries: ["/tabs/artifacts?focus=illustrations"],
    });

    // Wait for snapshot to load and highlight to be applied
    await waitFor(() => {
      const illustrationsLabel = screen.getByText("Illustrations");
      // Row adds bg-primary-50 when highlighted=true
      const rowEl = illustrationsLabel.closest(
        '[class*="flex items-center"]',
      );
      expect(rowEl).toHaveClass("bg-primary-50");
    });
  });

  it("mounts with focus set → search param cleared after focus consumed", async () => {
    const result = await renderWithProviders(<Artifacts bridge={makeBridge()} />, {
      initialEntries: ["/tabs/artifacts?focus=brief"],
    });

    // After focus is consumed, navigate clears the search param
    await waitFor(() =>
      expect(result.router.state.location.search).toEqual({}),
    );
  });

  it("no focus intent → no rows highlighted on mount", async () => {
    // focus is already null from resetStores; no search param
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    // Wait for inventory to load
    await waitFor(() => screen.getByText("Illustrations"));

    const highlightedRows = document.querySelectorAll(".bg-primary-50");
    expect(highlightedRows).toHaveLength(0);
  });

  it("focus on a MISSING artifact auto-opens its elicitation dialog", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, {
      initialEntries: ["/tabs/artifacts?focus=illustrations"],
    });

    // Clicking a required-missing chip on the Generate tab lands here — the
    // interview must open without a second click.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Illustrations")).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText("Illustration style in a phrase"),
    ).toBeInTheDocument();
  });

  it("focus on an up-to-date artifact only highlights — no dialog", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, {
      initialEntries: ["/tabs/artifacts?focus=brief"],
    });

    await waitFor(() => screen.getByText("Brief"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ─── Planned registry artifacts appear in the inventory ───────────────────────

describe("planned registry artifacts render as coming-soon rows", () => {
  it("shows planned artifacts inside their category sections", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, {
      initialEntries: ["/tabs/artifacts"],
    });
    await waitFor(() => screen.getByText("Illustrations"));

    // Typography/A11y spec are registered now — real rows with Create.
    const design = screen.getByRole("region", { name: "DESIGN" });
    expect(within(design).getByRole("button", { name: /Create Typography/i })).toBeInTheDocument();
    expect(within(design).getByRole("button", { name: /Create A11y Spec/i })).toBeInTheDocument();
    // Still-planned design members keep the coming-soon treatment.
    expect(within(design).getByText("Interaction states")).toBeInTheDocument();
    // …and the new registry categories appear as sections.
    const content = screen.getByRole("region", { name: "CONTENT" });
    expect(within(content).getByText("Copy deck")).toBeInTheDocument();
    expect(within(content).getByText("Glossary")).toBeInTheDocument();
    const governance = screen.getByRole("region", { name: "GOVERNANCE" });
    expect(within(governance).getByText("Conformance policy")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "COMPONENTS" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "REFERENCES" })).toBeInTheDocument();
  });

  it("planned rows say coming soon and offer no Create/Open action", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, {
      initialEntries: ["/tabs/artifacts"],
    });
    await waitFor(() => screen.getByText("Interaction states"));

    expect(screen.getAllByText("Coming soon").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Create Interaction states/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open Interaction states/i }),
    ).not.toBeInTheDocument();
  });

  it("the freshness rollup counts only real (file-backed) artifacts", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, {
      initialEntries: ["/tabs/artifacts"],
    });
    await waitFor(() => screen.getByText("Interaction states"));

    // Meridian snapshot ships 15 rows — planned registry entries must not
    // inflate the denominator.
    expect(screen.getByLabelText("Freshness rollup").textContent).toMatch(/of 15 up to date/);
  });
});

// ─── AC-7: Keyboard — rows focusable; sections are landmarks ─────────────────

describe("AC-7: keyboard accessibility — rows focusable, sections are landmarks", () => {
  it("section headers are role=region landmarks", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() => {
      for (const name of ["PRODUCT", "IA & UX", "DESIGN", "ASSETS"]) {
        expect(screen.getByRole("region", { name })).toBeInTheDocument();
      }
    });
  });

  it("Open buttons are keyboard-reachable (are <button> elements)", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    // All "Open …" buttons should be native buttons (focusable by default)
    const openButtons = await screen.findAllByRole("button", { name: /^Open /i });
    expect(openButtons.length).toBeGreaterThan(0);
    for (const btn of openButtons) {
      expect(btn.tagName).toBe("BUTTON");
    }
  });

  it("Create button is keyboard-reachable", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    const createBtn = await screen.findByRole("button", { name: /Create Illustrations/i });
    expect(createBtn.tagName).toBe("BUTTON");
  });

  it("ExpandedHeader dial chips are buttons with role=checkbox", async () => {
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    // Dial chips use role="checkbox" (per Chip component)
    const dialGroup = screen.getByRole("group", { name: "Dials" });
    const dialChips = within(dialGroup).getAllByRole("checkbox");
    expect(dialChips.length).toBe(6); // style, visual, editorial, flows, coverage, coherence
  });

  it("classification chips are keyboard-reachable buttons", async () => {
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    const clsGroup = screen.getByRole("group", { name: "Classification" });
    const chips = within(clsGroup).getAllByRole("checkbox");
    expect(chips.length).toBe(6); // category, industry, locale, age, platforms, layout
    for (const chip of chips) {
      expect(chip.tagName).toBe("BUTTON");
    }
  });
});

// ─── ExpandedHeader renders expected chip values ──────────────────────────────

describe("ExpandedHeader chip display values", () => {
  it("renders classification chips with values from snapshot", async () => {
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    const clsGroup = screen.getByRole("group", { name: "Classification" });
    // "Category" chip shows "Ecommerce"
    expect(within(clsGroup).getByText("Ecommerce")).toBeInTheDocument();
    // "Industry" chip shows "Corporate"
    expect(within(clsGroup).getByText("Corporate")).toBeInTheDocument();
    // "Locale" chip shows "en-US"
    expect(within(clsGroup).getByText("en-US")).toBeInTheDocument();
  });

  it("renders dial chips with mapped display labels from profile", async () => {
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    const dialGroup = screen.getByRole("group", { name: "Dials" });
    // visual: "high" → "High"
    expect(within(dialGroup).getAllByText("High").length).toBeGreaterThan(0);
    // flow: "low" → "Shallow"
    expect(within(dialGroup).getByText("Shallow")).toBeInTheDocument();
    // coverage: "medium" → "Medium"
    expect(within(dialGroup).getAllByText("Medium").length).toBeGreaterThan(0);
  });

  it("returns null when snapshot is not loaded", async () => {
    useAppStore.setState({
      ...useAppStore.getState(),
      snapshot: null,
    });
    const { container } = await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    expect(container.firstChild).toBeNull();
  });
});

// ─── Regenerate button — WCAG 2.1.1 fix ──────────────────────────────────────

describe("Regenerate button — always visible on draft rows (WCAG 2.1.1)", () => {
  it("draft Sitemap row shows Regenerate button without requiring hover", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Regenerate Sitemap/i }),
      ).toBeInTheDocument(),
    );
  });

  it("Regenerate → dialog → Generate enqueues the correct generate-artifact payload", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await generateViaDialog(user, /Regenerate Sitemap/i);

    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-artifact",
      payload: {
        artifact: "sitemap",
        guidance: expect.stringContaining("List the pages this product needs"),
      },
    });
  });

  it("Regenerate → Generate shows 'generating…' inline while enqueue is in flight", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      enqueue: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await generateViaDialog(user, /Regenerate Sitemap/i);

    expect(screen.getByText("generating…")).toBeInTheDocument();
  });

  it("up-to-date rows have no Regenerate button", async () => {
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });
    // Wait for inventory to load, then verify no Regenerate for up-to-date rows
    await waitFor(() => screen.getByText("Brief"));
    // Brief and Flows are up-to-date — neither should show Regenerate
    expect(
      screen.queryByRole("button", { name: /Regenerate Brief/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Regenerate Flows/i }),
    ).not.toBeInTheDocument();
  });

  it("keyboard: Regenerate Sitemap is reachable via Tab and Enter opens the dialog", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });
    // Wait for inventory to load before tabbing
    await waitFor(() => screen.getByRole("button", { name: /Regenerate Sitemap/i }));

    // Tab order includes ↗ buttons after each Open button; stories is a SET
    // artifact (no in-panel Open — only ↗):
    //   Open Brief → ↗ Brief → ↗ Stories → Create Personas → Regenerate Sitemap
    await user.tab(); // Open Brief
    await user.tab(); // ↗ (Brief)
    await user.tab(); // ↗ (Stories — set row, no Open)
    await user.tab(); // Create Personas (set artifact row)
    await user.tab(); // Regenerate Sitemap

    const regenerateBtn = screen.getByRole("button", { name: /Regenerate Sitemap/i });
    expect(regenerateBtn).toHaveFocus();

    await user.keyboard("{Enter}");

    // Enter opens the elicitation dialog; answering the interview completes it
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/List the pages this product needs/),
      "Home, Pricing",
    );
    await user.click(within(dialog).getByRole("button", { name: /^Generate$/i }));

    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-artifact",
      payload: {
        artifact: "sitemap",
        guidance: expect.stringContaining("Home, Pricing"),
      },
    });
  });
});

// ─── Dial label coverage — Coverage and Style ─────────────────────────────────

describe("quick-dial Segmented label coverage", () => {
  it("Breadth dial (renamed from Coverage) shows Thin and Exhaustive labels", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(screen.getByRole("checkbox", { name: /Breadth/i }));

    const group = screen.getByRole("radiogroup", { name: /Breadth fidelity/i });
    expect(within(group).getByRole("radio", { name: "Thin" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Exhaustive" })).toBeInTheDocument();
  });

  it("Tone dial (renamed from Style) shows Informal and Formal labels", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(screen.getByRole("checkbox", { name: /Tone/i }));

    const group = screen.getByRole("radiogroup", { name: /Tone fidelity/i });
    expect(within(group).getByRole("radio", { name: "Informal" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Formal" })).toBeInTheDocument();
  });

  it("classification chips include the design Style when set", async () => {
    const state = useAppStore.getState();
    useAppStore.setState({
      snapshot: {
        ...state.snapshot!,
        classification: { ...state.snapshot!.classification, designStyle: "swiss" },
      },
    });
    await renderWithProviders(<ExpandedHeader bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    const chips = screen.getByRole("group", { name: "Classification" });
    expect(within(chips).getByRole("checkbox", { name: /Style.*Swiss/i })).toBeInTheDocument();
  });
});

// ─── Guided Create dialog ─────────────────────────────────────────────────────

describe("Guided Create dialog — guiding copy, guidance payload, Cancel", () => {
  it("Create opens a dialog titled 'Create Illustrations' with artifact-specific copy", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(
      await screen.findByRole("button", { name: /Create Illustrations/i }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Create Illustrations"),
    ).toBeInTheDocument();
    // Illustration-specific guiding copy above the interview
    expect(
      within(dialog).getAllByText(/illustration style/i).length,
    ).toBeGreaterThan(0);
    // The interview question renders as a required field.
    expect(
      within(dialog).getByLabelText("Illustration style in a phrase"),
    ).toHaveAttribute("aria-required", "true");
    expect(
      within(dialog).getByPlaceholderText(
        "Optional — leave empty to let the agent infer from the project",
      ),
    ).toBeInTheDocument();
  });

  it("Regenerate Sitemap opens the dialog with sitemap-specific copy", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(
      await screen.findByRole("button", { name: /Regenerate Sitemap/i }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Sitemap")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/main areas or journeys/i),
    ).toBeInTheDocument();
  });

  it("typed guidance is passed through in the enqueue payload", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await generateViaDialog(
      user,
      /Create Illustrations/i,
      "flat geometric, warm palette",
    );

    const call = (bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      kind: string; payload: { artifact: string; guidance: string };
    };
    expect(call.kind).toBe("generate-artifact");
    expect(call.payload.artifact).toBe("illustrations");
    expect(call.payload.guidance).toContain("Illustration style in a phrase");
    expect(call.payload.guidance).toContain("Additional guidance:\nflat geometric, warm palette");
  });

  it("empty free-guidance still ships the interview answers on the wire", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await generateViaDialog(user, /Create Illustrations/i);

    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-artifact",
      payload: {
        artifact: "illustrations",
        guidance: expect.stringContaining("Illustration style in a phrase"),
      },
    });
  });

  it("Cancel closes the dialog without enqueueing", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await user.click(
      await screen.findByRole("button", { name: /Create Illustrations/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Guidance for /), "some guidance");
    await user.click(within(dialog).getByRole("button", { name: /^Cancel$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(bridge.enqueue).not.toHaveBeenCalled();
    // Row is untouched — no pending state
    expect(screen.queryByText("generating…")).not.toBeInTheDocument();
  });
});

// ─── Failure surfacing — SSE failure events + pending timeout ─────────────────

describe("Failure surfacing — SSE failure event clears pending + row error", () => {
  function makeEventfulBridge(): {
    bridge: Bridge;
    emit: (ev: BridgeEvent) => void;
  } {
    let handler: ((ev: BridgeEvent) => void) | null = null;
    const bridge = makeBridge({
      enqueue: vi.fn().mockResolvedValue({ id: "req-9" }),
      events: vi.fn((cb: (ev: BridgeEvent) => void) => {
        handler = cb;
        return () => {
          handler = null;
        };
      }),
    });
    return {
      bridge,
      emit: (ev) => {
        if (handler !== null) handler(ev);
      },
    };
  }

  it("adapter error frame for the tracked enqueue-id → row error, pending cleared", async () => {
    const user = userEvent.setup();
    const { bridge, emit } = makeEventfulBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await generateViaDialog(user, /Create Illustrations/i);
    expect(screen.getByTestId("generating-illustrations")).toBeInTheDocument();

    // Subscription is live while pending; enqueue-id req-9 is tracked
    await waitFor(() => expect(bridge.events).toHaveBeenCalled());

    act(() => {
      emit({
        requestId: "req-9",
        event: {
          type: "error",
          error: { name: "AdapterError", message: "boom" },
        },
        seq: 1,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("generate-error-illustrations"),
      ).toHaveTextContent(/Generation failed — see worker logs/);
    });
    expect(
      screen.queryByTestId("generating-illustrations"),
    ).not.toBeInTheDocument();
    // The Create action returns so the user can try again
    expect(
      screen.getByRole("button", { name: /Create Illustrations/i }),
    ).toBeInTheDocument();
  });

  it("terminal complete frame with failed status also surfaces the row error", async () => {
    const user = userEvent.setup();
    const { bridge, emit } = makeEventfulBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await generateViaDialog(user, /Create Illustrations/i);
    await waitFor(() => expect(bridge.events).toHaveBeenCalled());

    act(() => {
      emit({
        requestId: "req-9",
        event: { type: "complete", status: "failed" },
        seq: 1,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("generate-error-illustrations"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("generating-illustrations"),
    ).not.toBeInTheDocument();
  });

  it("frames for other request ids leave the pending row untouched", async () => {
    const user = userEvent.setup();
    const { bridge, emit } = makeEventfulBridge();
    await renderWithProviders(<Artifacts bridge={bridge} />, { initialEntries: ["/tabs/artifacts"] });

    await generateViaDialog(user, /Create Illustrations/i);
    await waitFor(() => expect(bridge.events).toHaveBeenCalled());

    act(() => {
      emit({
        requestId: "req-other",
        event: { type: "error", error: { name: "X", message: "y" } },
        seq: 1,
      });
    });

    expect(screen.getByTestId("generating-illustrations")).toBeInTheDocument();
    expect(
      screen.queryByTestId("generate-error-illustrations"),
    ).not.toBeInTheDocument();
  });
});

describe("Failure surfacing — 5-minute pending timeout with Retry", () => {
  it("pending times out after 5 minutes → row error; Retry reopens the dialog", async () => {
    vi.useFakeTimers();
    try {
      const bridge = makeBridge({
        enqueue: vi.fn().mockResolvedValue({ id: "req-42" }),
      });
      // Pre-seed the QueryClient with snapshot data so the component is ready
      // immediately — fake timers block React Query's internal setTimeout, which
      // would otherwise keep the component in "Loading…" state.
      const queryClient = makeQueryClient();
      queryClient.setQueryData(queryKeys.snapshot(null), makeMeridianSnapshot());
      await renderWithProviders(<Artifacts bridge={bridge} />, {
        initialEntries: ["/tabs/artifacts"],
        queryClient,
      });

      // fireEvent (not userEvent) — fake timers stall userEvent's delays
      fireEvent.click(
        screen.getByRole("button", { name: /Create Illustrations/i }),
      );
      fireEvent.change(screen.getByLabelText("Illustration style in a phrase"), {
        target: { value: "flat geometric" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));
      await act(async () => {}); // flush enqueue resolution

      expect(
        screen.getByTestId("generating-illustrations"),
      ).toBeInTheDocument();

      // Just before the 5-minute mark: still pending, no error
      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000 - 1000);
      });
      expect(
        screen.getByTestId("generating-illustrations"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("generate-error-illustrations"),
      ).not.toBeInTheDocument();

      // Cross the 5-minute mark → error note with Retry
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(
        screen.getByTestId("generate-error-illustrations"),
      ).toHaveTextContent(/Generation failed — see worker logs/);
      expect(
        screen.queryByTestId("generating-illustrations"),
      ).not.toBeInTheDocument();

      // Retry clears the note and reopens the guided dialog
      fireEvent.click(
        screen.getByRole("button", { name: /Retry Illustrations/i }),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Create Illustrations")).toBeInTheDocument();
      expect(
        screen.queryByTestId("generate-error-illustrations"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Prerequisite chaining — create affordance runs upstream interviews first ─

describe("prerequisite chaining in the create dialog", () => {
  // stories/sitemap/flows missing; personas missing in the base fixture too —
  // the chain resolves transitively: personas ← stories ← flows.
  const chainArtifacts = MERIDIAN_ARTIFACTS.map((a) =>
    ["stories", "sitemap", "flows"].includes(a.key)
      ? { ...a, status: "missing" as const, path: null, meta: "" }
      : a,
  );

  it("Create Flows chains Personas → Stories → Sitemap → Flows in one guided run", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      snapshot: vi.fn().mockResolvedValue(
        makeMeridianSnapshot({ artifacts: chainArtifacts }),
      ),
    });
    await renderWithProviders(<Artifacts bridge={bridge} />, {
      initialEntries: ["/tabs/artifacts"],
    });

    await user.click(await screen.findByRole("button", { name: /Create Flows/i }));

    // Steps run in trace-graph order; every [E] question is answered generically.
    const answerAndGenerate = async () => {
      const dialog = await screen.findByRole("dialog");
      for (const box of within(dialog).getAllByRole("textbox")) {
        if (box.getAttribute("aria-required") === "true") {
          await user.type(box, "answer");
        }
      }
      await user.click(within(dialog).getByRole("button", { name: /^Generate$/i }));
      return dialog;
    };

    // Step 1: Personas — the actor hard-dependency chains transitively.
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Personas")).toBeInTheDocument();
    expect(within(dialog).getByText(/Step 1 of 4/)).toBeInTheDocument();
    expect(within(dialog).getByText(/needed before Flows/i)).toBeInTheDocument();
    await answerAndGenerate();

    // Step 2: Stories (per-story interview).
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Stories")).toBeInTheDocument();
    expect(within(dialog).getByText(/Step 2 of 4/)).toBeInTheDocument();
    await answerAndGenerate();

    // Step 3: Sitemap.
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Sitemap")).toBeInTheDocument();
    expect(within(dialog).getByText(/Step 3 of 4/)).toBeInTheDocument();
    await answerAndGenerate();

    // Step 4: the target itself.
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Flows")).toBeInTheDocument();
    expect(within(dialog).getByText(/Step 4 of 4/)).toBeInTheDocument();
    await answerAndGenerate();

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const order = (bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { payload: { artifact: string } }).payload.artifact,
    );
    expect(order).toEqual(["personas", "stories", "sitemap", "flows"]);
  });

  it("Create Features opens its interview directly when stories are satisfied", async () => {
    const user = userEvent.setup();
    const withFeatures = [
      ...MERIDIAN_ARTIFACTS,
      {
        key: "features",
        group: "product" as const,
        label: "Features",
        status: "missing" as const,
        meta: "",
        path: null,
      },
    ];
    const bridge = makeBridge({
      snapshot: vi.fn().mockResolvedValue(
        makeMeridianSnapshot({ artifacts: withFeatures }),
      ),
    });
    await renderWithProviders(<Artifacts bridge={bridge} />, {
      initialEntries: ["/tabs/artifacts"],
    });

    await user.click(await screen.findByRole("button", { name: /Create Features/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Features")).toBeInTheDocument();
    // stories are up-to-date in the fixture — no chain steps.
    expect(within(dialog).queryByText(/Step \d+ of/)).not.toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText(/major capabilities/i),
      "Browse FAQ, Contact support",
    );
    await user.click(within(dialog).getByRole("button", { name: /^Generate$/i }));
    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-artifact",
      payload: {
        artifact: "features",
        guidance: expect.stringContaining("Browse FAQ, Contact support"),
      },
    });
  });

  it("satisfied prerequisites skip the chain entirely", async () => {
    // Fixture default: brand-colors is up-to-date → Illustrations opens direct.
    const user = userEvent.setup();
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, {
      initialEntries: ["/tabs/artifacts"],
    });
    await user.click(
      await screen.findByRole("button", { name: /Create Illustrations/i }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Illustrations")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Step \d+ of/)).not.toBeInTheDocument();
  });
});

// ─── IA seeds prefill the sitemap interview ───────────────────────────────────

describe("sitemap interview is seeded from the category's IA seed", () => {
  it("the pages question arrives prefilled from the taxonomy (editable [D])", async () => {
    const user = userEvent.setup();
    await renderWithProviders(<Artifacts bridge={makeBridge()} />, {
      initialEntries: ["/tabs/artifacts"],
    });

    await user.click(
      await screen.findByRole("button", { name: /Regenerate Sitemap/i }),
    );
    const dialog = await screen.findByRole("dialog");
    const pages = within(dialog).getByLabelText(/List the pages/) as HTMLTextAreaElement;
    // Meridian classification: legacy "ecommerce" → ecommerce-storefront's seed.
    expect(pages.value).toContain("Product (PDP)");
    expect(pages.value).toContain("Checkout");
    // Prefill satisfies the [E] gate — Generate is immediately available.
    expect(within(dialog).getByRole("button", { name: /^Generate$/i })).toBeEnabled();
  });
});
