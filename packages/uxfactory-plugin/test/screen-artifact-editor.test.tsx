// @vitest-environment jsdom
/**
 * screen-artifact-editor.test.tsx — RTL tests for ArtifactEditor.
 *
 * MDXEditor / jsdom approach:
 *   @mdxeditor/editor uses browser-only APIs that don't work in jsdom.  Rather
 *   than fighting the runtime, we vi.mock the entire module with a thin stub:
 *   each MDXEditor instance renders as a <textarea data-testid="mdxeditor">
 *   with controlled value + onChange wiring.  This lets the tests verify props,
 *   onChange plumbing, and save/reassembly without touching MDXEditor internals.
 *
 * Test coverage:
 *   1. Loads + sections split + schema guidance present for brief fixture
 *   2. Edit → Save PUTs reassembled markdown (byte-exact fixture assert) + dirty gating
 *   3. Save failure stays + toasts error
 *   4. Back with dirty → window.confirm prompt (confirmed: leaves; cancelled: stays)
 *   5. JSON format → read-only pre + "JSON editing arrives later" note
 *   6. 404 (not found) → "Not created yet" + Create affordance calling onRegenerate
 *   7. Loading state
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type { Bridge, ArtifactContent } from "../ui/lib/bridge.js";
import { BridgeError } from "../ui/lib/bridge.js";
import { ArtifactEditor, parseSections, assembleSections } from "../ui/screens/ArtifactEditor.js";
import { useAppStore } from "../ui/stores/app.js";
import { ARTIFACT_SECTIONS, GENERIC_SECTION_GUIDANCE } from "../ui/lib/artifact-schemas.js";
import { renderWithProviders } from "./test-utils.js";

// ─── MDXEditor mock ──────────────────────────────────────────────────────────
// A thin textarea stub: wires markdown → value and onChange.  Replaces the
// real editor entirely for jsdom tests — the editor's own internals aren't ours.

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Five-section brief fixture matching the schema exactly. */
const BRIEF_CONTENT = [
  "## Overview",
  "Overview content.",
  "",
  "## Audience & insight",
  "Audience content.",
  "",
  "## Goals & success metrics",
  "Goals content.",
  "",
  "## Scope & constraints",
  "Scope content.",
  "",
  "## Risks & open questions",
  "Risks content.",
].join("\n");

/** Expected assembled content after editing Overview → "Edited overview.\n" */
const BRIEF_CONTENT_EDITED_OVERVIEW = [
  "## Overview",
  "Edited overview.",
  "",
  "## Audience & insight",
  "Audience content.",
  "",
  "## Goals & success metrics",
  "Goals content.",
  "",
  "## Scope & constraints",
  "Scope content.",
  "",
  "## Risks & open questions",
  "Risks content.",
].join("\n");

const BRIEF_ARTIFACT: ArtifactContent = {
  key: "brief",
  path: "/home/user/meridian/brief.md",
  format: "markdown",
  content: BRIEF_CONTENT,
};

const JSON_ARTIFACT: ArtifactContent = {
  key: "tokens",
  path: "/home/user/meridian/design/token-set.json",
  format: "json",
  content: '{"colors":{"primary":"#5B5BD6"}}',
};

// ─── Fake bridge factory ─────────────────────────────────────────────────────

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
    getArtifact: vi.fn().mockResolvedValue(BRIEF_ARTIFACT),
    putArtifact: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

// ─── Default props ─────────────────────────────────────────────────────────

function makeProps(
  overrides: Partial<Parameters<typeof ArtifactEditor>[0]> = {},
): Parameters<typeof ArtifactEditor>[0] {
  return {
    artifactKey: "brief",
    label: "Brief",
    status: "up-to-date",
    bridge: makeBridge(),
    onBack: vi.fn(),
    onRegenerate: vi.fn(),
    ...overrides,
  };
}

// ─── Store reset ─────────────────────────────────────────────────────────────

beforeEach(() => {
  useAppStore.setState({
    connection: {
      status: "connected",
      endpoint: "http://localhost:3779",
      repoPath: "/home/user/meridian",
      mode: "local",
    },
    fileInfo: null,
    snapshot: null,
    toasts: [],
  });
});

afterEach(cleanup);

// ─── Pure-function unit tests ─────────────────────────────────────────────────

describe("parseSections / assembleSections — round-trip", () => {
  it("parses the five-section brief fixture into 5 named sections", () => {
    const sections = parseSections(BRIEF_CONTENT);
    expect(sections).toHaveLength(5);
    expect(sections[0]?.title).toBe("Overview");
    expect(sections[1]?.title).toBe("Audience & insight");
    expect(sections[2]?.title).toBe("Goals & success metrics");
    expect(sections[3]?.title).toBe("Scope & constraints");
    expect(sections[4]?.title).toBe("Risks & open questions");
  });

  it("section bodies are correctly extracted (Overview body = 'Overview content.\\n')", () => {
    const sections = parseSections(BRIEF_CONTENT);
    expect(sections[0]?.currentBody).toBe("Overview content.\n");
    expect(sections[4]?.currentBody).toBe("Risks content.");
  });

  it("assembleSections is the inverse of parseSections (lossless round-trip)", () => {
    const sections = parseSections(BRIEF_CONTENT);
    expect(assembleSections(sections)).toBe(BRIEF_CONTENT);
  });

  it("preamble content (before first ##) becomes a null-title section", () => {
    const content = "Preamble text.\n\n## Section One\nBody.";
    const sections = parseSections(content);
    expect(sections[0]?.title).toBeNull();
    expect(sections[0]?.currentBody).toBe("Preamble text.\n");
    expect(sections[1]?.title).toBe("Section One");
  });

  it("content with no headings yields a single preamble section", () => {
    const sections = parseSections("Just plain text.");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBeNull();
    expect(sections[0]?.currentBody).toBe("Just plain text.");
  });

  it("sections a bold-label brief (no ## headings) — the common seeded shape", () => {
    const brief =
      "# UXFactory Cloud — product brief\n" +
      "**Problem.** AI tools generate untrusted screens.\n" +
      "**Audience.** Design leads and PMs.\n" +
      "**Success outcomes.**\n1. First verified run in 30 min.";
    const sections = parseSections(brief);
    // H1 preamble + three bold-label sections.
    expect(sections.map((s) => s.title)).toEqual([null, "Problem", "Audience", "Success outcomes"]);
    expect(sections[1]?.currentBody).toBe("AI tools generate untrusted screens.");
    expect(sections[3]?.currentBody).toBe("1. First verified run in 30 min.");
  });

  it("plain text with no headings and no bold labels stays a single preamble", () => {
    const sections = parseSections("Just plain prose, no structure.");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBeNull();
  });
});

// ─── Loading state ─────────────────────────────────────────────────────────

describe("Loading state", () => {
  it("shows 'Loading…' before getArtifact resolves", async () => {
    const bridge = makeBridge({
      getArtifact: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    await renderWithProviders(<ArtifactEditor {...makeProps({ bridge })} />, { initialEntries: ["/tabs/artifacts"] });
    expect(screen.getByTestId("artifact-editor-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});

// ─── Editor loads + sections split with schema guidance ────────────────────

describe("Loads and renders brief sections with schema guidance", () => {
  it("renders five section cards after brief artifact loads", async () => {
    await renderWithProviders(<ArtifactEditor {...makeProps()} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() => {
      expect(screen.getByTestId("section-card-Overview")).toBeInTheDocument();
    });

    for (const title of ARTIFACT_SECTIONS["brief"]!.map((s) => s.title)) {
      expect(screen.getByTestId(`section-card-${title}`)).toBeInTheDocument();
    }
  });

  it("each section header carries an info tooltip with its schema guidance", async () => {
    await renderWithProviders(<ArtifactEditor {...makeProps()} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() => {
      expect(screen.getByTestId("section-card-Overview")).toBeInTheDocument();
    });

    // Guidance moved from always-visible text into a per-section info tooltip;
    // the trigger's aria-label carries "<title>: <guidance>" for reachability.
    for (const { title, guidance } of ARTIFACT_SECTIONS["brief"]!) {
      expect(screen.getByLabelText(`${title}: ${guidance}`)).toBeInTheDocument();
    }
  });

  it("renders one MDXEditor textarea per section (5 total)", async () => {
    await renderWithProviders(<ArtifactEditor {...makeProps()} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() => {
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5);
    });
  });

  it("first textarea value matches parsed Overview body", async () => {
    await renderWithProviders(<ArtifactEditor {...makeProps()} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() => {
      const textareas = screen.getAllByTestId("mdxeditor");
      expect(textareas[0]).toHaveValue("Overview content.\n");
    });
  });

  it("unknown section titles show GENERIC_SECTION_GUIDANCE", async () => {
    const unknownSectionContent = "## Unknown Section\nSome body.";
    const bridge = makeBridge({
      getArtifact: vi.fn().mockResolvedValue({
        ...BRIEF_ARTIFACT,
        content: unknownSectionContent,
      }),
    });
    await renderWithProviders(<ArtifactEditor {...makeProps({ bridge })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() => {
      expect(
        screen.getByLabelText(`Unknown Section: ${GENERIC_SECTION_GUIDANCE}`),
      ).toBeInTheDocument();
    });
  });
});

// ─── Save — dirty gating + byte-exact PUT ──────────────────────────────────

describe("Save — dirty gating + byte-exact PUT", () => {
  it("Save button is disabled when no edits have been made", async () => {
    await renderWithProviders(<ArtifactEditor {...makeProps()} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    const saveBtn = screen.getByRole("button", { name: /Save artifact/i });
    expect(saveBtn).toBeDisabled();
  });

  it("editing a section enables the Save button", async () => {
    await renderWithProviders(<ArtifactEditor {...makeProps()} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    const textareas = screen.getAllByTestId("mdxeditor");
    fireEvent.focus(textareas[0]!);
    fireEvent.change(textareas[0]!, { target: { value: "Edited overview.\n" } });

    expect(
      screen.getByRole("button", { name: /Save artifact/i }),
    ).not.toBeDisabled();
  });

  it("Save calls putArtifact with byte-exact reassembled markdown", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<ArtifactEditor {...makeProps({ bridge })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    // Edit the first section (Overview) body
    const textareas = screen.getAllByTestId("mdxeditor");
    fireEvent.focus(textareas[0]!);
    fireEvent.change(textareas[0]!, { target: { value: "Edited overview.\n" } });

    await user.click(screen.getByRole("button", { name: /Save artifact/i }));

    await waitFor(() => {
      expect(bridge.putArtifact).toHaveBeenCalledWith(
        "brief",
        BRIEF_CONTENT_EDITED_OVERVIEW,
      );
    });
  });

  it("successful Save fires 'Saved' toast and disables the Save button", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderWithProviders(<ArtifactEditor {...makeProps({ bridge })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    const textareas = screen.getAllByTestId("mdxeditor");
    fireEvent.focus(textareas[0]!);
    fireEvent.change(textareas[0]!, { target: { value: "Edited overview.\n" } });
    await user.click(screen.getByRole("button", { name: /Save artifact/i }));

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts;
      expect(toasts.some((t) => t.message === "Saved")).toBe(true);
    });

    // After save, dirty state is cleared → Save disabled again
    expect(
      screen.getByRole("button", { name: /Save artifact/i }),
    ).toBeDisabled();
  });
});

// ─── Save failure ─────────────────────────────────────────────────────────────

describe("Save failure — toasts error + stays in editor", () => {
  it("putArtifact failure toasts an error and keeps the editor open", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      putArtifact: vi.fn().mockRejectedValue(new Error("network error")),
    });
    await renderWithProviders(<ArtifactEditor {...makeProps({ bridge })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    const textareas = screen.getAllByTestId("mdxeditor");
    fireEvent.focus(textareas[0]!);
    fireEvent.change(textareas[0]!, { target: { value: "Edited.\n" } });
    await user.click(screen.getByRole("button", { name: /Save artifact/i }));

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts;
      expect(toasts.some((t) => t.message.includes("Save failed"))).toBe(true);
    });

    // Editor stays open with section cards still visible
    expect(screen.getByTestId("section-card-Overview")).toBeInTheDocument();
  });
});

// ─── Back with dirty confirm ─────────────────────────────────────────────────

// ─── Mount-time normalization must not dirty the editor ─────────────────────
// The real MDXEditor fires onChange at mount when it normalizes the source
// markdown (heading/table serialization, trailing newlines). A change arriving
// before the user ever focused the section is that normalization: it must
// re-baseline, not enable Save or arm the unsaved-changes prompt.

describe("Mount-time normalization — onChange before focus does not dirty", () => {
  it("change without prior focus keeps Save disabled", async () => {
    await renderWithProviders(<ArtifactEditor {...makeProps()} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    // No focus event — this is the editor normalizing, not the user typing.
    fireEvent.change(screen.getAllByTestId("mdxeditor")[0]!, {
      target: { value: "Normalized overview.\n" },
    });

    expect(
      screen.getByRole("button", { name: /Save artifact/i }),
    ).toBeDisabled();
  });

  it("change without prior focus does not arm the Back confirm", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onBack = vi.fn();

    await renderWithProviders(<ArtifactEditor {...makeProps({ onBack })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    fireEvent.change(screen.getAllByTestId("mdxeditor")[0]!, {
      target: { value: "Normalized overview.\n" },
    });

    await user.click(screen.getByRole("button", { name: /Back to artifacts/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("user edit after focus still dirties (Save enabled)", async () => {
    await renderWithProviders(<ArtifactEditor {...makeProps()} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    // Normalization first…
    fireEvent.change(screen.getAllByTestId("mdxeditor")[0]!, {
      target: { value: "Normalized overview.\n" },
    });
    // …then a real user edit.
    fireEvent.focus(screen.getAllByTestId("mdxeditor")[0]!);
    fireEvent.change(screen.getAllByTestId("mdxeditor")[0]!, {
      target: { value: "User edited overview.\n" },
    });

    expect(
      screen.getByRole("button", { name: /Save artifact/i }),
    ).not.toBeDisabled();
  });
});

describe("Back with dirty changes — window.confirm guard", () => {
  it("Back with unsaved changes prompts window.confirm", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    await renderWithProviders(<ArtifactEditor {...makeProps()} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    fireEvent.focus(screen.getAllByTestId("mdxeditor")[0]!);
    fireEvent.change(screen.getAllByTestId("mdxeditor")[0]!, {
      target: { value: "Dirty." },
    });

    await user.click(screen.getByRole("button", { name: /Back to artifacts/i }));

    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("confirm = true → calls onBack", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onBack = vi.fn();

    await renderWithProviders(<ArtifactEditor {...makeProps({ onBack })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    fireEvent.focus(screen.getAllByTestId("mdxeditor")[0]!);
    fireEvent.change(screen.getAllByTestId("mdxeditor")[0]!, {
      target: { value: "Dirty." },
    });

    await user.click(screen.getByRole("button", { name: /Back to artifacts/i }));

    expect(onBack).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("confirm = false → stays in editor (onBack NOT called)", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onBack = vi.fn();

    await renderWithProviders(<ArtifactEditor {...makeProps({ onBack })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    fireEvent.focus(screen.getAllByTestId("mdxeditor")[0]!);
    fireEvent.change(screen.getAllByTestId("mdxeditor")[0]!, {
      target: { value: "Dirty." },
    });

    await user.click(screen.getByRole("button", { name: /Back to artifacts/i }));

    expect(onBack).not.toHaveBeenCalled();
    // Still in editor
    expect(screen.getByTestId("section-card-Overview")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("Back without changes calls onBack immediately (no confirm)", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    const onBack = vi.fn();

    await renderWithProviders(<ArtifactEditor {...makeProps({ onBack })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    await user.click(screen.getByRole("button", { name: /Back to artifacts/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

// ─── JSON artifacts — read-only view ─────────────────────────────────────────

describe("JSON artifact — read-only pretty view", () => {
  it("renders a pretty-printed JSON pre element", async () => {
    const bridge = makeBridge({
      getArtifact: vi.fn().mockResolvedValue(JSON_ARTIFACT),
    });

    await renderWithProviders(
      <ArtifactEditor
        {...makeProps({ artifactKey: "tokens", label: "Tokens", bridge })}
      />,
      { initialEntries: ["/tabs/artifacts"] },
    );

    await waitFor(() => {
      expect(screen.getByTestId("json-preview")).toBeInTheDocument();
    });

    const pre = screen.getByTestId("json-preview");
    expect(pre.textContent).toContain('"primary"');
  });

  it("shows the 'JSON editing arrives later' note", async () => {
    const bridge = makeBridge({
      getArtifact: vi.fn().mockResolvedValue(JSON_ARTIFACT),
    });

    await renderWithProviders(
      <ArtifactEditor
        {...makeProps({ artifactKey: "tokens", label: "Tokens", bridge })}
      />,
      { initialEntries: ["/tabs/artifacts"] },
    );

    await waitFor(() => {
      expect(screen.getByTestId("json-editing-note")).toBeInTheDocument();
    });
  });

  it("does NOT render MDXEditor textareas for JSON artifacts", async () => {
    const bridge = makeBridge({
      getArtifact: vi.fn().mockResolvedValue(JSON_ARTIFACT),
    });

    await renderWithProviders(
      <ArtifactEditor
        {...makeProps({ artifactKey: "tokens", label: "Tokens", bridge })}
      />,
      { initialEntries: ["/tabs/artifacts"] },
    );

    await waitFor(() =>
      expect(screen.getByTestId("json-preview")).toBeInTheDocument(),
    );

    expect(screen.queryAllByTestId("mdxeditor")).toHaveLength(0);
  });

  it("Regenerate button is present for JSON artifacts", async () => {
    const onRegenerate = vi.fn();
    const user = userEvent.setup();
    const bridge = makeBridge({
      getArtifact: vi.fn().mockResolvedValue(JSON_ARTIFACT),
    });

    await renderWithProviders(
      <ArtifactEditor
        {...makeProps({ artifactKey: "tokens", label: "Tokens", bridge, onRegenerate })}
      />,
      { initialEntries: ["/tabs/artifacts"] },
    );

    await waitFor(() =>
      expect(screen.getByTestId("json-preview")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Regenerate/i }));
    expect(onRegenerate).toHaveBeenCalled();
  });
});

// ─── 404 — not created yet ────────────────────────────────────────────────────

describe("404 (missing artifact) — Create affordance", () => {
  it("renders 'Not created yet.' when getArtifact returns 404", async () => {
    const bridge = makeBridge({
      getArtifact: vi
        .fn()
        .mockRejectedValue(new BridgeError(404, { error: "not found" })),
    });

    await renderWithProviders(<ArtifactEditor {...makeProps({ bridge })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() => {
      expect(screen.getByTestId("not-created-yet")).toBeInTheDocument();
    });

    expect(screen.getByText("Not created yet.")).toBeInTheDocument();
  });

  it("Create affordance button calls onRegenerate", async () => {
    const onRegenerate = vi.fn();
    const user = userEvent.setup();
    const bridge = makeBridge({
      getArtifact: vi
        .fn()
        .mockRejectedValue(new BridgeError(404, { error: "not found" })),
    });

    await renderWithProviders(<ArtifactEditor {...makeProps({ bridge, onRegenerate })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Create Brief/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Create Brief/i }));
    expect(onRegenerate).toHaveBeenCalled();
  });
});

// ─── Regenerate ───────────────────────────────────────────────────────────────

describe("Regenerate button (markdown editor)", () => {
  it("clicking Regenerate calls onRegenerate", async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    await renderWithProviders(<ArtifactEditor {...makeProps({ onRegenerate })} />, { initialEntries: ["/tabs/artifacts"] });

    await waitFor(() =>
      expect(screen.getAllByTestId("mdxeditor")).toHaveLength(5),
    );

    await user.click(screen.getByRole("button", { name: /Regenerate/i }));
    expect(onRegenerate).toHaveBeenCalled();
  });
});
