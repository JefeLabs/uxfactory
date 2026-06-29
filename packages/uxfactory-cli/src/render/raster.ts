import { Resvg } from "@resvg/resvg-js";

/**
 * Rasterize an SVG document to a PNG Buffer (PRD §12, approximate raster).
 * This is the ONLY module that imports `@resvg/resvg-js`. Output is deterministic
 * within a process for a given SVG; text fidelity depends on the host's available
 * fonts — the documented approximation. Renders at the SVG's intrinsic size over a
 * white background.
 */
export function svgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    background: "white",
    fitTo: { mode: "original" },
  });
  return resvg.render().asPng();
}
