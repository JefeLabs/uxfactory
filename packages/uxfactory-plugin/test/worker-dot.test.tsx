// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkerDot } from "../ui/router.js";
import { useAppStore } from "../ui/stores/app.js";

afterEach(cleanup);

describe("WorkerDot", () => {
  beforeEach(() => {
    useAppStore.setState({ workers: null, managedWorker: null, workerBannerDismissed: false });
  });

  it("grey when unknown", () => {
    render(<WorkerDot />);
    expect(screen.getByLabelText("Worker status: unknown")).toBeInTheDocument();
  });
  it("amber when any enqueueable kind is uncovered", () => {
    useAppStore.setState({ workers: [] });
    render(<WorkerDot />);
    expect(screen.getByLabelText("Worker status: no worker for this project")).toBeInTheDocument();
  });
  it("green when every enqueueable kind is covered", () => {
    useAppStore.setState({ workers: [{ connectedAt: 1 }] });
    render(<WorkerDot />);
    expect(screen.getByLabelText("Worker status: live")).toBeInTheDocument();
  });
  it("managed-idle: green with an on-demand tooltip", () => {
    useAppStore.setState({ workers: [], managedWorker: {} });
    render(<WorkerDot />);
    const dot = screen.getByLabelText("Worker status: live");
    expect(dot).toHaveAttribute("title", "Worker status: live — on-demand (idle)");
  });
});
