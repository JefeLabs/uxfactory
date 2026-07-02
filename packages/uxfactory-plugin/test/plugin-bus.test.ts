// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { createBus } from "../ui/lib/plugin-bus.js";

/** Build a fake post/listen pair for round-trip tests. */
function makeTransport(): {
  post: (msg: unknown) => void;
  listen: (cb: (msg: unknown) => void) => void;
  deliver: (msg: unknown) => void;
} {
  let listener: ((msg: unknown) => void) | null = null;
  return {
    post: () => {},
    listen: (cb) => {
      listener = cb;
    },
    deliver: (msg) => {
      listener?.(msg);
    },
  };
}

describe("plugin-bus storageGet", () => {
  it("resolves with the value from a storage-value reply", async () => {
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    const p = bus.storageGet<string>("theme");
    t.deliver({ type: "storage-value", key: "theme", value: "dark" });
    expect(await p).toBe("dark");
  });

  it("resolves with undefined when value is undefined", async () => {
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    const p = bus.storageGet<string>("missing");
    t.deliver({ type: "storage-value", key: "missing", value: undefined });
    expect(await p).toBeUndefined();
  });

  it("two concurrent gets for different keys do not cross-resolve", async () => {
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    const pA = bus.storageGet<string>("a");
    const pB = bus.storageGet<string>("b");

    // Deliver b's reply first, then a's.
    t.deliver({ type: "storage-value", key: "b", value: "value-b" });
    t.deliver({ type: "storage-value", key: "a", value: "value-a" });

    expect(await pA).toBe("value-a");
    expect(await pB).toBe("value-b");
  });
});

describe("plugin-bus fileInfo", () => {
  it("resolves with name and fileKey from a file-info reply", async () => {
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    const p = bus.fileInfo();
    t.deliver({ type: "file-info", name: "My Design", fileKey: "abc123" });
    expect(await p).toEqual({ name: "My Design", fileKey: "abc123" });
  });
});

describe("plugin-bus insertIcon", () => {
  it("resolves with the nodeId from an icon-inserted reply", async () => {
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    const p = bus.insertIcon("star", "<svg/>", 24);
    t.deliver({ type: "icon-inserted", nodeId: "42:1" });
    expect(await p).toBe("42:1");
  });
});

describe("plugin-bus timeout", () => {
  it("rejects after 5 s when no reply arrives", async () => {
    vi.useFakeTimers();
    try {
      const bus = createBus(
        () => {},
        () => {}, // never delivers a reply
      );

      const p = bus.fileInfo();
      vi.advanceTimersByTime(5_001);
      await expect(p).rejects.toThrow(/timeout/i);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("plugin-bus timeout queue cleanup", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a timed-out request does not consume the next reply of the same kind", async () => {
    vi.useFakeTimers();
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    // 1. storageGet with no reply → advance past 5 s → rejects with timeout.
    const p1 = bus.storageGet<string>("k");
    vi.advanceTimersByTime(5_001);
    await expect(p1).rejects.toThrow(/timeout/i);

    // 2. storageGet again → deliver one storage-value for "k".
    // The second call must resolve with the delivered value, not be starved
    // by the stale entry that was left behind by the timed-out first call.
    const p2 = bus.storageGet<string>("k");
    t.deliver({ type: "storage-value", key: "k", value: "hello" });
    expect(await p2).toBe("hello");
  });

  it("map key is cleaned up after timeout with no other pending entries", async () => {
    vi.useFakeTimers();
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    // Cause a timeout — the per-key queue should be deleted (no leak).
    const p1 = bus.storageGet<string>("leak-key");
    vi.advanceTimersByTime(5_001);
    await expect(p1).rejects.toThrow(/timeout/i);

    // A fresh get after cleanup must work as if it is the first call ever.
    const p2 = bus.storageGet<string>("leak-key");
    t.deliver({ type: "storage-value", key: "leak-key", value: "fresh" });
    expect(await p2).toBe("fresh");
  });

  it("a timed-out fileInfo does not consume the next fileInfo reply", async () => {
    vi.useFakeTimers();
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    const p1 = bus.fileInfo();
    vi.advanceTimersByTime(5_001);
    await expect(p1).rejects.toThrow(/timeout/i);

    const p2 = bus.fileInfo();
    t.deliver({ type: "file-info", name: "My File", fileKey: "xyz" });
    expect(await p2).toEqual({ name: "My File", fileKey: "xyz" });
  });

  it("a timed-out insertIcon does not consume the next icon-inserted reply", async () => {
    vi.useFakeTimers();
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    const p1 = bus.insertIcon("star", "<svg/>", 24);
    vi.advanceTimersByTime(5_001);
    await expect(p1).rejects.toThrow(/timeout/i);

    const p2 = bus.insertIcon("circle", "<svg/>", 16);
    t.deliver({ type: "icon-inserted", nodeId: "10:1" });
    expect(await p2).toBe("10:1");
  });
});

describe("plugin-bus onSelection", () => {
  it("fires the callback on each selection message and stops after unsubscribe", () => {
    const t = makeTransport();
    const bus = createBus(t.post, t.listen);

    const calls: unknown[] = [];
    const unsub = bus.onSelection((sel) => calls.push(sel));

    t.deliver({ type: "selection", selection: { nodes: [{ id: "1:1" }] } });
    expect(calls).toHaveLength(1);

    unsub();
    t.deliver({ type: "selection", selection: { nodes: [{ id: "2:2" }] } });
    expect(calls).toHaveLength(1); // still 1 — unsubscribed
  });
});
