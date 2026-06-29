import { writeFile } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import { loadSpec, printSpecProblem } from "../spec-file.js";
import { specToSvg } from "../render/svg.js";
import { svgToPng } from "../render/raster.js";
import type { Spec } from "@uxfactory/spec";
import type { IO } from "../io.js";

/** Flags for `uxfactory render`. */
export interface RenderFlags {
  out?: string;
}

/** Default output path: `<spec-basename-without-extension>.png` beside the spec. */
function defaultOut(file: string): string {
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  return path.join(path.dirname(file), `${base}.png`);
}

/**
 * `uxfactory render <spec> --out <file>` — approximate offline raster (PRD §12).
 * No bridge, no plugin, no Figma. Loads + validates the spec, builds a deterministic
 * SVG, then writes raw SVG (`--out *.svg`) or a rasterized PNG (default). Returns
 * EXIT.OK on success; EXIT.TRANSPORT on an invalid/unparseable spec or a write error.
 */
export async function renderCmd(file: string, flags: RenderFlags, io: IO): Promise<number> {
  const loaded = await loadSpec(file);
  if (!loaded.ok) return printSpecProblem(io, loaded);

  const svg = specToSvg(loaded.spec as Spec);
  const out = flags.out ?? defaultOut(file);

  try {
    if (out.toLowerCase().endsWith(".svg")) {
      await writeFile(out, svg, "utf8");
    } else {
      await writeFile(out, svgToPng(svg));
    }
  } catch (err) {
    io.err(`cannot write ${out}: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT.TRANSPORT;
  }

  io.out(out);
  return EXIT.OK;
}
