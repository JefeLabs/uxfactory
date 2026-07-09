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
    useAppStore.setState({ workers: null, workerBannerDismissed: false });
  });

  it("renders nothing while liveness is unknown (workers: null)", () => {
    render(<WorkerBanner kind="generate-artifact" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns with the spec copy when no worker covers the kind", () => {
    useAppStore.setState({ workers: [] });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(
      screen.getByText("No worker is serving this project — jobs will queue until one connects."),
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
});
