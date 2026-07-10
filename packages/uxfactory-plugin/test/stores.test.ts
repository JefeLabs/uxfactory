/**
 * stores.test.ts — Unit tests for the Zustand stores:
 *   - app.ts  (connection decisions; navigation is now owned by the router)
 *   - wizard.ts (suggestFor, userEdited guard)
 *   - runs.ts  (cap 20, persist roundtrip via fake bus)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "../ui/stores/app.js";
import { useWizardStore, suggestFor } from "../ui/stores/wizard.js";
import { useRunsStore, DEFAULT_DEVICE_CONFIG } from "../ui/stores/runs.js";
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
    selectNodes: vi.fn(),
    postReview: vi.fn(),
  };

  return { bus, storage };
}

// ─── App store — connection ────────────────────────────────────────────────────
// Navigation is owned by the router; these tests only verify store state changes.

describe("app store — connectSucceeded", () => {
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
      toasts: [],
    });
  });

  it("stores the snapshot and marks connected when hasClassification is true", () => {
    const snapshot = makeSnapshot({ hasClassification: true });
    useAppStore.getState().connectSucceeded(snapshot, "/repo");
    expect(useAppStore.getState().connection.status).toBe("connected");
  });

  it("stores the snapshot and marks connected when hasClassification is false", () => {
    const snapshot = makeSnapshot({ hasClassification: false });
    useAppStore.getState().connectSucceeded(snapshot, "/repo");
    expect(useAppStore.getState().connection.status).toBe("connected");
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

  it("seeds workers from snapshot.workers and resets a dismissed banner", () => {
    useAppStore.setState({ workerBannerDismissed: true });
    const snapshot = makeSnapshot({ workers: [{ connectedAt: 1 }] });
    useAppStore.getState().connectSucceeded(snapshot, "/repo");
    expect(useAppStore.getState().workers).toEqual([{ connectedAt: 1 }]);
    expect(useAppStore.getState().workerBannerDismissed).toBe(false);
  });

  it("sets workers to null when the snapshot has no workers field (unknown, not uncovered)", () => {
    useAppStore.setState({ workers: [{ connectedAt: 1 }] });
    const snapshot = makeSnapshot({ hasClassification: false });
    useAppStore.getState().connectSucceeded(snapshot, "/repo");
    expect(useAppStore.getState().workers).toBeNull();
  });

  it("resets workers to null on connectFailed (stale presence must not survive a lost connection)", () => {
    useAppStore.setState({ workers: [{ connectedAt: 1 }] });
    useAppStore.getState().connectFailed("Bridge not reachable");
    expect(useAppStore.getState().workers).toBeNull();
  });
});

describe("app store — misc actions", () => {
  beforeEach(() => {
    useAppStore.setState({
      connection: { status: "none", endpoint: "http://localhost:3779", repoPath: "", mode: "local" },
      fileInfo: null,
      snapshot: null,
      toasts: [],
    });
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

describe("app store — pendingGenerate (Requirements → Prompt combined handoff)", () => {
  beforeEach(() => {
    useAppStore.setState({ pendingGenerate: null });
  });

  it("pendingGenerate: set/consume returns once and clears", () => {
    useAppStore.getState().setPendingGenerate({ storyRefs: ["S-01"], unitType: "story", prompt: "p" });
    expect(useAppStore.getState().consumePendingGenerate()).toEqual({
      storyRefs: ["S-01"],
      unitType: "story",
      prompt: "p",
    });
    expect(useAppStore.getState().pendingGenerate).toBeNull();
    expect(useAppStore.getState().consumePendingGenerate()).toBeNull();
  });

  it("pendingGenerate: storyRefs alone (unitType/prompt both optional)", () => {
    useAppStore.getState().setPendingGenerate({ storyRefs: ["S-01", "S-02"] });
    expect(useAppStore.getState().consumePendingGenerate()).toEqual({
      storyRefs: ["S-01", "S-02"],
    });
    expect(useAppStore.getState().consumePendingGenerate()).toBeNull();
  });
});


describe("app store — cancelReconnect", () => {
  beforeEach(() => {
    useAppStore.setState({
      connection: {
        status: "reconnecting",
        endpoint: "http://localhost:3779",
        repoPath: "/home/user/demo-shop",
        mode: "local",
      },
      fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
      snapshot: null,
      toasts: [],
    });
  });

  it("sets connection.status to 'none'", () => {
    useAppStore.getState().cancelReconnect();
    expect(useAppStore.getState().connection.status).toBe("none");
  });

  it("preserves other connection fields (endpoint, repoPath, mode)", () => {
    useAppStore.getState().cancelReconnect();
    const { connection } = useAppStore.getState();
    expect(connection.endpoint).toBe("http://localhost:3779");
    expect(connection.repoPath).toBe("/home/user/demo-shop");
    expect(connection.mode).toBe("local");
  });

  it("resets workers to null (stale presence must not survive a lost connection)", () => {
    useAppStore.setState({ workers: [{ connectedAt: 1 }] });
    useAppStore.getState().cancelReconnect();
    expect(useAppStore.getState().workers).toBeNull();
  });

  it("after cancelReconnect, a late connectSucceeded is blocked by the race guard", () => {
    useAppStore.getState().cancelReconnect();
    // Simulate the race guard from main.tsx: only call connectSucceeded if status is "reconnecting"
    if (useAppStore.getState().connection.status === "reconnecting") {
      useAppStore.getState().connectSucceeded(makeSnapshot({ hasClassification: true }), "/repo");
    }
    // Guard should have prevented connectSucceeded from running
    expect(useAppStore.getState().connection.status).toBe("none");
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

  it("applySuggestions overwrites un-edited fields", () => {
    useWizardStore.getState().applySuggestions({ category: "webapp" });
    // webapp suggests high flow
    expect(useWizardStore.getState().defaults.flow).toBe("high");
  });

  it("applySuggestions does NOT overwrite user-edited fields", () => {
    // User edits visual to "low"
    useWizardStore.getState().setDefault("visual", "low");
    // Now re-suggest with a classification that suggests "medium" visual
    useWizardStore.getState().applySuggestions({ category: undefined });
    // visual should still be "low" (user's choice), not "medium" (suggestion)
    expect(useWizardStore.getState().defaults.visual).toBe("low");
  });

  it("applySuggestions overwrites fields the user has NOT edited", () => {
    // User edits visual (only)
    useWizardStore.getState().setDefault("visual", "low");
    // Re-suggest with marketing category (flow: low, coverage: low)
    useWizardStore.getState().applySuggestions({ category: "marketing" });
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

  it("applySuggestions (canonical) overwrites un-edited fields", () => {
    useWizardStore.getState().applySuggestions({ category: "webapp" });
    // webapp suggests high flow
    expect(useWizardStore.getState().defaults.flow).toBe("high");
  });

  it("applySuggestions does NOT overwrite user-edited fields", () => {
    useWizardStore.getState().setDefault("visual", "low");
    useWizardStore.getState().applySuggestions({ category: undefined });
    expect(useWizardStore.getState().defaults.visual).toBe("low");
  });

  it("applySuggestions produces consistent results across calls", () => {
    // Both calls with the same classification should produce the same result.
    useWizardStore.getState().applySuggestions({ category: "webapp" });
    const firstPass = { ...useWizardStore.getState().defaults };

    // Reset to same initial state
    useWizardStore.setState((s) => ({
      defaults: {
        style: "mix",
        visual: "high",
        editorial: "medium",
        flow: "low",
        coverage: "medium",
        coherence: "high",
      },
      userEdited: {
        style: false, visual: false, editorial: false,
        flow: false, coverage: false, coherence: false,
      },
      classification: s.classification,
    }));
    useWizardStore.getState().applySuggestions({ category: "webapp" });
    const secondPass = { ...useWizardStore.getState().defaults };

    expect(firstPass).toEqual(secondPass);
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
    // Legacy "webapp" normalizes to its taxonomy id on prefill.
    expect(classification.category).toBe("productivity-collaboration");
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

  it("progress carries the loop fields (iter/gate/status/findings) when present", () => {
    useRunsStore.getState().add({ id: "run-9", prompt: "p", unitType: "page", platforms: [] });
    useRunsStore.getState().progress("run-9", {
      phase: "gate", note: "revising", iter: 4, gate: "render-coverage", status: "fail", findings: 3,
    });
    const run = useRunsStore.getState().runs.find((r) => r.id === "run-9");
    expect(run?.progress).toMatchObject({ phase: "gate", iter: 4, status: "fail", findings: 3 });
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

  it("complete stores nodeIds from the landing report when provided", () => {
    useRunsStore.getState().add({ id: "run-1", prompt: "foo", unitType: "page", platforms: [] });
    useRunsStore.getState().complete("run-1", "checked", undefined, ["1:10", "1:11"]);
    const run = useRunsStore.getState().runs.find((r: RunEntry) => r.id === "run-1");
    expect(run?.nodeIds).toEqual(["1:10", "1:11"]);
  });

  it("complete without nodeIds preserves previously stored nodeIds", () => {
    useRunsStore.getState().add({ id: "run-1", prompt: "foo", unitType: "page", platforms: [] });
    useRunsStore.getState().complete("run-1", "checked", undefined, ["1:10"]);
    // A later completion event (e.g. re-check) without nodeIds keeps them.
    useRunsStore.getState().complete("run-1", "warnings", ["a11y.hit-target"]);
    const run = useRunsStore.getState().runs.find((r: RunEntry) => r.id === "run-1");
    expect(run?.nodeIds).toEqual(["1:10"]);
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

  it("RunEntry.nodeIds round-trips through persist (additive field)", async () => {
    // Persist a completed run carrying landing-report node ids…
    const { bus, storage } = makeFakeBus();
    const teardown = await useRunsStore.getState().hydrate(bus);

    useRunsStore.getState().add({
      id: "run-nodes",
      prompt: "run with node ids",
      unitType: "page",
      platforms: ["desktop"],
    });
    useRunsStore.getState().complete("run-nodes", "checked", undefined, ["7:1", "7:2"]);
    await Promise.resolve();
    teardown?.();

    const stored = storage["runs:v1:file-abc123"] as RunEntry[];
    expect(stored[0]?.nodeIds).toEqual(["7:1", "7:2"]);

    // …then hydrate a fresh store from that storage and get them back.
    useRunsStore.setState({ runs: [] });
    const { bus: bus2 } = makeFakeBus({ "runs:v1:file-abc123": stored });
    const teardown2 = await useRunsStore.getState().hydrate(bus2);
    teardown2?.();

    expect(useRunsStore.getState().runs[0]?.nodeIds).toEqual(["7:1", "7:2"]);
  });

  it("hydrates legacy entries without nodeIds cleanly (field is optional)", async () => {
    const legacyRuns = [
      {
        id: "legacy-1",
        prompt: "pre-nodeIds run",
        unitType: "page",
        platforms: ["desktop"],
        status: "checked" as const,
      },
    ];
    const { bus } = makeFakeBus({ "runs:v1:file-abc123": legacyRuns });
    const teardown = await useRunsStore.getState().hydrate(bus);
    teardown?.();

    expect(useRunsStore.getState().runs[0]?.id).toBe("legacy-1");
    expect(useRunsStore.getState().runs[0]?.nodeIds).toBeUndefined();
  });
});

describe("runs store — device config", () => {
  beforeEach(() => {
    useRunsStore.setState({ runs: [], deviceConfig: DEFAULT_DEVICE_CONFIG });
  });

  it("defaults to Laptop / iPad / iPhone sizes", () => {
    const cfg = useRunsStore.getState().deviceConfig;
    expect(cfg.desktop).toEqual({ name: "Laptop", width: 1440, height: 900 });
    expect(cfg.tablet).toEqual({ name: "iPad Mini/Air", width: 768, height: 1024 });
    expect(cfg.mobile).toEqual({ name: "iPhone 14/15", width: 390, height: 844 });
  });

  it("hydrates deviceConfig from bus storage, merging over defaults", async () => {
    const { bus } = makeFakeBus({
      "devices:v1:file-abc123": {
        mobile: { name: "iPhone Pro Max", width: 430, height: 932 },
      },
    });
    const teardown = await useRunsStore.getState().hydrate(bus);
    teardown?.();

    expect(useRunsStore.getState().deviceConfig.mobile).toEqual({
      name: "iPhone Pro Max",
      width: 430,
      height: 932,
    });
    // Untouched categories keep their defaults.
    expect(useRunsStore.getState().deviceConfig.desktop.width).toBe(1440);
  });

  it("persists deviceConfig when setDeviceConfig runs after hydrate", async () => {
    const { bus, storage } = makeFakeBus();
    const teardown = await useRunsStore.getState().hydrate(bus);

    useRunsStore.getState().setDeviceConfig({
      desktop: { name: "Desktop HD", width: 1920, height: 1080 },
    });
    await Promise.resolve();
    teardown?.();

    const stored = storage["devices:v1:file-abc123"] as { desktop?: { width: number } };
    expect(stored?.desktop?.width).toBe(1920);
  });
});
