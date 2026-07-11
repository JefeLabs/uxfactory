// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkerBanner } from "../ui/components/WorkerBanner.js";
import { useAppStore } from "../ui/stores/app.js";

afterEach(cleanup);

describe("WorkerBanner", () => {
  beforeEach(() => {
    useAppStore.setState({
      workers: null,
      workerBannerDismissed: false,
      connection: { status: "none", endpoint: "http://localhost:3779", repoPath: "", mode: "local" },
    });
  });

  it("renders nothing while liveness is unknown (workers: null)", () => {
    render(<WorkerBanner kind="generate-artifact" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns with the spec copy when no worker covers the kind", () => {
    useAppStore.setState({ workers: [] });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(
      screen.getByText("No worker detected for this project — jobs will queue until one connects."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Start a worker from this project's root (see the quick-start's worker section)."),
    ).toBeInTheDocument();
  });

  it("renders nothing when a live worker covers the kind", () => {
    useAppStore.setState({ workers: [{ connectedAt: 1 }] });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns when the live pool does not claim this kind", () => {
    useAppStore.setState({ workers: [{ kinds: ["generate-design"], connectedAt: 1 }] });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("✕ dismisses via the store", () => {
    useAppStore.setState({ workers: [] });
    render(<WorkerBanner kind="generate-artifact" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss worker warning" }));
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the copyable worker command built from the connected repoPath", () => {
    useAppStore.setState({
      workers: [],
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/repo/demo", mode: "local" },
    });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(screen.getByText("cd /repo/demo && uxfactory worker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy worker command" })).toBeInTheDocument();
  });

  it("falls back to the doc-pointer line when repoPath is empty", () => {
    useAppStore.setState({
      workers: [],
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "", mode: "local" },
    });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(
      screen.getByText("Start a worker from this project's root (see the quick-start's worker section)."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy worker command" })).toBeNull();
  });
});
