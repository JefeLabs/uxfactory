import { describe, it, expect, beforeEach } from "vitest";
import { coverageFor, anyUncovered, ENQUEUEABLE_KINDS } from "../ui/lib/worker-coverage.js";
import { useAppStore } from "../ui/stores/app.js";

describe("coverageFor", () => {
  it("null workers → unknown (older bridge / no snapshot yet)", () => {
    expect(coverageFor(null, "generate-artifact")).toBe("unknown");
  });
  it("empty list → uncovered", () => {
    expect(coverageFor([], "generate-artifact")).toBe("uncovered");
  });
  it("an all-kinds worker (kinds absent) covers every kind", () => {
    expect(coverageFor([{ connectedAt: 1 }], "generate-design")).toBe("covered");
  });
  it("a kind-filtered worker covers only its kinds", () => {
    const workers = [{ kinds: ["generate-artifact"], connectedAt: 1 }];
    expect(coverageFor(workers, "generate-artifact")).toBe("covered");
    expect(coverageFor(workers, "generate-design")).toBe("uncovered");
  });
  it("ENQUEUEABLE_KINDS names the two panel job kinds", () => {
    expect([...ENQUEUEABLE_KINDS]).toEqual(["generate-artifact", "generate-design"]);
  });
  it("anyUncovered: null → false; partial pool → true; all-kinds worker → false", () => {
    expect(anyUncovered(null)).toBe(false);
    expect(anyUncovered([{ kinds: ["generate-artifact"], connectedAt: 1 }])).toBe(true);
    expect(anyUncovered([{ connectedAt: 1 }])).toBe(false);
  });
});

describe("app store workers slice", () => {
  beforeEach(() => {
    useAppStore.setState({ workers: null, workerBannerDismissed: false });
  });

  it("workersChanged stores the list; dismissWorkerBanner sticks while state is unchanged", () => {
    useAppStore.getState().workersChanged([]);
    expect(useAppStore.getState().workers).toEqual([]);
    useAppStore.getState().dismissWorkerBanner();
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);
    useAppStore.getState().workersChanged([]); // still uncovered — no fresh outage
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);
  });

  it("a fresh covered→uncovered transition re-arms a dismissed banner", () => {
    useAppStore.getState().workersChanged([]);
    useAppStore.getState().dismissWorkerBanner();
    useAppStore.getState().workersChanged([{ connectedAt: 1 }]); // worker arrives → covered
    useAppStore.getState().workersChanged([]);                    // worker drops → fresh outage
    expect(useAppStore.getState().workerBannerDismissed).toBe(false);
  });
});
