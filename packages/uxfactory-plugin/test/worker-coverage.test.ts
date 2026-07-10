import { describe, it, expect, beforeEach } from "vitest";
import { coverageFor, anyUncovered, ENQUEUEABLE_KINDS } from "../ui/lib/worker-coverage.js";
import { useAppStore } from "../ui/stores/app.js";

describe("coverageFor", () => {
  it("null workers → unknown (older bridge / no snapshot yet)", () => {
    expect(coverageFor(null, "generate-artifact", null)).toBe("unknown");
  });
  it("empty list → uncovered", () => {
    expect(coverageFor([], "generate-artifact", null)).toBe("uncovered");
  });
  it("an all-kinds worker (kinds absent) covers every kind", () => {
    expect(coverageFor([{ connectedAt: 1 }], "generate-design", null)).toBe("covered");
  });
  it("a kind-filtered worker covers only its kinds", () => {
    const workers = [{ kinds: ["generate-artifact"], connectedAt: 1 }];
    expect(coverageFor(workers, "generate-artifact", null)).toBe("covered");
    expect(coverageFor(workers, "generate-design", null)).toBe("uncovered");
  });
  it("ENQUEUEABLE_KINDS names the two panel job kinds", () => {
    expect([...ENQUEUEABLE_KINDS]).toEqual(["generate-artifact", "generate-design"]);
  });
  it("anyUncovered: null → false; partial pool → true; all-kinds worker → false", () => {
    expect(anyUncovered(null, null)).toBe(false);
    expect(anyUncovered([{ kinds: ["generate-artifact"], connectedAt: 1 }], null)).toBe(true);
    expect(anyUncovered([{ connectedAt: 1 }], null)).toBe(false);
  });
  it("managed with no kinds covers every kind even with zero live workers", () => {
    expect(coverageFor([], "generate-artifact", {})).toBe("covered");
    expect(coverageFor(null, "generate-design", {})).toBe("covered");
  });
  it("managed with kinds covers only those kinds", () => {
    expect(coverageFor([], "generate-artifact", { kinds: ["generate-artifact"] })).toBe("covered");
    expect(coverageFor([], "generate-design", { kinds: ["generate-artifact"] })).toBe("uncovered");
  });
  it("unknown only when BOTH workers and managed are null", () => {
    expect(coverageFor(null, "generate-artifact", null)).toBe("unknown");
    expect(coverageFor([], "generate-artifact", null)).toBe("uncovered");
  });
});

describe("app store workers slice", () => {
  beforeEach(() => {
    useAppStore.setState({ workers: null, managedWorker: null, workerBannerDismissed: false });
  });

  it("workersChanged stores the list; dismissWorkerBanner sticks while state is unchanged", () => {
    useAppStore.getState().workersChanged([], null);
    expect(useAppStore.getState().workers).toEqual([]);
    useAppStore.getState().dismissWorkerBanner();
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);
    useAppStore.getState().workersChanged([], null); // still uncovered — no fresh outage
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);
  });

  it("a fresh covered→uncovered transition re-arms a dismissed banner", () => {
    useAppStore.getState().workersChanged([], null);
    useAppStore.getState().dismissWorkerBanner();
    useAppStore.getState().workersChanged([{ connectedAt: 1 }], null); // worker arrives → covered
    useAppStore.getState().workersChanged([], null);                    // worker drops → fresh outage
    expect(useAppStore.getState().workerBannerDismissed).toBe(false);
  });

  it("a managed flag arriving does not re-arm, but losing managed while uncovered does arm", () => {
    useAppStore.setState({ workers: [], managedWorker: null, workerBannerDismissed: false });
    useAppStore.getState().workersChanged([], {});   // becomes covered via managed
    useAppStore.getState().workersChanged([], null); // managed lost → fresh outage
    expect(useAppStore.getState().workerBannerDismissed).toBe(false);
  });
});
