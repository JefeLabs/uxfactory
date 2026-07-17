import { TransportError } from "./exit.js";
import type { RenderReport } from "@uxfactory/bridge";
import type { IdentityProposal, NodeManifest } from "@uxfactory/spec";

/**
 * Opaque canvas review request as relayed by the bridge (§14.2).
 * Mirrors the bridge's CanvasRequest without importing from @uxfactory/bridge
 * (which would create a circular dependency).
 */
export interface CanvasRequest {
  snapshot: { source: string; frames: unknown[]; [k: string]: unknown };
  screenshot?: string;
  [k: string]: unknown;
}

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

  /** GET /canvas → the pending canvas review request, or null on 404 (no request yet). */
  async getCanvasRequest(): Promise<CanvasRequest | null> {
    const res = await this.request("/canvas", { method: "GET" });
    if (res.status === 404) return null;
    return (await this.json(res)) as CanvasRequest;
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

  /** GET /project/identity/manifest[?root=] → the node-identity manifest. Throws TransportError on transport/non-200. */
  async getIdentityManifest(root?: string): Promise<{ manifest: NodeManifest }> {
    const qs = root !== undefined && root.trim() !== "" ? `?root=${encodeURIComponent(root)}` : "";
    const res = await this.request(`/project/identity/manifest${qs}`, { method: "GET" });
    if (res.status !== 200) {
      throw new TransportError(`bridge rejected the manifest request (HTTP ${res.status})`);
    }
    return (await this.json(res)) as { manifest: NodeManifest };
  }

  /**
   * POST /project/identity/proposals[?root=] → merge vision proposals into the
   * manifest. Returns the raw HTTP status + parsed body (a 400 carries
   * `{ errors }`, a 200 carries `{ applied, skipped }`) so the command can
   * report either. Throws TransportError only on a network failure.
   */
  async postIdentityProposals(
    proposals: IdentityProposal[],
    root?: string,
  ): Promise<{ status: number; body: unknown }> {
    const qs = root !== undefined && root.trim() !== "" ? `?root=${encodeURIComponent(root)}` : "";
    const res = await this.request(`/project/identity/proposals${qs}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposals }),
    });
    return { status: res.status, body: await this.json(res) };
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
