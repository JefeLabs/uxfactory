/** Options for a Figma REST image export. */
export interface FigmaExportOptions {
  /** Personal access token, sent as the `X-Figma-Token` header. */
  token: string;
  /** The file key (the `:key` in a Figma file URL). */
  fileKey: string;
  /** Node ids to export (e.g. `["1:2", "3:4"]`). */
  ids: string[];
  /** Image format; defaults to `"png"`. */
  format?: "png" | "svg";
  /** Raster scale factor (0.01–4); omitted from the request when absent. */
  scale?: number;
}

/** The parsed `{ images }` map: node id → temporary CDN URL. */
export interface FigmaImageResult {
  images: Record<string, string>;
}

/** The slice of the Fetch API this helper depends on (injectable for tests). */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Figma-accurate, token-gated image export (PRD §12, REST path). Constructs
 * `GET https://api.figma.com/v1/images/<fileKey>?ids=<id,id>&format=<fmt>&scale=<n>`
 * with the `X-Figma-Token` header and returns the parsed `{ images }` map (node id →
 * a temporary CDN URL the caller downloads). This is the pixel-faithful path: it
 * requires a Figma token AND a prior render into the file — the render report (§7.4)
 * carries the page/node keys to pass as `ids`. `fetchImpl` defaults to the global
 * `fetch`. Throws a clear error on a non-200 response or an `err` field in the body.
 */
export async function figmaImageExport(
  opts: FigmaExportOptions,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<FigmaImageResult> {
  const params = new URLSearchParams();
  params.set("ids", opts.ids.join(","));
  params.set("format", opts.format ?? "png");
  if (opts.scale !== undefined) params.set("scale", String(opts.scale));

  const url = `https://api.figma.com/v1/images/${encodeURIComponent(opts.fileKey)}?${params.toString()}`;
  const response = await fetchImpl(url, { headers: { "X-Figma-Token": opts.token } });

  if (!response.ok) {
    throw new Error(`Figma image export failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { images?: Record<string, string>; err?: string | null };
  if (body.err) {
    throw new Error(`Figma image export error: ${body.err}`);
  }
  if (body.images === undefined || body.images === null) {
    throw new Error("Figma image export returned no images");
  }
  return { images: body.images };
}
