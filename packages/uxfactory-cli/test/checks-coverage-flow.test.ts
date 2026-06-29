import { describe, it, expect } from "vitest";
import { requirementCoverage, coverageOrphans, flowReachability } from "../src/batch/checks.js";
import type { LoadedSpec, StorySet, Flow } from "../src/batch/checks.js";
import type { DesignSpec, Spec } from "@uxfactory/spec";

function loaded(spec: Spec, file = "a.uxfactory.json"): LoadedSpec {
  return { file, spec };
}

const stories: StorySet = {
  stories: [
    {
      id: "story-1",
      role: "user",
      goal: "see home",
      benefit: "fast",
      acceptanceCriteria: [
        { statement: "no data yet", impliedState: "empty" },
        { statement: "loaded", impliedState: "success" },
      ],
    },
  ],
};

const covered: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "story-1-home",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { type: "shape", name: "home-empty-state", x: 0, y: 0, width: 10, height: 10 },
        { type: "shape", name: "home-success-view", x: 0, y: 20, width: 10, height: 10 },
      ],
    },
  ],
};

describe("requirementCoverage", () => {
  it("skips and declares when no stories are provided", () => {
    expect(requirementCoverage([loaded(covered)], null).status).toBe("skip");
  });

  it("passes when every story + AC-state is covered and no frame is story-less", () => {
    const r = requirementCoverage([loaded(covered)], stories);
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("flags an uncovered story (no frame names the id)", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [{ name: "story-1-home", x: 0, y: 0, width: 1, height: 1, children: [] }],
    };
    const twoStories: StorySet = {
      stories: [
        ...stories.stories,
        { id: "story-2", role: "u", goal: "g", benefit: "b", acceptanceCriteria: [] },
      ],
    };
    const r = requirementCoverage([loaded(spec)], twoStories);
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.ref === "story-2")).toBe(true);
  });

  it("flags an uncovered AC-state (no node names the state keyword)", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "story-1-home",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          children: [{ type: "shape", name: "home-empty-state", x: 0, y: 0, width: 1, height: 1 }],
        },
      ],
    };
    const r = requirementCoverage([loaded(spec)], stories); // "success" state missing
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.detail.includes("success"))).toBe(true);
  });

  it("story-less frames are now advisory (Fix 3): requirementCoverage passes, coverageOrphans reports them", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "story-1-home",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          children: [
            { type: "shape", name: "home-empty-state", x: 0, y: 0, width: 1, height: 1 },
            { type: "shape", name: "home-success-view", x: 0, y: 10, width: 1, height: 1 },
          ],
        },
        { name: "orphan-frame", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
    };
    // Fix 3: requirementCoverage (must) no longer gates on story-less frames
    const r = requirementCoverage([loaded(spec)], stories);
    expect(r.status).toBe("pass");
    expect(r.findings.some((f) => f.ref === "orphan-frame")).toBe(false);
    // advisory coverageOrphans reports the orphan without gating
    const orphans = coverageOrphans([loaded(spec)], stories);
    expect(orphans.severity).toBe("advisory");
    expect(orphans.status).toBe("fail");
    expect(orphans.findings.some((f) => f.ref === "orphan-frame")).toBe(true);
  });
});

// --- Fix 1 regression: AC-state coverage is PER-STORY, not batch-global -----------

describe("requirementCoverage — Fix 1: per-story AC scoping", () => {
  it("story A's empty AC is NOT satisfied by story B's empty-state node", () => {
    const twoStorySpec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "story-a-home",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          children: [{ type: "shape", name: "loading-spinner", x: 0, y: 0, width: 1, height: 1 }],
        },
        {
          name: "story-b-home",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          children: [{ type: "shape", name: "empty-state", x: 0, y: 0, width: 1, height: 1 }],
        },
      ],
    };
    const twoStories: StorySet = {
      stories: [
        {
          id: "story-a",
          role: "u",
          goal: "g",
          benefit: "b",
          acceptanceCriteria: [{ statement: "no data", impliedState: "empty" }],
        },
        {
          id: "story-b",
          role: "u",
          goal: "g",
          benefit: "b",
          acceptanceCriteria: [],
        },
      ],
    };
    const r = requirementCoverage([loaded(twoStorySpec)], twoStories);
    // story-a's "empty" AC must be UNCOVERED: empty-state lives in story-b's frame
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.detail.includes("empty") && f.ref === "story-a")).toBe(true);
  });
});

// --- Fix 2 regression: story-id matching must be TOKEN-BOUNDARY ---------------------

describe("requirementCoverage — Fix 2: token-boundary story-id matching", () => {
  it("story-1 is UNCOVERED when only story-12-home exists (no substring false-match)", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [{ name: "story-12-home", x: 0, y: 0, width: 1, height: 1, children: [] }],
    };
    const twoStories: StorySet = {
      stories: [
        { id: "story-1", role: "u", goal: "g", benefit: "b", acceptanceCriteria: [] },
        { id: "story-12", role: "u", goal: "g", benefit: "b", acceptanceCriteria: [] },
      ],
    };
    const r = requirementCoverage([loaded(spec)], twoStories);
    expect(r.status).toBe("fail");
    // story-1 must be flagged as uncovered
    expect(r.findings.some((f) => f.ref === "story-1")).toBe(true);
    // story-12 must NOT be flagged (it is covered)
    expect(r.findings.some((f) => f.ref === "story-12")).toBe(false);
  });
});

describe("flowReachability (advisory)", () => {
  it("skips and declares when no flow is provided", () => {
    expect(flowReachability([loaded(covered)], null).status).toBe("skip");
  });

  it("is advisory and passes when each consecutive step is reachable via connectors", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "a", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "b", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "c", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
      connectors: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };
    const flow: Flow = { steps: ["a", "b", "c"] };
    const r = flowReachability([loaded(spec)], flow);
    expect(r.severity).toBe("advisory");
    expect(r.status).toBe("pass");
  });

  it("reports an advisory finding when a step pair is unreachable", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "a", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "b", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
      connectors: [],
    };
    const flow: Flow = { steps: ["a", "b"] };
    const r = flowReachability([loaded(spec)], flow);
    expect(r.severity).toBe("advisory");
    expect(r.status).toBe("fail");
    expect(r.findings.length).toBe(1);
  });
});
