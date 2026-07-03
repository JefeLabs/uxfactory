// @vitest-environment jsdom
/**
 * query-recovery-contract.test.ts — pins the TanStack Query behavior the
 * Settings screen's auto-recovery depends on: a query that has NEVER
 * succeeded (bridge down when the tab opened) keeps firing refetchInterval
 * through the error state and recovers on its own once the fetch succeeds.
 *
 * Real timers on purpose: vi.useFakeTimers() does not advance Query v5's
 * scheduler, which produced a false "interval stops on error" reading during
 * the migration. If a Query upgrade breaks this contract, restore recovery
 * explicitly (e.g. refetchInterval function form or a reconnect effect)
 * before bumping the pin.
 */
import { describe, expect, it } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

describe("TanStack Query contract: refetchInterval survives error state", () => {
  it("an error-born query keeps polling and reaches success unaided", async () => {
    let calls = 0;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 5 } },
    });
    const observer = new QueryObserver(client, {
      queryKey: ["recovery-contract"],
      queryFn: async () => {
        calls++;
        if (calls <= 3) throw new Error("bridge down");
        return { ok: calls };
      },
      refetchInterval: 50,
    });

    const unsubscribe = observer.subscribe(() => {});
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      unsubscribe();
      client.clear();
    }

    expect(calls).toBeGreaterThan(3);
    expect(observer.getCurrentResult().status).toBe("success");
  }, 15_000);
});
