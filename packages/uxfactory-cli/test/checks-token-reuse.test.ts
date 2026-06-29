import { describe, it, expect } from "vitest";
import { tokenConformance, reuse } from "../src/batch/checks.js";
import type { LoadedSpec, TokenSet } from "../src/batch/checks.js";
import type { DesignSpec, Spec } from "@uxfactory/spec";

function loaded(spec: Spec, file = "a.uxfactory.json"): LoadedSpec {
  return { file, spec };
}

const tokens: TokenSet = { colors: { brand: "#1E88E5", ink: "#111111" } };

const conforming: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "home",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { type: "shape", name: "card", x: 0, y: 0, width: 50, height: 50, fill: "#1e88e5", stroke: "#111111" },
      ],
    },
  ],
};

const adhoc: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "home",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [{ type: "shape", name: "card", x: 0, y: 0, width: 50, height: 50, fill: "#abcdef" }],
    },
  ],
};

describe("tokenConformance", () => {
  it("skips and declares when no token register is provided", () => {
    const r = tokenConformance([loaded(conforming)], null);
    expect(r.status).toBe("skip");
    expect(r.severity).toBe("must");
    expect(r.reason).toBeTruthy();
  });

  it("passes when every fill/stroke normalizes to a registered color", () => {
    const r = tokenConformance([loaded(conforming)], tokens);
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("fails with a finding for an ad-hoc color", () => {
    const r = tokenConformance([loaded(adhoc)], tokens);
    expect(r.status).toBe("fail");
    expect(r.findings.length).toBe(1);
    expect(r.findings[0]!.ref).toBe("#abcdef");
  });
});

describe("reuse", () => {
  it("skips and declares when no reuse specs are provided", () => {
    const r = reuse([loaded(conforming)], null);
    expect(r.status).toBe("skip");
    expect(r.severity).toBe("must");
  });

  it("passes when no batch container duplicates an existing spec", () => {
    const other: DesignSpec = {
      editor: "figma",
      frames: [{ name: "settings", x: 0, y: 0, width: 10, height: 10, children: [] }],
    };
    const r = reuse([loaded(conforming)], [other]);
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("fails when a batch frame duplicates one (same name + shape) in an existing spec", () => {
    const r = reuse([loaded(conforming)], [conforming]);
    expect(r.status).toBe("fail");
    expect(r.findings.length).toBe(1);
    expect(r.findings[0]!.ref).toBe("home");
  });
});
