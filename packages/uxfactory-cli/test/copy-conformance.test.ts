/**
 * copy-conformance.test.ts — the copy-deck gate (slots + exact text).
 *
 * Design (resolved 2026-07-07): generated HTML claims deck entries via
 * `data-copy="<key>"`; entry keys bind to pages by first segment
 * (`home.hero.headline` → screens/home.html). Every bound entry must be
 * claimed by a visible element whose whitespace-normalized text EQUALS the
 * deck text — the authored copy is the contract, paraphrase is a finding.
 * Claims naming no deck entry and drifted text are findings too.
 */
import { describe, it, expect } from "vitest";
import { copyConformance, runHtmlBatch } from "../src/batch/html-checks.js";
import type { RenderSnapshot } from "../src/batch/html-checks.js";
import { loadCopyDeckInput } from "../src/batch/inputs.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DECK = {
  entries: [
    { key: "home.hero.headline", text: "Ship designs that match intent" },
    { key: "home.hero.cta", text: "Start verifying" },
    { key: "faq.contact.banner", text: "Still stuck? Talk to support." },
  ],
};

const snap = (
  page: string,
  claims: Array<{ key: string; text: string; visible?: boolean }>,
): RenderSnapshot =>
  ({
    page,
    view: "default",
    viewport: { width: 1440, height: 900 },
    screenshot: "x.png",
    ok: true,
    coverChecks: [],
    paintedColors: [],
    axe: [],
    copyClaims: claims.map((c) => ({ key: c.key, text: c.text, visible: c.visible ?? true })),
  }) as unknown as RenderSnapshot;

describe("copyConformance", () => {
  it("passes when every bound entry is claimed visible and text-equal (whitespace-normalized)", () => {
    const r = copyConformance(
      [
        snap("screens/home.html", [
          { key: "home.hero.headline", text: "  Ship designs   that match intent " },
          { key: "home.hero.cta", text: "Start verifying" },
        ]),
      ],
      DECK,
    );
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("keys bind by first segment: faq.* entries never gate a home render", () => {
    const r = copyConformance(
      [
        snap("screens/home.html", [
          { key: "home.hero.headline", text: "Ship designs that match intent" },
          { key: "home.hero.cta", text: "Start verifying" },
        ]),
      ],
      DECK,
    );
    expect(r.findings.some((f) => (f.ref ?? "").includes("faq."))).toBe(false);
    expect(r.status).toBe("pass");
  });

  it("paraphrased text is a finding — the authored copy is the contract", () => {
    const r = copyConformance(
      [
        snap("screens/home.html", [
          { key: "home.hero.headline", text: "Ship designs matching your intent" },
          { key: "home.hero.cta", text: "Start verifying" },
        ]),
      ],
      DECK,
    );
    expect(r.status).toBe("fail");
    const drift = r.findings.find((f) => f.ref === "home.hero.headline@screens/home.html")!;
    expect(drift.detail).toContain("Ship designs that match intent");
  });

  it("an unclaimed bound entry and an invisible claim both fail", () => {
    const r = copyConformance(
      [
        snap("screens/home.html", [
          { key: "home.hero.headline", text: "Ship designs that match intent", visible: false },
        ]),
      ],
      DECK,
    );
    expect(r.status).toBe("fail");
    // headline claimed but invisible; cta never claimed — both findings.
    expect(r.findings.some((f) => (f.ref ?? "").startsWith("home.hero.headline"))).toBe(true);
    expect(r.findings.some((f) => (f.ref ?? "").startsWith("home.hero.cta"))).toBe(true);
  });

  it("a claim naming no deck entry is a finding", () => {
    const r = copyConformance(
      [
        snap("screens/home.html", [
          { key: "home.hero.headline", text: "Ship designs that match intent" },
          { key: "home.hero.cta", text: "Start verifying" },
          { key: "home.hero.ghost", text: "invented" },
        ]),
      ],
      DECK,
    );
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.ref === "home.hero.ghost@screens/home.html")).toBe(true);
  });

  it("satisfaction unions across a page's views (states live on different views)", () => {
    const r = copyConformance(
      [
        snap("screens/home.html", [
          { key: "home.hero.headline", text: "Ship designs that match intent" },
        ]),
        { ...snap("screens/home.html", [{ key: "home.hero.cta", text: "Start verifying" }]), view: "expanded" },
      ],
      DECK,
    );
    expect(r.status).toBe("pass");
  });

  it("skips and declares without a deck; binds in runHtmlBatch only when a deck is present", () => {
    expect(copyConformance([snap("screens/home.html", [])], null).status).toBe("skip");

    const stories = { stories: [] };
    const scope = { visual: "low", editorial: "low", coverage: "low", flow: "low" } as const;
    const without = runHtmlBatch({ snapshots: [snap("screens/home.html", [])], stories, tokens: null, scope: { ...scope } });
    expect(without.checks.find((c) => c.id === "copy-conformance")!.status).toBe("not-owed");

    const withDeck = runHtmlBatch({
      snapshots: [snap("screens/faq.html", [{ key: "faq.contact.banner", text: "Still stuck? Talk to support.", visible: true } as never])],
      stories, tokens: null, copyDeck: DECK, scope: { ...scope },
    });
    const check = withDeck.checks.find((c) => c.id === "copy-conformance")!;
    expect(check.status).toBe("pass");
    expect(check.severity).toBe("must");
  });
});

describe("loadCopyDeckInput", () => {
  it("absent, ok, and broken states", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-copydeck-"));
    try {
      expect((await loadCopyDeckInput(null)).state).toBe("absent");
      const p = path.join(root, "copy-deck.json");
      await writeFile(p, JSON.stringify(DECK));
      const ok = await loadCopyDeckInput(p);
      expect(ok.state).toBe("ok");
      if (ok.state === "ok") expect(ok.value.entries).toHaveLength(3);
      await writeFile(p, JSON.stringify({ entries: [{ key: 1 }] }));
      expect((await loadCopyDeckInput(p)).state).toBe("broken");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
