// @vitest-environment jsdom
/**
 * screen-queue.test.tsx — the render-queue approval screen: queued designspec
 * jobs (from CI / agent CLI publishes) list with previews and only reach the
 * canvas after an explicit Approve; Discard rejects without rendering.
 */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useAppStore } from "../ui/stores/app.js";
import { Queue } from "../ui/screens/Queue.js";
import { renderWithProviders } from "./test-utils.js";
import type { Bridge, ProjectSnapshot } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";

afterEach(cleanup);

const SNAPSHOT: ProjectSnapshot = {
  name: "Demo Shop",
  root: "/home/user/demo-shop",
  hasClassification: true,
  hasProfile: true,
  classification: { category: "ecommerce", platforms: ["desktop"], layout: "responsive" },
  profile: null,
  artifacts: [],
  requirements: [],
};

const JOBS = {
  jobs: [
    {
      jobId: "pub_1",
      queuedAt: 1_000,
      frames: [{ name: "screens/home.html/success@desktop", width: 1440, height: 900 }],
    },
    {
      jobId: "pub_2",
      queuedAt: 2_000,
      frames: [{ name: "screens/home.html/success@mobile-portrait", width: 390, height: 4384 }],
      ungoverned: true,
    },
  ],
};

const APPROVED_SPEC = { editor: "figma", frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10 }] };

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn().mockResolvedValue({ ok: true, snapshot: SNAPSHOT }),
    snapshot: vi.fn().mockResolvedValue(SNAPSHOT),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi.fn().mockResolvedValue({ version: "0.0.0", uptimeMs: 0, runsRelayed: 0, tokenCount: null }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    skills: vi.fn().mockResolvedValue({ skills: [] }),
    enqueue: vi.fn().mockResolvedValue({ id: "test-id" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue({}),
    listRenderQueue: vi.fn().mockResolvedValue(JOBS),
    approveRenderJob: vi.fn().mockResolvedValue({ jobId: "pub_1", spec: APPROVED_SPEC }),
    discardRenderJob: vi.fn().mockResolvedValue({ ok: true }),
    fetchRenderJobPreview: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeBus(): PluginBus {
  return {
    storageGet: vi.fn().mockResolvedValue(undefined),
    storageSet: vi.fn().mockResolvedValue(undefined),
    fileInfo: vi.fn().mockResolvedValue({ name: "Demo Shop", fileKey: "file-abc" }),
    insertIcon: vi.fn().mockResolvedValue("node-1"),
    notify: vi.fn(),
    close: vi.fn(),
    onSelection: vi.fn().mockReturnValue(() => {}),
    selectNodes: vi.fn(),
    postReview: vi.fn(),
    postRender: vi.fn(),
    onRendered: vi.fn().mockReturnValue(() => {}),
    onRenderError: vi.fn().mockReturnValue(() => {}),
  };
}

beforeEach(() => {
  useAppStore.setState({
    connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/home/user/demo-shop", mode: "local" },
    fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
    snapshot: SNAPSHOT,
    toasts: [],
  });
});

describe("Queue screen", () => {
  it("lists queued jobs with frame names and dimensions", async () => {
    await renderWithProviders(<Queue bridge={makeBridge()} bus={makeBus()} />, {
      initialEntries: ["/tabs/queue"],
    });

    await waitFor(() =>
      expect(screen.getByText("screens/home.html/success@desktop")).toBeInTheDocument(),
    );
    expect(screen.getByText("screens/home.html/success@mobile-portrait")).toBeInTheDocument();
    expect(screen.getByText(/1440×900/)).toBeInTheDocument();
    expect(screen.getByText(/390×4384/)).toBeInTheDocument();
  });

  it("Approve claims the job and forwards its spec to the main thread", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Queue bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/queue"],
    });
    await waitFor(() =>
      expect(screen.getByText("screens/home.html/success@desktop")).toBeInTheDocument(),
    );

    await user.click(screen.getAllByRole("button", { name: /Approve/ })[0]!);

    await waitFor(() => expect(bridge.approveRenderJob).toHaveBeenCalledWith("pub_1"));
    expect(bus.postRender).toHaveBeenCalledWith(APPROVED_SPEC, "pub_1");
  });

  it("Discard rejects the job without rendering", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Queue bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/queue"],
    });
    await waitFor(() =>
      expect(screen.getByText("screens/home.html/success@desktop")).toBeInTheDocument(),
    );

    await user.click(screen.getAllByRole("button", { name: /Discard/ })[0]!);

    await waitFor(() => expect(bridge.discardRenderJob).toHaveBeenCalledWith("pub_1"));
    expect(bus.postRender).not.toHaveBeenCalled();
  });

  it("shows an empty state when nothing is queued", async () => {
    const bridge = makeBridge({
      listRenderQueue: vi.fn().mockResolvedValue({ jobs: [] }),
    });
    await renderWithProviders(<Queue bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/queue"],
    });

    await waitFor(() =>
      expect(screen.getByText(/No designs waiting for approval/i)).toBeInTheDocument(),
    );
  });
});

describe("ungoverned provenance badge on queue jobs", () => {
  it("shows the badge only on jobs whose sidecar carried the flag", async () => {
    await renderWithProviders(<Queue bridge={makeBridge()} bus={makeBus()} />, {
      initialEntries: ["/tabs/queue"],
    });
    const badges = await screen.findAllByText("Ungoverned draft");
    // Fixture: job two is ungoverned, job one is governed.
    expect(badges).toHaveLength(1);
    expect(badges[0]!).toHaveAttribute("title", expect.stringMatching(/grounding artifacts missing/i));
  });
});
