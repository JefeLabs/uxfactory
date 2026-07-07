/**
 * story-schema.test.ts — canonical story files (nested ACs, decision 6).
 *
 * Source: .plans/artifact-schemas-and-elicitation.md `stories` section +
 * docs/superpowers/plans/2026-07-06-stories-nested-acs-migration.md.
 *
 * Two shapes normalize into one canonical story: the PRD shape
 * (storyId/actor/want/soThat, GWT ACs) and a legacy member (id/role/goal/
 * benefit, statement+impliedState ACs). `storyToEngine` renders the engine
 * shape the deterministic gate consumes.
 */
import { describe, it, expect } from "vitest";
import {
  parseStoryFile,
  storyToEngine,
  deriveImpliedState,
} from "../src/story-schema.js";

const CANONICAL = {
  storyId: "browse-faq",
  actor: "returning-buyer",
  want: "read answers to common questions",
  soThat: "I can get a quick answer without contacting support",
  featureRef: null,
  acceptanceCriteria: [
    {
      acId: "AC-001",
      given: "the FAQ page is open",
      when: "the visitor scans the list",
      then: "five questions with answers are visible",
      checkable: "auto",
    },
  ],
  status: "registered",
};

const LEGACY_MEMBER = {
  id: "contact-support",
  role: "visitor",
  goal: "reach the support team",
  benefit: "so I can get help beyond the FAQ",
  acceptanceCriteria: [
    { statement: "a contact banner is visible on the page", impliedState: "success" },
  ],
};

describe("parseStoryFile", () => {
  it("accepts a canonical story verbatim", () => {
    const result = parseStoryFile(CANONICAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.story.storyId).toBe("browse-faq");
    expect(result.story.actor).toBe("returning-buyer");
    expect(result.story.acceptanceCriteria[0]).toMatchObject({
      acId: "AC-001",
      then: "five questions with answers are visible",
      checkable: "auto",
    });
  });

  it("normalizes a legacy member: id→storyId, role→actor, goal→want, benefit→soThat", () => {
    const result = parseStoryFile(LEGACY_MEMBER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.story).toMatchObject({
      storyId: "contact-support",
      actor: "visitor",
      want: "reach the support team",
      soThat: "so I can get help beyond the FAQ",
      featureRef: null,
      status: "registered",
    });
    // Legacy ACs keep their statement + explicit impliedState; auto-checkable
    // (they gated deterministically before, they keep gating).
    expect(result.story.acceptanceCriteria[0]).toMatchObject({
      acId: "AC-001",
      statement: "a contact banner is visible on the page",
      impliedState: "success",
      checkable: "auto",
    });
  });

  it("numbers legacy AC ids in order (AC-001, AC-002, …)", () => {
    const result = parseStoryFile({
      ...LEGACY_MEMBER,
      acceptanceCriteria: [
        { statement: "a", impliedState: "success" },
        { statement: "b", impliedState: "error" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.story.acceptanceCriteria.map((ac) => ac.acId)).toEqual(["AC-001", "AC-002"]);
  });

  it("rejects a story without an id", () => {
    const result = parseStoryFile({ actor: "x", want: "y" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/storyId/);
  });

  it("rejects non-object input and non-array ACs", () => {
    expect(parseStoryFile(null).ok).toBe(false);
    expect(parseStoryFile("story").ok).toBe(false);
    expect(parseStoryFile({ storyId: "s", acceptanceCriteria: "nope" }).ok).toBe(false);
  });

  it("defaults optional prose fields to empty strings and status to draft", () => {
    const result = parseStoryFile({ storyId: "bare" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.story).toMatchObject({
      actor: "",
      want: "",
      soThat: "",
      featureRef: null,
      acceptanceCriteria: [],
      status: "draft",
    });
  });
});

describe("storyToEngine", () => {
  it("maps canonical fields back to the engine shape the gate reads", () => {
    const parsed = parseStoryFile(CANONICAL);
    if (!parsed.ok) throw new Error("parse failed");
    const engine = storyToEngine(parsed.story);
    expect(engine).toMatchObject({
      id: "browse-faq",
      role: "returning-buyer",
      goal: "read answers to common questions",
      benefit: "I can get a quick answer without contacting support",
    });
  });

  it("renders a GWT triple into a single engine statement", () => {
    const parsed = parseStoryFile(CANONICAL);
    if (!parsed.ok) throw new Error("parse failed");
    const engine = storyToEngine(parsed.story);
    expect(engine.acceptanceCriteria[0].statement).toBe(
      "Given the FAQ page is open, when the visitor scans the list, then five questions with answers are visible",
    );
  });

  it("prefers an explicit statement over GWT rendering", () => {
    const parsed = parseStoryFile(LEGACY_MEMBER);
    if (!parsed.ok) throw new Error("parse failed");
    expect(storyToEngine(parsed.story).acceptanceCriteria[0].statement).toBe(
      "a contact banner is visible on the page",
    );
  });

  it("honors explicit impliedState and derives it from text when absent", () => {
    const parsed = parseStoryFile({
      storyId: "s",
      acceptanceCriteria: [
        { acId: "AC-001", then: "an error banner explains what failed", checkable: "auto" },
        { acId: "AC-002", then: "the empty list shows a friendly prompt", checkable: "auto" },
        { acId: "AC-003", then: "a loading skeleton appears", checkable: "auto" },
        { acId: "AC-004", then: "the confirmation is visible", checkable: "auto" },
        { acId: "AC-005", then: "anything", impliedState: "edge", checkable: "auto" },
      ],
    });
    if (!parsed.ok) throw new Error("parse failed");
    const states = storyToEngine(parsed.story).acceptanceCriteria.map((ac) => ac.impliedState);
    expect(states).toEqual(["error", "empty", "loading", "success", "edge"]);
  });

  it("carries the acId through so the gate can bind coverage to a specific AC", () => {
    const parsed = parseStoryFile(CANONICAL);
    if (!parsed.ok) throw new Error("parse failed");
    expect(storyToEngine(parsed.story).acceptanceCriteria[0].acId).toBe("AC-001");
  });

  it("carries checkable through so the gate can exclude manual ACs", () => {
    const parsed = parseStoryFile({
      storyId: "s",
      acceptanceCriteria: [
        { acId: "AC-001", then: "it feels trustworthy", checkable: "manual" },
      ],
    });
    if (!parsed.ok) throw new Error("parse failed");
    expect(storyToEngine(parsed.story).acceptanceCriteria[0].checkable).toBe("manual");
  });
});

describe("deriveImpliedState", () => {
  it("keyword table: error > empty > loading, else success", () => {
    expect(deriveImpliedState("an error toast appears")).toBe("error");
    expect(deriveImpliedState("the empty state renders")).toBe("empty");
    expect(deriveImpliedState("a loading spinner shows")).toBe("loading");
    expect(deriveImpliedState("the receipt is visible")).toBe("success");
  });
});
