import type { IO } from "../src/io.js";
import type { RenderReport } from "@uxfactory/bridge";

/** A capturing IO for assertions; `out`/`err` collect lines. */
export interface CaptureIO extends IO {
  readonly outs: string[];
  readonly errs: string[];
  outText(): string;
  errText(): string;
}

/** Build an IO that records every line written, for command-action assertions. */
export function makeIO(): CaptureIO {
  const outs: string[] = [];
  const errs: string[] = [];
  const io: CaptureIO = {
    out(s: string): void {
      outs.push(s);
    },
    err(s: string): void {
      errs.push(s);
    },
    outs,
    errs,
    outText: () => outs.join("\n"),
    errText: () => errs.join("\n"),
  };
  return io;
}

/** A schema-valid design spec whose single shape matches `makeReport()`'s node. */
export const matchingSpec = {
  editor: "figma",
  frames: [
    {
      name: "f",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { type: "shape", name: "box", x: 10, y: 20, width: 30, height: 40, fill: "#1E88E5" },
      ],
    },
  ],
};

/** A render report shaped to PASS against `matchingSpec` (override `nodes`/`counts` to fail). */
export function makeReport(over: Partial<RenderReport> = {}): RenderReport {
  return {
    renderId: "",
    editor: "figma",
    page: "p",
    pageKey: "0:1",
    fileName: "F",
    fileKey: "k",
    counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
    nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, fill: "#1e88e5" }],
    ...over,
  };
}

/** Simulate the plugin: POST a render report to a live bridge; return the assigned renderId. */
export async function postReport(url: string, report: RenderReport): Promise<string> {
  const res = await fetch(`${url}/rendered`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });
  const body = (await res.json()) as { renderId: string };
  return body.renderId;
}
