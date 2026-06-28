import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateMap, MAINTAINED_FIELDS } from "../src/drift/map-schema.js";
import type { ComponentMap } from "../src/drift/map-schema.js";
import { readMap, writeMap, serializeMap, setAutoFilled } from "../src/drift/map-io.js";

let dir: string;
let mapPath: string;

const sampleMap: ComponentMap = {
  version: 1,
  components: [
    {
      component: "api-gateway",
      spec: "deployment.uxfactory.json",
      node: "api-gateway",
      source: {
        kind: "terraform",
        ref: "infra/main.tf#aws_apigatewayv2_api.main",
        compare: { name: "name" },
      },
    },
  ],
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uxf-map-"));
  mapPath = path.join(dir, "uxfactory.map.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("validateMap", () => {
  it("accepts a well-formed map", () => {
    expect(validateMap(sampleMap)).toEqual({ valid: true, errors: [] });
  });

  it("exposes the maintained-field allowlist", () => {
    expect(MAINTAINED_FIELDS).toEqual(["component", "spec", "node", "source"]);
  });

  it("rejects a wrong version", () => {
    const r = validateMap({ version: 2, components: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/version/);
  });

  it("rejects a non-array components", () => {
    expect(validateMap({ version: 1, components: {} }).valid).toBe(false);
  });

  it("rejects an entry missing source.ref", () => {
    const r = validateMap({
      version: 1,
      components: [{ component: "a", spec: "s.json", node: "a", source: { kind: "k8s" } }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/source\.ref/);
  });

  it("rejects an unknown source.kind", () => {
    const r = validateMap({
      version: 1,
      components: [
        { component: "a", spec: "s.json", node: "a", source: { kind: "helm", ref: "x#y" } },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/kind/);
  });

  it("rejects a non-string compare value", () => {
    const r = validateMap({
      version: 1,
      components: [
        {
          component: "a",
          spec: "s.json",
          node: "a",
          source: { kind: "k8s", ref: "x#y", compare: { port: 8080 } },
        },
      ],
    });
    expect(r.valid).toBe(false);
  });
});

describe("readMap", () => {
  it("returns null when the file is absent", async () => {
    expect(await readMap(mapPath)).toBeNull();
  });

  it("round-trips a valid map", async () => {
    await writeMap(mapPath, sampleMap);
    expect(await readMap(mapPath)).toEqual(sampleMap);
  });

  it("throws on malformed JSON", async () => {
    await writeFile(mapPath, "{ not json", "utf8");
    await expect(readMap(mapPath)).rejects.toThrow(/parse/);
  });

  it("throws on a structurally invalid map", async () => {
    await writeFile(mapPath, JSON.stringify({ version: 9, components: [] }), "utf8");
    await expect(readMap(mapPath)).rejects.toThrow(/invalid/);
  });
});

describe("writeMap / serializeMap", () => {
  it("preserves unknown top-level entry keys on writeMap round-trip (Fix 3)", async () => {
    // Simulate a hand-edited map with an extra `note` field not in the TypeScript schema
    const rawWithNote = {
      version: 1 as const,
      components: [
        {
          component: "api-gateway",
          spec: "deployment.uxfactory.json",
          node: "api-gateway",
          source: {
            kind: "terraform" as const,
            ref: "infra/main.tf#aws_x.main",
          },
          note: "custom maintainer annotation",
        },
      ],
    };
    await writeMap(mapPath, rawWithNote as unknown as ComponentMap);
    const text = await readFile(mapPath, "utf8");
    const parsed = JSON.parse(text) as { components: Array<Record<string, unknown>> };
    expect(parsed.components[0]?.note).toBe("custom maintainer annotation");
  });

  it("preserves unknown source-level keys on writeMap round-trip (Fix 3)", async () => {
    const rawWithSourceExtra = {
      version: 1 as const,
      components: [
        {
          component: "api-gateway",
          spec: "deployment.uxfactory.json",
          node: "api-gateway",
          source: {
            kind: "terraform" as const,
            ref: "infra/main.tf#aws_x.main",
            annotation: "future-field",
          },
        },
      ],
    };
    await writeMap(mapPath, rawWithSourceExtra as unknown as ComponentMap);
    const text = await readFile(mapPath, "utf8");
    const parsed = JSON.parse(text) as {
      components: Array<{ source: Record<string, unknown> }>;
    };
    expect(parsed.components[0]?.source.annotation).toBe("future-field");
  });

  it("emits a stable key order, 2-space indent, and a trailing newline", () => {
    const text = serializeMap(sampleMap);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('  "version": 1');
    // maintained keys appear in canonical order before the auto-filled ones
    const compIdx = text.indexOf('"component"');
    const specIdx = text.indexOf('"spec"');
    const nodeIdx = text.indexOf('"node"');
    const sourceIdx = text.indexOf('"source"');
    expect(compIdx).toBeLessThan(specIdx);
    expect(specIdx).toBeLessThan(nodeIdx);
    expect(nodeIdx).toBeLessThan(sourceIdx);
  });

  it("is deterministic regardless of input key order", () => {
    const shuffled: ComponentMap = {
      version: 1,
      components: [
        {
          // intentionally out of canonical order
          node: "api-gateway",
          source: {
            ref: "infra/main.tf#aws_apigatewayv2_api.main",
            kind: "terraform",
            compare: { name: "name" },
          },
          spec: "deployment.uxfactory.json",
          component: "api-gateway",
        } as unknown as ComponentMap["components"][number],
      ],
    };
    expect(serializeMap(shuffled)).toBe(serializeMap(sampleMap));
  });
});

describe("setAutoFilled", () => {
  it("fills figmaId/lastSynced on the named component", () => {
    const next = setAutoFilled(sampleMap, "api-gateway", {
      figmaId: "12:34",
      lastSynced: { render: "r_1", commit: "abc123" },
    });
    expect(next.components[0]?.figmaId).toBe("12:34");
    expect(next.components[0]?.lastSynced).toEqual({ render: "r_1", commit: "abc123" });
  });

  it("never mutates the input and never touches maintained fields (byte-identical)", () => {
    const before = JSON.stringify(sampleMap.components[0]);
    const next = setAutoFilled(sampleMap, "api-gateway", { figmaId: "12:34" });
    // input untouched
    expect(JSON.stringify(sampleMap.components[0])).toBe(before);
    // maintained fields are the SAME references on the new entry
    const a = sampleMap.components[0]!;
    const b = next.components[0]!;
    expect(b.source).toBe(a.source);
    expect(b.component).toBe(a.component);
    expect(b.spec).toBe(a.spec);
    expect(b.node).toBe(a.node);
    // and serialize byte-identically for the maintained subset
    const maintained = (e: typeof a) =>
      JSON.stringify({ component: e.component, spec: e.spec, node: e.node, source: e.source });
    expect(maintained(b)).toBe(maintained(a));
  });

  it("leaves other components alone (same reference)", () => {
    const two: ComponentMap = {
      version: 1,
      components: [
        sampleMap.components[0]!,
        {
          component: "db",
          spec: "deployment.uxfactory.json",
          node: "db",
          source: { kind: "compose", ref: "compose.yaml#db" },
        },
      ],
    };
    const next = setAutoFilled(two, "api-gateway", { figmaId: "9:9" });
    expect(next.components[1]).toBe(two.components[1]);
  });
});
