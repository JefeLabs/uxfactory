// @vitest-environment jsdom
/**
 * screen-json-form-editor.test.tsx — RTL tests for the structured-data (JSON)
 * artifact editor. Drives the real React Hook Form component with the `audience`
 * field spec: renders typed inputs (segment cards, percent, segment-name
 * dropdown), tracks dirty, and serializes edits back to pretty JSON on save.
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { Bridge } from "../ui/lib/bridge.js";
import { JsonFormEditor } from "../ui/screens/JsonFormEditor.js";
import { formSpecFor } from "../ui/lib/artifact-forms.js";
import { useAppStore } from "../ui/stores/app.js";
import { renderWithProviders } from "./test-utils.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const AUDIENCE = {
  segments: [
    {
      name: "design leads",
      share: 0.5,
      ageRange: "28-45",
      locales: ["en-US"],
      context: "own the quality bar",
      deviceMix: { desktop: 0.8, mobile: 0.2 },
      accessibilityNotes: "dense evidence tables",
    },
    {
      name: "product managers",
      share: 0.5,
      ageRange: "26-45",
      locales: ["en-US"],
      context: "register stories",
      deviceMix: { desktop: 0.6, mobile: 0.4 },
      accessibilityNotes: null,
    },
  ],
  primarySegment: "design leads",
};

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }),
    snapshot: vi.fn().mockResolvedValue(null),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi.fn().mockResolvedValue({ version: "0.0.0", uptimeMs: 0, runsRelayed: 0, tokenCount: null }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    skills: vi.fn().mockResolvedValue({ skills: [] }),
    enqueue: vi.fn().mockResolvedValue({ id: "req-1" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue(null),
    getArtifact: vi.fn().mockResolvedValue(null),
    putArtifact: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function renderEditor(bridge: Bridge, value: Record<string, unknown> = JSON.parse(JSON.stringify(AUDIENCE))) {
  return renderWithProviders(
    <JsonFormEditor
      artifactKey="audience"
      label="Audience"
      status="up-to-date"
      spec={formSpecFor("audience")!}
      value={value}
      bridge={bridge}
      onBack={vi.fn()}
      onRegenerate={vi.fn()}
    />,
    { initialEntries: ["/tabs/artifacts"] },
  );
}

/** Parse the JSON content of the most recent putArtifact call (asserting its key). */
function savedJson(bridge: Bridge, expectedKey = "audience"): any {
  const calls = (bridge.putArtifact as ReturnType<typeof vi.fn>).mock.calls;
  const [key, content] = calls[calls.length - 1]!;
  expect(key).toBe(expectedKey);
  return JSON.parse(content as string);
}

beforeEach(() => {
  useAppStore.setState({
    connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/root", mode: "local" },
    fileInfo: null,
    snapshot: null,
    toasts: [],
  });
});

afterEach(cleanup);

describe("JsonFormEditor — audience form", () => {
  it("renders segment cards, percent-as-whole-number, and a segment-name dropdown", async () => {
    await renderEditor(makeBridge());

    // The repeatable Segments group with two segment cards.
    expect(screen.getByRole("group", { name: "Segments" })).toBeInTheDocument();
    const names = screen.getAllByLabelText("Name") as HTMLInputElement[];
    expect(names).toHaveLength(2);
    expect(names[0]!.value).toBe("design leads");

    // Share renders as 50 (a whole percent), not 0.5.
    const shares = screen.getAllByLabelText("Share") as HTMLInputElement[];
    expect(shares[0]!.value).toBe("50");

    // Primary segment is a select whose options are the segment names.
    const primary = screen.getByLabelText("Primary segment") as HTMLSelectElement;
    expect(primary.value).toBe("design leads");
    const optionText = within(primary).getAllByRole("option").map((o) => o.textContent);
    expect(optionText).toEqual(expect.arrayContaining(["design leads", "product managers"]));
  });

  it("Save is gated until dirty, then PUTs the edited value as JSON", async () => {
    const bridge = makeBridge();
    await renderEditor(bridge);

    const saveBtn = screen.getByRole("button", { name: "Save artifact" });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getAllByLabelText("Name")[0]!, { target: { value: "design directors" } });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);
    await waitFor(() => expect(bridge.putArtifact).toHaveBeenCalledTimes(1));

    const saved = savedJson(bridge);
    expect(saved.segments[0].name).toBe("design directors");
    // Structure preserved: primarySegment + the untouched second segment survive.
    expect(saved.primarySegment).toBe("design leads");
    expect(saved.segments[1].name).toBe("product managers");
  });

  it("edits a percent field back to a 0..1 ratio on save", async () => {
    const bridge = makeBridge();
    await renderEditor(bridge);

    fireEvent.change(screen.getAllByLabelText("Share")[0]!, { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Save artifact" }));
    await waitFor(() => expect(bridge.putArtifact).toHaveBeenCalled());

    expect(savedJson(bridge).segments[0].share).toBeCloseTo(0.6, 5);
  });

  it("nullable field: an emptied accessibilityNotes serializes to null", async () => {
    const bridge = makeBridge();
    await renderEditor(bridge);

    const notes = screen.getAllByLabelText("Accessibility notes")[0] as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save artifact" }));
    await waitFor(() => expect(bridge.putArtifact).toHaveBeenCalled());

    expect(savedJson(bridge).segments[0].accessibilityNotes).toBeNull();
  });

  it("adds and removes a segment (useFieldArray)", async () => {
    const bridge = makeBridge();
    await renderEditor(bridge);

    expect(screen.getAllByLabelText("Name")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Segment" }));
    expect(screen.getAllByLabelText("Name")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Remove Segment 3" }));
    expect(screen.getAllByLabelText("Name")).toHaveLength(2);
  });

  it("shows a shares-sum advisory that reflects the current segments", async () => {
    const bridge = makeBridge();
    await renderEditor(bridge);

    const check = screen.getByTestId("sumcheck-segments-share");
    expect(check.textContent).toMatch(/100%/); // 0.5 + 0.5

    fireEvent.change(screen.getAllByLabelText("Share")[0]!, { target: { value: "20" } });
    await waitFor(() => expect(screen.getByTestId("sumcheck-segments-share").textContent).toMatch(/70%/));
    expect(screen.getByTestId("sumcheck-segments-share").textContent).toMatch(/should be 100%/);
  });
});

// ─── sitemap (static enum + root-scoped nullable self-reference) ───────────────

const SITEMAP = {
  nodes: [
    { nodeId: "N-landing", title: "landing", role: "home", parent: null, featureRefs: ["F-01"], status: "planned" },
    { nodeId: "N-pricing", title: "pricing", role: "secondary", parent: "N-landing", featureRefs: ["F-02"], status: "planned" },
  ],
};

function renderSitemap(bridge: Bridge, value: Record<string, unknown> = JSON.parse(JSON.stringify(SITEMAP))) {
  return renderWithProviders(
    <JsonFormEditor
      artifactKey="sitemap"
      label="Sitemap"
      status="up-to-date"
      spec={formSpecFor("sitemap")!}
      value={value}
      bridge={bridge}
      onBack={vi.fn()}
      onRegenerate={vi.fn()}
    />,
    { initialEntries: ["/tabs/artifacts"] },
  );
}

describe("JsonFormEditor — sitemap form", () => {
  it("renders page cards with a static Role enum and a root-scoped Parent enum", async () => {
    await renderSitemap(makeBridge());

    expect(screen.getAllByLabelText("Title")).toHaveLength(2);

    // Role: static option list.
    const role = screen.getAllByLabelText("Role")[0] as HTMLSelectElement;
    const roleOpts = within(role).getAllByRole("option").map((o) => o.textContent);
    expect(roleOpts).toEqual(["home", "primary", "secondary", "tertiary", "utility"]);

    // Parent: options are every node's id (root-scoped) plus a "(none)" root choice.
    const parent = screen.getAllByLabelText("Parent")[0] as HTMLSelectElement;
    const parentOpts = within(parent).getAllByRole("option").map((o) => o.textContent);
    expect(parentOpts).toEqual(expect.arrayContaining(["(none)", "N-landing", "N-pricing"]));
    // N-landing is a root → its parent select sits on "(none)".
    expect(parent.value).toBe("");
  });

  it("a root page's null parent survives a save; changing a child to root writes null", async () => {
    const bridge = makeBridge();
    await renderSitemap(bridge);

    // Reparent N-pricing (child of N-landing) to root via the "(none)" option.
    const parents = screen.getAllByLabelText("Parent") as HTMLSelectElement[];
    expect(parents[1]!.value).toBe("N-landing");
    fireEvent.change(parents[1]!, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Save artifact" }));
    await waitFor(() => expect(bridge.putArtifact).toHaveBeenCalled());

    const saved = savedJson(bridge, "sitemap");
    expect(saved.nodes[0].parent).toBeNull(); // untouched root stays null
    expect(saved.nodes[1].parent).toBeNull(); // reparented to root
  });

  it("Features render as chips per page", async () => {
    await renderSitemap(makeBridge());
    expect(screen.getByText("F-01")).toBeInTheDocument();
    expect(screen.getByText("F-02")).toBeInTheDocument();
  });
});
