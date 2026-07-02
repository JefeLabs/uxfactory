import type { MainToUi, UiToMain } from "../../src/messages.js";

export interface PluginBus {
  storageGet<T>(key: string): Promise<T | undefined>;
  /** Fire-and-forget — resolves immediately without waiting for a reply. */
  storageSet(key: string, value: unknown): Promise<void>;
  fileInfo(): Promise<{ name: string; fileKey: string }>;
  /** Resolves with the nodeId of the inserted icon node. */
  insertIcon(name: string, svg: string, size: number): Promise<string>;
  notify(message: string): void;
  close(): void;
  /** Subscribes to MainToUi "selection" messages. Returns an unsubscribe function. */
  onSelection(cb: (sel: unknown) => void): () => void;
}

const TIMEOUT_MS = 5_000;

/** Wrap a promise with a hard timeout — rejects if no reply arrives within `ms` ms. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`plugin-bus: timeout after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/**
 * Creates a typed plugin bus for the iframe UI.
 *
 * `post`   — sends a UiToMain message to the main thread.
 *            Defaults to `parent.postMessage({ pluginMessage: msg }, "*")`.
 * `listen` — registers a callback for MainToUi messages.
 *            Defaults to wiring `window.onmessage`.
 *
 * Request/response correlation:
 *   - storage-get / storage-value: matched by `key` (per-key queue supports concurrent gets).
 *   - file-info-request / file-info: FIFO queue.
 *   - insert-icon / icon-inserted:   FIFO queue.
 *   All awaitable calls time out after 5 s and reject — callers should fail soft.
 */
export function createBus(
  post?: (msg: unknown) => void,
  listen?: (cb: (msg: unknown) => void) => void,
): PluginBus {
  const defaultPost = (msg: unknown): void => {
    parent.postMessage({ pluginMessage: msg }, "*");
  };

  const defaultListen = (cb: (msg: unknown) => void): void => {
    window.onmessage = (event: MessageEvent) => {
      const pluginMessage = (event.data as { pluginMessage?: unknown }).pluginMessage;
      if (pluginMessage !== undefined) cb(pluginMessage);
    };
  };

  const send = (msg: UiToMain): void => (post ?? defaultPost)(msg);
  const subscribe = listen ?? defaultListen;

  // Per-key queue of pending storage-get resolvers.
  const storagePending = new Map<
    string,
    Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }>
  >();

  // FIFO queue for file-info replies.
  const fileInfoPending: Array<{
    resolve: (v: { name: string; fileKey: string }) => void;
    reject: (e: Error) => void;
  }> = [];

  // FIFO queue for icon-inserted replies.
  const iconPending: Array<{
    resolve: (nodeId: string) => void;
    reject: (e: Error) => void;
  }> = [];

  // Set of active selection listeners.
  const selectionListeners = new Set<(sel: unknown) => void>();

  subscribe((raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const msg = raw as MainToUi;

    if (msg.type === "storage-value") {
      const queue = storagePending.get(msg.key);
      if (queue && queue.length > 0) {
        const handler = queue.shift()!;
        handler.resolve(msg.value);
        if (queue.length === 0) storagePending.delete(msg.key);
      }
    } else if (msg.type === "file-info") {
      const handler = fileInfoPending.shift();
      if (handler) handler.resolve({ name: msg.name, fileKey: msg.fileKey });
    } else if (msg.type === "icon-inserted") {
      const handler = iconPending.shift();
      if (handler) handler.resolve(msg.nodeId);
    } else if (msg.type === "selection") {
      const sel = (msg as unknown as { selection: unknown }).selection;
      for (const cb of selectionListeners) cb(sel);
    }
  });

  return {
    storageGet<T>(key: string): Promise<T | undefined> {
      let queue = storagePending.get(key);
      if (!queue) {
        queue = [];
        storagePending.set(key, queue);
      }
      const p = new Promise<T | undefined>((resolve, reject) =>
        queue!.push({ resolve: (v) => resolve(v as T | undefined), reject }),
      );
      send({ type: "storage-get", key });
      return withTimeout(p, TIMEOUT_MS);
    },

    storageSet(key: string, value: unknown): Promise<void> {
      send({ type: "storage-set", key, value });
      return Promise.resolve();
    },

    fileInfo(): Promise<{ name: string; fileKey: string }> {
      const p = new Promise<{ name: string; fileKey: string }>((resolve, reject) =>
        fileInfoPending.push({ resolve, reject }),
      );
      send({ type: "file-info-request" });
      return withTimeout(p, TIMEOUT_MS);
    },

    insertIcon(name: string, svg: string, size: number): Promise<string> {
      const p = new Promise<string>((resolve, reject) =>
        iconPending.push({ resolve, reject }),
      );
      send({ type: "insert-icon", name, svg, size });
      return withTimeout(p, TIMEOUT_MS);
    },

    notify(message: string): void {
      send({ type: "notify", message });
    },

    close(): void {
      send({ type: "close" });
    },

    onSelection(cb: (sel: unknown) => void): () => void {
      selectionListeners.add(cb);
      return () => selectionListeners.delete(cb);
    },
  };
}
