import { describe, it, expect } from "vitest";
import { WorkerPresenceRegistry } from "../src/worker-presence.js";

describe("WorkerPresenceRegistry", () => {
  it("add → listFor returns the entry; remove returns the root and empties the list", () => {
    const reg = new WorkerPresenceRegistry();
    const sock = {};
    reg.add(sock, "/repo/a", 1000, ["generate-artifact"]);
    expect(reg.listFor("/repo/a")).toEqual([{ kinds: ["generate-artifact"], connectedAt: 1000 }]);
    expect(reg.listFor("/repo/b")).toEqual([]);
    expect(reg.remove(sock)).toBe("/repo/a");
    expect(reg.listFor("/repo/a")).toEqual([]);
  });

  it("kinds is omitted (not null) for an all-kinds worker", () => {
    const reg = new WorkerPresenceRegistry();
    reg.add({}, "/repo/a", 5);
    expect(reg.listFor("/repo/a")).toEqual([{ connectedAt: 5 }]);
    expect("kinds" in reg.listFor("/repo/a")[0]!).toBe(false);
  });

  it("listFor sorts by connectedAt ascending and supports multiple workers per root", () => {
    const reg = new WorkerPresenceRegistry();
    reg.add({}, "/repo/a", 20);
    reg.add({}, "/repo/a", 10);
    expect(reg.listFor("/repo/a").map((w) => w.connectedAt)).toEqual([10, 20]);
  });

  it("pending workers are invisible until promoted; promoteFor reports change", () => {
    const reg = new WorkerPresenceRegistry();
    const sock = {};
    reg.addPending(sock, "/repo/a", 7, ["generate-design"]);
    expect(reg.listFor("/repo/a")).toEqual([]);
    expect(reg.promoteFor("/repo/b")).toBe(false);
    expect(reg.promoteFor("/repo/a")).toBe(true);
    expect(reg.listFor("/repo/a")).toEqual([{ kinds: ["generate-design"], connectedAt: 7 }]);
    expect(reg.promoteFor("/repo/a")).toBe(false); // idempotent
  });

  it("remove on a PENDING socket returns null (no broadcast owed)", () => {
    const reg = new WorkerPresenceRegistry();
    const sock = {};
    reg.addPending(sock, "/repo/a", 7);
    expect(reg.remove(sock)).toBeNull();
    expect(reg.promoteFor("/repo/a")).toBe(false); // gone from pending too
  });

  it("remove on an unknown socket returns null", () => {
    expect(new WorkerPresenceRegistry().remove({})).toBeNull();
  });
});
