// @vitest-environment jsdom
/**
 * screen-persona-manager.test.tsx — RTL tests for the in-panel Persona
 * Manager (Task 4): lists GET /project/personas, adds a new instance
 * (client-minted next `P-NN` id, opened blank in JsonFormEditor and saved via
 * the injected saveFn → PUT), edits an existing instance the same way, and
 * deletes (confirm → DELETE). Every mutation invalidates the personas list so
 * the manager reflects the bridge's current state after each round trip.
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { Bridge, PersonaRecord } from "../ui/lib/bridge.js";
import { PersonaManager, nextPersonaId } from "../ui/screens/PersonaManager.js";
import { useAppStore } from "../ui/stores/app.js";
import { renderWithProviders } from "./test-utils.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PERSONAS: PersonaRecord[] = [
  { personaId: "P-01", name: "Ana", archetype: "operator", goals: ["ship"], frustrations: [] },
  { personaId: "P-02", name: "Ben", archetype: "lead", goals: [], frustrations: [] },
];

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
    enqueue: vi.fn().mockResolvedValue({ id: "req-1" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue(null),
    getPersonas: vi.fn().mockResolvedValue({ personas: PERSONAS.map((p) => ({ ...p })) }),
    putPersona: vi.fn().mockResolvedValue({ ok: true }),
    deletePersona: vi.fn().mockResolvedValue({ ok: true, deleted: true }),
    ...overrides,
  };
}

function renderManager(bridge: Bridge, onBack: () => void = vi.fn()) {
  return renderWithProviders(<PersonaManager bridge={bridge} onBack={onBack} />, {
    initialEntries: ["/tabs/artifacts"],
  });
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

// ─── nextPersonaId (pure) ───────────────────────────────────────────────────

describe("nextPersonaId", () => {
  it("mints P-01 for an empty set", () => {
    expect(nextPersonaId([])).toBe("P-01");
  });

  it("mints one past the current max", () => {
    expect(nextPersonaId(["P-01", "P-02"])).toBe("P-03");
  });

  it("skips gaps — mints one past the max, not the first hole", () => {
    expect(nextPersonaId(["P-01", "P-05"])).toBe("P-06");
  });

  it("ignores malformed ids as 0 rather than throwing", () => {
    expect(nextPersonaId(["not-an-id", "P-03"])).toBe("P-04");
  });
});

// ─── List ───────────────────────────────────────────────────────────────────

describe("PersonaManager — list", () => {
  it("lists personas from the bridge with name/archetype/goals+frustrations counts", async () => {
    const bridge = makeBridge();
    await renderManager(bridge);

    await waitFor(() => expect(screen.getByText("Ana")).toBeInTheDocument());
    expect(screen.getByText("Ben")).toBeInTheDocument();
    expect(screen.getByText(/operator.*1 goal.*0 frustrations/)).toBeInTheDocument();
    expect(screen.getByText(/lead.*0 goals.*0 frustrations/)).toBeInTheDocument();
    expect(screen.getByText("Manage personas (2)")).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no personas", async () => {
    const bridge = makeBridge({ getPersonas: vi.fn().mockResolvedValue({ personas: [] }) });
    await renderManager(bridge);

    await waitFor(() =>
      expect(screen.getByText(/No personas yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Manage personas (0)")).toBeInTheDocument();
  });

  it("Back button calls onBack", async () => {
    const onBack = vi.fn();
    await renderManager(makeBridge(), onBack);
    await waitFor(() => screen.getByText("Ana"));

    fireEvent.click(screen.getByRole("button", { name: /back to artifacts/i }));
    expect(onBack).toHaveBeenCalled();
  });
});

// ─── Add ────────────────────────────────────────────────────────────────────

describe("PersonaManager — add", () => {
  it("mints the next P-NN id and saves a new persona via putPersona", async () => {
    const bridge = makeBridge();
    await renderManager(bridge);
    await waitFor(() => screen.getByText("Ana"));

    fireEvent.click(screen.getByRole("button", { name: /add persona/i }));

    // A blank JsonFormEditor instance opens (personas field spec).
    const nameInput = await screen.findByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Cara" } });
    fireEvent.click(screen.getByRole("button", { name: "Save artifact" }));

    await waitFor(() =>
      expect(bridge.putPersona).toHaveBeenCalledWith(
        "P-03",
        expect.objectContaining({ name: "Cara" }),
      ),
    );
  });

  it("returns to the list and refetches after a successful add", async () => {
    const bridge = makeBridge();
    await renderManager(bridge);
    await waitFor(() => screen.getByText("Ana"));
    const initialCalls = (bridge.getPersonas as ReturnType<typeof vi.fn>).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /add persona/i }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Cara" } });
    fireEvent.click(screen.getByRole("button", { name: "Save artifact" }));

    await waitFor(() =>
      expect(screen.getByText("Manage personas (2)")).toBeInTheDocument(),
    );
    expect((bridge.getPersonas as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      initialCalls,
    );
  });
});

// ─── Edit ───────────────────────────────────────────────────────────────────

describe("PersonaManager — edit", () => {
  it("opens an existing persona and saves the edit via putPersona (existing id, not a new one)", async () => {
    const bridge = makeBridge();
    await renderManager(bridge);
    await waitFor(() => screen.getByText("Ana"));

    fireEvent.click(screen.getByRole("button", { name: "Edit Ana" }));

    const nameInput = await screen.findByLabelText("Name");
    expect((nameInput as HTMLInputElement).value).toBe("Ana");
    fireEvent.change(nameInput, { target: { value: "Ana Extra" } });
    fireEvent.click(screen.getByRole("button", { name: "Save artifact" }));

    await waitFor(() =>
      expect(bridge.putPersona).toHaveBeenCalledWith(
        "P-01",
        expect.objectContaining({ name: "Ana Extra" }),
      ),
    );
  });

  it("hides Regenerate inside the per-instance editor (whole-set regenerate stays on the inventory row)", async () => {
    const bridge = makeBridge();
    await renderManager(bridge);
    await waitFor(() => screen.getByText("Ana"));

    fireEvent.click(screen.getByRole("button", { name: "Edit Ana" }));
    await screen.findByLabelText("Name");

    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });
});

// ─── Delete ─────────────────────────────────────────────────────────────────

describe("PersonaManager — delete", () => {
  it("confirms, then calls deletePersona with the row's id and refetches", async () => {
    const bridge = makeBridge();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderManager(bridge);
    await waitFor(() => screen.getByText("Ben"));

    fireEvent.click(screen.getByRole("button", { name: "Delete Ben" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Ben"));
    await waitFor(() => expect(bridge.deletePersona).toHaveBeenCalledWith("P-02"));
    confirmSpy.mockRestore();
  });

  it("does nothing when the confirm is dismissed", async () => {
    const bridge = makeBridge();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderManager(bridge);
    await waitFor(() => screen.getByText("Ben"));

    fireEvent.click(screen.getByRole("button", { name: "Delete Ben" }));

    expect(bridge.deletePersona).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("toasts a failure message when deletePersona rejects", async () => {
    const bridge = makeBridge({
      deletePersona: vi.fn().mockRejectedValue(new Error("network")),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderManager(bridge);
    await waitFor(() => screen.getByText("Ben"));

    fireEvent.click(screen.getByRole("button", { name: "Delete Ben" }));

    await waitFor(() =>
      expect(useAppStore.getState().toasts.some((t) => /Delete failed/i.test(t.message))).toBe(
        true,
      ),
    );
  });
});

// ─── Legacy bridge ──────────────────────────────────────────────────────────

describe("PersonaManager — legacy bridge (no personas routes)", () => {
  it("shows a version message instead of a broken list, and hides Add", async () => {
    const bridge = makeBridge({ getPersonas: undefined, putPersona: undefined, deletePersona: undefined });
    await renderManager(bridge);

    expect(
      await screen.findByText(/Persona editing requires a newer bridge version/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add persona/i })).toBeNull();
  });
});
