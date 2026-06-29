import { TransportError } from "./exit.js";
import type { RenderReport } from "@uxfactory/bridge";

/** Body accepted by the bridge's POST /verify (PRD §10.1). */
export interface VerifyBody {
  spec: unknown;
  renderId?: string;
  tolerance?: { geometryPx: number };
  checks?: string[];
}

/**
 * A thin typed client over the bridge's REST surface, built on the global `fetch`
 * (Node 20+). Every method throws `TransportError` on a network failure or a
 * non-JSON body; `verify` instead returns the raw HTTP status + parsed body so the
 * command can map the status to an exit code.
 */
export class BridgeClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** GET /health → { ok, pending }. Throws TransportError if unreachable or non-JSON. */
  async health(): Promise<{ ok: boolean; pending: number }> {
    const res = await this.request("/health", { method: "GET" });
    return (await this.json(res)) as { ok: boolean; pending: number };
  }

  /** GET /selection → the selection, or null on 404 (no selection yet). */
  async getSelection(): Promise<unknown | null> {
    const res = await this.request("/selection", { method: "GET" });
    if (res.status === 404) return null;
    return this.json(res);
  }

  /** GET /rendered → the latest render report, or null on 404 (no render yet). */
  async getRendered(): Promise<RenderReport | null> {
    const res = await this.request("/rendered", { method: "GET" });
    if (res.status === 404) return null;
    return (await this.json(res)) as RenderReport;
  }

  /** POST /verify → the HTTP status plus the parsed body (caller maps status → exit code). */
  async verify(body: VerifyBody): Promise<{ status: number; body: unknown }> {
    const res = await this.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await this.json(res) };
  }

  /** POST /batch → stage a pre-validated batch (specs + preview refs) for approval. Throws on a non-200. */
  async postBatch(items: { spec: unknown; preview?: string }[]): Promise<{ batchId: string }> {
    const res = await this.request("/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const body = await this.json(res);
    if (res.status !== 200) {
      throw new TransportError(`bridge rejected the batch (HTTP ${res.status})`);
    }
    return body as { batchId: string };
  }

  /**
   * POST /review → relay a ReviewReport to the bridge so the plugin can annotate
   * the canvas (§7.8). Throws TransportError on a network failure or a non-200
   * response (e.g. a 400 if the body is malformed).
   */
  async postReview(report: unknown): Promise<void> {
    const res = await this.request("/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    });
    if (res.status !== 200) {
      throw new TransportError(`bridge rejected the review report (HTTP ${res.status})`);
    }
  }

  private async request(routePath: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${routePath}`, init);
    } catch {
      throw new TransportError(
        `cannot reach bridge at ${this.baseUrl} (is it running? 'uxfactory bridge')`,
      );
    }
  }

  private async json(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new TransportError(`bridge returned a non-JSON response (HTTP ${res.status})`);
    }
  }
}
