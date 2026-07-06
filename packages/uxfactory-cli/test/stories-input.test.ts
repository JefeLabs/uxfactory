/**
 * stories-input.test.ts — directory-aware stories input (nested-ACs migration).
 *
 * `inputs.stories` may point at the legacy single file (byte-identical
 * behavior) or at a directory of canonical per-story files
 * (`.uxfactory/artifacts/stories/*.json`) — each member normalizes through
 * @uxfactory/spec's story schema into the one engine StorySet the gate reads.
 * Plus: manual-checkable ACs never gate the implied-state check.
 */
import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadStoriesInput } from "../src/batch/inputs.js";
import { requirementCoverage } from "../src/batch/checks.js";
import type { DesignSpec } from "@uxfactory/spec";
import type { LoadedSpec, StorySet } from "../src/batch/checks.js";

const mkRoot = (): Promise<string> => mkdtemp(path.join(os.tmpdir(), "uxf-stories-"));

const CANONICAL_STORY = {
  storyId: "browse-faq",
  actor: "returning-buyer",
  want: "read answers",
  soThat: "quick help",
  featureRef: null,
  acceptanceCriteria: [
    { acId: "AC-001", given: "page open", when: "visitor scans", then: "five questions visible", checkable: "auto" },
  ],
  status: "registered",
};

const LEGACY_MEMBER = {
  id: "contact-support",
  role: "visitor",
  goal: "reach support",
  benefit: "help beyond the FAQ",
  acceptanceCriteria: [{ statement: "a contact banner is visible", impliedState: "success" }],
};

describe("loadStoriesInput on a directory", () => {
  it("reads every *.json member and normalizes to one engine StorySet, sorted by filename", async () => {
    const root = await mkRoot();
    try {
      const dir = path.join(root, "stories");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "b-contact.json"), JSON.stringify(LEGACY_MEMBER));
      await writeFile(path.join(dir, "a-browse.json"), JSON.stringify(CANONICAL_STORY));
      const result = await loadStoriesInput(dir);
      expect(result.state).toBe("ok");
      if (result.state !== "ok") return;
      expect(result.value.stories.map((s) => s.id)).toEqual(["browse-faq", "contact-support"]);
      // Canonical GWT renders into the engine statement; legacy passes through.
      expect(result.value.stories[0].acceptanceCriteria[0].statement).toBe(
        "Given page open, when visitor scans, then five questions visible",
      );
      expect(result.value.stories[0].role).toBe("returning-buyer");
      expect(result.value.stories[1].acceptanceCriteria[0]).toMatchObject({
        statement: "a contact banner is visible",
        impliedState: "success",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores non-JSON entries; an empty directory is ok with zero stories", async () => {
    const root = await mkRoot();
    try {
      const dir = path.join(root, "stories");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "README.md"), "not a story");
      const result = await loadStoriesInput(dir);
      expect(result.state).toBe("ok");
      if (result.state !== "ok") return;
      expect(result.value.stories).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a malformed member breaks the input and names the offending file", async () => {
    const root = await mkRoot();
    try {
      const dir = path.join(root, "stories");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "good.json"), JSON.stringify(CANONICAL_STORY));
      await writeFile(path.join(dir, "bad.json"), "{not json");
      const result = await loadStoriesInput(dir);
      expect(result.state).toBe("broken");
      if (result.state !== "broken") return;
      expect(result.message).toContain("bad.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a member without a story id breaks the input and names the file", async () => {
    const root = await mkRoot();
    try {
      const dir = path.join(root, "stories");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "orphan.json"), JSON.stringify({ actor: "x" }));
      const result = await loadStoriesInput(dir);
      expect(result.state).toBe("broken");
      if (result.state !== "broken") return;
      expect(result.message).toContain("orphan.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("legacy single-file behavior is unchanged (regression)", async () => {
    const root = await mkRoot();
    try {
      const file = path.join(root, "acceptance-criteria.json");
      await writeFile(file, JSON.stringify({ stories: [LEGACY_MEMBER] }));
      const result = await loadStoriesInput(file);
      expect(result.state).toBe("ok");
      if (result.state !== "ok") return;
      expect(result.value.stories[0].id).toBe("contact-support");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("requirementCoverage with manual ACs", () => {
  const frame = (children: { name: string }[]): LoadedSpec => ({
    file: "a.uxfactory.json",
    spec: {
      editor: "figma",
      frames: [
        {
          name: "story-1-home",
          x: 0, y: 0, width: 200, height: 200,
          children: children.map((c, i) => ({
            type: "shape" as const, name: c.name, x: 0, y: i * 20, width: 10, height: 10,
          })),
        },
      ],
    } as DesignSpec,
  });

  it("manual-checkable ACs never gate the implied-state check", () => {
    const stories: StorySet = {
      stories: [
        {
          id: "story-1",
          role: "user", goal: "g", benefit: "b",
          acceptanceCriteria: [
            // No "error"-named node exists — but this AC is manual, so it must not fail the gate.
            { statement: "it feels trustworthy on error", impliedState: "error", checkable: "manual" },
            { statement: "loaded", impliedState: "success", checkable: "auto" },
          ],
        },
      ],
    };
    const r = requirementCoverage([frame([{ name: "home-success-view" }])], stories);
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("auto (and unmarked legacy) ACs still gate", () => {
    const stories: StorySet = {
      stories: [
        {
          id: "story-1",
          role: "user", goal: "g", benefit: "b",
          acceptanceCriteria: [{ statement: "an error banner appears", impliedState: "error" }],
        },
      ],
    };
    const r = requirementCoverage([frame([{ name: "home-success-view" }])], stories);
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.ref === "story-1")).toBe(true);
  });
});
