/**
 * WorkerPresenceRegistry — which workers are live, per project root.
 *
 * Presence is STRUCTURAL: a worker is "live" exactly while its tagged SSE
 * socket to /pipeline/events is open (spec 2026-07-09-worker-liveness).
 * Sockets are opaque map keys; this module never touches HTTP. A socket whose
 * announced root was not served at subscribe time is held PENDING and promoted
 * when the root becomes served (POST /project/connect → promoteFor).
 */

/** One live worker as exposed on the snapshot / worker-status frames. */
export interface WorkerPresenceEntry {
  /** Kinds this worker claims; absent = all kinds. */
  kinds?: string[];
  connectedAt: number;
}

interface Tracked {
  root: string;
  kinds?: string[];
  connectedAt: number;
  /** false while the announced root is not yet served. */
  active: boolean;
}

export class WorkerPresenceRegistry {
  private readonly bySocket = new Map<object, Tracked>();

  /** Register an ACTIVE worker (its root resolved as served). */
  add(socket: object, root: string, connectedAt: number, kinds?: string[]): void {
    this.bySocket.set(socket, {
      root,
      connectedAt,
      active: true,
      ...(kinds !== undefined ? { kinds } : {}),
    });
  }

  /** Register a worker whose root is not served yet (counted after promoteFor). */
  addPending(socket: object, root: string, connectedAt: number, kinds?: string[]): void {
    this.bySocket.set(socket, {
      root,
      connectedAt,
      active: false,
      ...(kinds !== undefined ? { kinds } : {}),
    });
  }

  /**
   * Forget a socket. Returns the root it was ACTIVELY serving (the caller owes
   * a worker-status broadcast), or null for pending/unknown sockets.
   */
  remove(socket: object): string | null {
    const tracked = this.bySocket.get(socket);
    this.bySocket.delete(socket);
    return tracked !== undefined && tracked.active ? tracked.root : null;
  }

  /** Activate pending workers for a root that just became served. */
  promoteFor(root: string): boolean {
    let promoted = false;
    for (const tracked of this.bySocket.values()) {
      if (!tracked.active && tracked.root === root) {
        tracked.active = true;
        promoted = true;
      }
    }
    return promoted;
  }

  /** Live workers for a root, ascending connectedAt. */
  listFor(root: string): WorkerPresenceEntry[] {
    const out: WorkerPresenceEntry[] = [];
    for (const t of this.bySocket.values()) {
      if (t.active && t.root === root) {
        out.push({ connectedAt: t.connectedAt, ...(t.kinds !== undefined ? { kinds: t.kinds } : {}) });
      }
    }
    return out.sort((a, b) => a.connectedAt - b.connectedAt);
  }
}
