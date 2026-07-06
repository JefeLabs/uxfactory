/**
 * migrate-stories.test.ts — `uxfactory migrate-stories` (nested-ACs migration).
 *
 * Splits the legacy `design/acceptance-criteria.json` into one canonical file
 * per story under `.uxfactory/artifacts/stories/`, stubs a persona per
 * distinct legacy role (the actor hard-dependency stays satisfiable), and
 * flips `inputs.stories` in `uxfactory.batch.json` to the directory. The
 * legacy file is the migration source, not waste — it stays in place.
 */
import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateStoriesCmd } from "../src/commands/migrate-stories.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

const LEGACY = {
  stories: [
    {
      id: "browse-faq",
      role: "visitor",
      goal: "read answers to common questions",
      benefit: "so I can get a quick answer",
      acceptanceCriteria: [
        { statement: "five questions with answers are visible", impliedState: "success" },
      ],
    },
    {
      id: "contact-support",
      role: "visitor",
      goal: "reach the support team",
      benefit: "so I can get help beyond the FAQ",
      acceptanceCriteria: [
        { statement: "a contact banner is visible", impliedState: "success" },
      ],
    },
    {
      id: "manage-account",
      role: "member",
      goal: "update my details",
      benefit: "so my info stays current",
      acceptanceCriteria: [],
    },
  ],
};

async function mkProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "uxf-migrate-"));
  await mkdir(path.join(root, "design"), { recursive: true });
  await writeFile(
    path.join(root, "design/acceptance-criteria.json"),
    JSON.stringify(LEGACY, null, 2),
  );
  await writeFile(
    path.join(root, "uxfactory.batch.json"),
    JSON.stringify(
      { version: 1, inputs: { stories: "design/acceptance-criteria.json" }, unit: "page" },
      null,
      2,
    ),
  );
  return root;
}

const readJson = async (p: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;

describe("migrateStoriesCmd", () => {
  it("splits the legacy file into canonical per-story files", async () => {
    const root = await mkProject();
    try {
      const io = makeIO();
      expect(await migrateStoriesCmd({ cwd: root }, io)).toBe(EXIT.OK);
      const story = await readJson(
        path.join(root, ".uxfactory/artifacts/stories/browse-faq.json"),
      );
      expect(story).toMatchObject({
        storyId: "browse-faq",
        actor: "visitor",
        want: "read answers to common questions",
        soThat: "so I can get a quick answer",
        status: "registered",
      });
      const acs = story["acceptanceCriteria"] as Record<string, unknown>[];
      expect(acs[0]).toMatchObject({
        acId: "AC-001",
        statement: "five questions with answers are visible",
        impliedState: "success",
        checkable: "auto",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stubs one persona per distinct legacy role, without clobbering existing ones", async () => {
    const root = await mkProject();
    try {
      await mkdir(path.join(root, ".uxfactory/artifacts/personas"), { recursive: true });
      await writeFile(
        path.join(root, ".uxfactory/artifacts/personas/visitor.json"),
        JSON.stringify({ personaId: "visitor", name: "Curious Visitor", archetype: "hand-authored" }),
      );
      const io = makeIO();
      expect(await migrateStoriesCmd({ cwd: root }, io)).toBe(EXIT.OK);
      // Existing persona untouched; the missing role gets a stub.
      const visitor = await readJson(path.join(root, ".uxfactory/artifacts/personas/visitor.json"));
      expect(visitor["archetype"]).toBe("hand-authored");
      const member = await readJson(path.join(root, ".uxfactory/artifacts/personas/member.json"));
      expect(member).toMatchObject({ personaId: "member", name: "member" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("flips inputs.stories to the directory and leaves the legacy file in place", async () => {
    const root = await mkProject();
    try {
      const io = makeIO();
      expect(await migrateStoriesCmd({ cwd: root }, io)).toBe(EXIT.OK);
      const reg = await readJson(path.join(root, "uxfactory.batch.json"));
      expect((reg["inputs"] as Record<string, unknown>)["stories"]).toBe(
        ".uxfactory/artifacts/stories",
      );
      expect(reg["unit"]).toBe("page"); // untouched fields preserved
      await access(path.join(root, "design/acceptance-criteria.json")); // still there
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is idempotent: a second run reports already-migrated and changes nothing", async () => {
    const root = await mkProject();
    try {
      expect(await migrateStoriesCmd({ cwd: root }, makeIO())).toBe(EXIT.OK);
      const second = makeIO();
      expect(await migrateStoriesCmd({ cwd: root }, second)).toBe(EXIT.OK);
      expect(second.outText()).toMatch(/already/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("setup errors exit TRANSPORT: no registry, or stories input missing/unreadable", async () => {
    const bare = await mkdtemp(path.join(os.tmpdir(), "uxf-migrate-bare-"));
    try {
      const io = makeIO();
      expect(await migrateStoriesCmd({ cwd: bare }, io)).toBe(EXIT.TRANSPORT);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }

    const root = await mkProject();
    try {
      await rm(path.join(root, "design/acceptance-criteria.json"));
      const io = makeIO();
      expect(await migrateStoriesCmd({ cwd: root }, io)).toBe(EXIT.TRANSPORT);
      expect(io.errText()).toMatch(/stories/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
