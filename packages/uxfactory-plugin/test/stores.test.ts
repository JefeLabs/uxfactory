/**
 * stores.test.ts — Unit tests for the Zustand stores:
 *   - app.ts  (routing decisions including hasClassification fork)
 *   - wizard.ts (suggestFor, userEdited guard)
 *   - runs.ts  (cap 20, persist roundtrip via fake bus)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "../ui/stores/app.js";
import { useWizardStore, suggestFor } from "../ui/stores/wizard.js";
import { useRunsStore } from "../ui/stores/runs.js";
import type { RunEntry } from "../ui/stores/runs.js";
import type { ProjectSnapshot } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    name: "Demo Shop",
    root: "/home/user/demo-shop",
    hasClassification: false,
    hasProfile: false,
    classification: null,
    profile: null,
    artifacts: [],
    requirements: [],
    ...overrides,
  };
}

function makeFakeBus(initialStorage: Record<string, unknown> = {}): {
  bus: PluginBus;
  storage: Record<string, unknown>;
} {
  const storage: Record<string, unknown> = { ...initialStorage };

  const bus: PluginBus = {
    storageGet: vi.fn(async (key: string) => storage[key] as never),
    storageSet: vi.fn(async (key: string, value: unknown) => {
      storage[key] = value;
    }),
    fileInfo: vi.fn(async () => ({ name: "Demo Shop", fileKey: "file-abc123" })),
    insertIcon: vi.fn(async () => "node:1"),
    notify: vi.fn(),
    close: vi.fn(),
    onSelection: vi.fn(() => () => {}),
  };

  return { bus, storage };
}

// ─── App store — connection / routing ────────────────────────────────────────

describe("app store — connectSucceeded routing", () => {
  beforeEach(() => {
    // Reset to a clean initial state before each test.
    useAppStore.setState({
      connection: {
        status: "none",
        endpoint: "http://localhost:3779",
        repoPath: "",
        mode: "local",
      },
      fileInfo: null,
      snapshot: null,
      route: { screen: "connect", tab: "prompt" },
      toasts: [],
    });
  });

  it("routes to 'tabs' when snapshot.hasClassification is true", () => {
    const snapshot = makeSnapshot({ hasClassification: true });
    useAppStore.getState().connectSucceeded(snapshot, "/repo");
    expect(useAppStore.getState().route.screen).toBe("tabs");
  });

  it("routes to 'setup-1' when snapshot.hasClassification is false", () => {
    const snapshot = makeSnapshot({ hasClassification: false });
    useAppStore.getState().connectSucceeded(snapshot, "/repo");
    expect(useAppStore.getState().route.screen).toBe("setup-1");
  });

  it("stores the snapshot in state", () => {
    const snapshot = makeSnapshot({ name: "My Project", hasClassification: true });
    useAppStore.getState().connectSucceeded(snapshot, "/repo");
    expect(useAppStore.getState().snapshot?.name).toBe("My Project");
  });

  it("updates repoPath on connectSucceeded", () => {
    const snapshot = makeSnapshot({ hasClassification: false });
    useAppStore.getState().connectSucceeded(snapshot, "/home/user/my-repo");
    expect(useAppStore.getState().connection.repoPath).toBe("/home/user/my-repo");
  });

  it("calls the persist callback with mode, endpoint, repoPath", () => {
    const snapshot = makeSnapshot({ hasClassification: true });
    const persist = vi.fn();
    useAppStore.setState((s) => ({
      connection: { ...s.connection, mode: "local", endpoint: "http://localhost:3779" },
    }));
    useAppStore.getState().connectSucceeded(snapshot, "/my-repo", persist);

    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({
      mode: "local",
      endpoint: "http://localhost:3779",
      repoPath: "/my-repo",
    });
  });

  it("does not call persist when no callback is provided", () => {
    const snapshot = makeSnapshot({ hasClassification: false });
    // Should not throw
    expect(() => {
      useAppStore.getState().connectSucceeded(snapshot, "/repo");
    }).not.toThrow();
  });

  it("sets connection.status to 'connected' on connectSucceeded", () => {
    const snapshot = makeSnapshot({ hasClassification: true });
    useAppStore.getState().connectSucceeded(snapshot, "/repo");
    expect(useAppStore.getState().connection.status).toBe("connected");
  });

  it("sets connection.status to 'error' and adds toast on connectFailed", () => {
    useAppStore.getState().connectFailed("Bridge not reachable");
    const state = useAppStore.getState();
    expect(state.connection.status).toBe("error");
    expect(state.toasts.some((t) => t.message === "Bridge not reachable")).toBe(true);
  });
});

describe("app store — misc actions", () => {
  beforeEach(() => {
    useAppStore.setState({
      connection: { status: "none", endpoint: "http://localhost:3779", repoPath: "", mode: "local" },
      fileInfo: null,
      snapshot: null,
      route: { screen: "connect", tab: "prompt" },
      toasts: [],
    });
  });

  it("goto changes route.screen", () => {
    useAppStore.getState().goto("setup-2");
    expect(useAppStore.getState().route.screen).toBe("setup-2");
  });

  it("setTab changes route.tab", () => {
    useAppStore.getState().setTab("artifacts");
    expect(useAppStore.getState().route.tab).toBe("artifacts");
  });

  it("dismissToast removes the correct toast", () => {
    useAppStore.getState().toast("Hello");
    const id = useAppStore.getState().toasts[0]!.id;
    useAppStore.getState().dismissToast(id);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it("setFileInfo stores file info", () => {
    useAppStore.getState().setFileInfo({ name: "My File", fileKey: "key123" });
    expect(useAppStore.getState().fileInfo).toEqual({ name: "My File", fileKey: "key123" });
  });
});

// ─── Wizard store — suggest + userEdited guard ────────────────────────────────

describe("suggestFor — ecommerce/corporate", () => {
  it("returns the PRD 02 defaults for ecommerce + corporate", () => {
    const suggestion = suggestFor({ category: "ecommerce", industry: "corporate" });
    expect(suggestion).toEqual({
      style: "mix",
      visual: "high",
      editorial: "medium",
      flow: "low",
      coverage: "medium",
      coherence: "high",
    });
  });

  it("returns different defaults for marketing", () => {
    const suggestion = suggestFor({ category: "marketing" });
    expect(suggestion.visual).toBe("high");
    expect(suggestion.flow).toBe("low");
  });

  it("returns deeper flows for webapp", () => {
    const suggestion = suggestFor({ category: "webapp" });
    expect(suggestion.flow).toBe("high");
  });

  it("returns medium defaults for unknown category", () => {
    const suggestion = suggestFor({ category: undefined });
    expect(suggestion.visual).toBe("medium");
    expect(suggestion.coverage).toBe("medium");
  });
});

describe("wizard store — userEdited guard", () => {
  beforeEach(() => {
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
  });

  it("setDefault marks the field as userEdited", () => {
    useWizardStore.getState().setDefault("visual", "low");
    expect(useWizardStore.getState().userEdited.visual).toBe(true);
    expect(useWizardStore.getState().defaults.visual).toBe("low");
  });

  it("applysuggestions overwrites un-edited fields", () => {
    useWizardStore.getState().applysuggestions({ category: "webapp" });
    // webapp suggests high flow
    expect(useWizardStore.getState().defaults.flow).toBe("high");
  });

  it("applysuggestions does NOT overwrite user-edited fields", () => {
    // User edits visual to "low"
    useWizardStore.getState().setDefault("visual", "low");
    // Now re-suggest with a classification that suggests "medium" visual
    useWizardStore.getState().applysuggestions({ category: undefined });
    // visual should still be "low" (user's choice), not "medium" (suggestion)
    expect(useWizardStore.getState().defaults.visual).toBe("low");
  });

  it("applysuggestions overwrites fields the user has NOT edited", () => {
    // User edits visual (only)
    useWizardStore.getState().setDefault("visual", "low");
    // Re-suggest with marketing category (flow: low, coverage: low)
    useWizardStore.getState().applysuggestions({ category: "marketing" });
    // coverage should be updated (not user-edited)
    expect(useWizardStore.getState().defaults.coverage).toBe("low");
  });

  it("clearUserEdited resets all flags to false", () => {
    useWizardStore.getState().setDefault("visual", "low");
    useWizardStore.getState().setDefault("coverage", "high");
    useWizardStore.getState().clearUserEdited();
    const { userEdited } = useWizardStore.getState();
    expect(Object.values(userEdited).every((v) => v === false)).toBe(true);
  });

  it("prefillFrom populates classification from snapshot", () => {
    const snapshot = makeSnapshot({
      classification: {
        category: "webapp",
        industry: "fintech",
        locale: "de-DE",
        platforms: ["desktop"],
        layout: "adaptive",
        ageGroup: "40-64",
      },
    });
    useWizardStore.getState().prefillFrom(snapshot);
    const { classification } = useWizardStore.getState();
    expect(classification.category).toBe("webapp");
    expect(classification.industry).toBe("fintech");
    expect(classification.locale).toBe("de-DE");
    expect(classification.layout).toBe("adaptive");
  });

  it("prefillFrom populates defaults from snapshot.profile", () => {
    const snapshot = makeSnapshot({
      profile: {
        scope: { visual: "low", editorial: "low", flow: "high", coverage: "high" },
        experimental: { coherence: "low" },
      },
    });
    useWizardStore.getState().prefillFrom(snapshot);
    const { defaults } = useWizardStore.getState();
    expect(defaults.visual).toBe("low");
    expect(defaults.flow).toBe("high");
    expect(defaults.coherence).toBe("low");
  });
});

// ─── Runs store — cap + persist roundtrip ────────────────────────────────────

describe("runs store — cap", () => {
  beforeEach(() => {
    useRunsStore.setState({ runs: [] });
  });

  it("caps runs at 20 entries", () => {
    for (let i = 0; i < 25; i++) {
      useRunsStore.getState().add({
        id: `run-${i}`,
        prompt: `prompt ${i}`,
        unitType: "page",
        platforms: ["desktop"],
      });
    }
    expect(useRunsStore.getState().runs).toHaveLength(20);
  });

  it("prepends new runs (newest first)", () => {
    useRunsStore.getState().add({ id: "a", prompt: "first", unitType: "page", platforms: [] });
    useRunsStore.getState().add({ id: "b", prompt: "second", unitType: "page", platforms: [] });
    expect(useRunsStore.getState().runs[0]?.id).toBe("b");
    expect(useRunsStore.getState().runs[1]?.id).toBe("a");
  });

  it("progress updates the matching run", () => {
    useRunsStore.getState().add({ id: "run-1", prompt: "foo", unitType: "page", platforms: [] });
    useRunsStore.getState().progress("run-1", { phase: "rendering", note: "50% done" });
    const run = useRunsStore.getState().runs.find((r: RunEntry) => r.id === "run-1");
    expect(run?.progress).toEqual({ phase: "rendering", note: "50% done" });
  });

  it("complete marks the run with the given status and clears progress", () => {
    useRunsStore.getState().add({ id: "run-1", prompt: "foo", unitType: "page", platforms: [] });
    useRunsStore.getState().progress("run-1", { phase: "checking", note: "..." });
    useRunsStore.getState().complete("run-1", "checked");
    const run = useRunsStore.getState().runs.find((r: RunEntry) => r.id === "run-1");
    expect(run?.status).toBe("checked");
    expect(run?.progress).toBeUndefined();
  });

  it("complete attaches warnings when status is 'warnings'", () => {
    useRunsStore.getState().add({ id: "run-1", prompt: "foo", unitType: "page", platforms: [] });
    useRunsStore.getState().complete("run-1", "warnings", ["contrast.text-min"]);
    const run = useRunsStore.getState().runs.find((r: RunEntry) => r.id === "run-1");
    expect(run?.warnings).toContain("contrast.text-min");
  });
});

describe("runs store — hydrate + persist roundtrip", () => {
  beforeEach(() => {
    useRunsStore.setState({ runs: [] });
  });

  it("hydrates runs from bus storage on hydrate", async () => {
    const storedRuns = [
      {
        id: "stored-1",
        prompt: "previous run",
        unitType: "page",
        platforms: ["desktop"],
        status: "checked" as const,
      },
    ];
    const { bus } = makeFakeBus({ "runs:v1:file-abc123": storedRuns });
    const teardown = await useRunsStore.getState().hydrate(bus);
    teardown?.();

    expect(useRunsStore.getState().runs).toHaveLength(1);
    expect(useRunsStore.getState().runs[0]?.id).toBe("stored-1");
  });

  it("persists runs to bus storage when a run is added after hydrate", async () => {
    const { bus, storage } = makeFakeBus();
    const teardown = await useRunsStore.getState().hydrate(bus);

    useRunsStore.getState().add({
      id: "new-run",
      prompt: "generate homepage",
      unitType: "page",
      platforms: ["desktop"],
    });

    // Allow the async storageSet to complete
    await Promise.resolve();

    expect(bus.storageSet).toHaveBeenCalledWith(
      "runs:v1:file-abc123",
      expect.arrayContaining([
        expect.objectContaining({ id: "new-run" }),
      ]),
    );

    teardown?.();
    // Verify the storage key was actually written
    expect(Array.isArray(storage["runs:v1:file-abc123"])).toBe(true);
  });

  it("caps stored runs at 20 on hydrate", async () => {
    // Seed storage with 25 runs
    const storedRuns = Array.from({ length: 25 }, (_, i) => ({
      id: `run-${i}`,
      prompt: `prompt ${i}`,
      unitType: "page",
      platforms: ["desktop"],
      status: "checked" as const,
    }));
    const { bus } = makeFakeBus({ "runs:v1:file-abc123": storedRuns });
    const teardown = await useRunsStore.getState().hydrate(bus);
    teardown?.();

    expect(useRunsStore.getState().runs).toHaveLength(20);
  });

  it("gracefully handles a fileInfo failure without throwing", async () => {
    const { bus } = makeFakeBus();
    // Override fileInfo to reject
    (bus.fileInfo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no fileInfo"));
    await expect(useRunsStore.getState().hydrate(bus)).resolves.not.toThrow();
  });

  it("starts empty when no stored runs exist", async () => {
    const { bus } = makeFakeBus(); // empty storage
    const teardown = await useRunsStore.getState().hydrate(bus);
    teardown?.();
    expect(useRunsStore.getState().runs).toHaveLength(0);
  });
});
