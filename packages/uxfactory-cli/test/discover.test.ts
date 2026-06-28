import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverComponents } from "../src/commands/discover.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "uxf-discover-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("discoverComponents — recursive walk (Fix 2)", () => {
  it("discovers terraform resources in a subdirectory (e.g. infra/main.tf)", async () => {
    await mkdir(path.join(cwd, "infra"));
    await writeFile(
      path.join(cwd, "infra", "main.tf"),
      `resource "aws_lambda_function" "fn" {\n  name = "my-fn"\n}\n`,
      "utf8",
    );
    const found = await discoverComponents(cwd);
    expect(found.some((c) => c.source.ref === "infra/main.tf#aws_lambda_function.fn")).toBe(true);
    expect(found.some((c) => c.component === "my-fn")).toBe(true);
  });

  it("discovers terraform resources at cwd root (unchanged behaviour)", async () => {
    await writeFile(
      path.join(cwd, "main.tf"),
      `resource "aws_s3_bucket" "bucket" {\n  name = "my-bucket"\n}\n`,
      "utf8",
    );
    const found = await discoverComponents(cwd);
    expect(found.some((c) => c.source.ref === "main.tf#aws_s3_bucket.bucket")).toBe(true);
  });

  it("skips node_modules directories at any depth", async () => {
    await mkdir(path.join(cwd, "node_modules", "some-pkg"), { recursive: true });
    await writeFile(
      path.join(cwd, "node_modules", "some-pkg", "main.tf"),
      `resource "aws_x" "y" {}\n`,
      "utf8",
    );
    const found = await discoverComponents(cwd);
    expect(found.some((c) => c.source.ref.includes("node_modules"))).toBe(false);
  });

  it("skips .git directories", async () => {
    await mkdir(path.join(cwd, ".git", "hooks"), { recursive: true });
    await writeFile(
      path.join(cwd, ".git", "hooks", "main.tf"),
      `resource "aws_x" "z" {}\n`,
      "utf8",
    );
    const found = await discoverComponents(cwd);
    expect(found.some((c) => c.source.ref.includes(".git"))).toBe(false);
  });
});

describe("discoverComponents — broader YAML classification (Fix 2)", () => {
  it("discovers k8s resources from a standard deployment.yaml (no .k8s. marker)", async () => {
    const k8sYaml = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: my-app",
      "spec:",
      "  replicas: 1",
    ].join("\n");
    await writeFile(path.join(cwd, "deployment.yaml"), k8sYaml, "utf8");
    const found = await discoverComponents(cwd);
    const k8sEntry = found.find((c) => c.source.kind === "k8s" && c.component === "my-app");
    expect(k8sEntry).toBeDefined();
    expect(k8sEntry?.source.ref).toBe("deployment.yaml#Deployment/my-app");
  });

  it("discovers multiple k8s resources from a multi-document yaml", async () => {
    const multiDoc = [
      "apiVersion: v1",
      "kind: Service",
      "metadata:",
      "  name: my-svc",
      "---",
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: my-deploy",
    ].join("\n");
    await writeFile(path.join(cwd, "resources.yaml"), multiDoc, "utf8");
    const found = await discoverComponents(cwd);
    expect(found.some((c) => c.component === "my-svc" && c.source.kind === "k8s")).toBe(true);
    expect(found.some((c) => c.component === "my-deploy" && c.source.kind === "k8s")).toBe(true);
  });

  it("treats a generic .yml file with top-level services: as compose (not k8s)", async () => {
    const composeYaml = [
      "services:",
      "  web:",
      "    image: nginx",
      "  db:",
      "    image: postgres",
    ].join("\n");
    await writeFile(path.join(cwd, "stack.yml"), composeYaml, "utf8");
    const found = await discoverComponents(cwd);
    expect(found.some((c) => c.source.kind === "compose" && c.component === "web")).toBe(true);
    expect(found.some((c) => c.source.kind === "compose" && c.component === "db")).toBe(true);
  });

  it("discovers docker-compose.yml via explicit name (unchanged behaviour)", async () => {
    const composeYaml = ["services:", "  app:", "    image: my-app"].join("\n");
    await writeFile(path.join(cwd, "docker-compose.yml"), composeYaml, "utf8");
    const found = await discoverComponents(cwd);
    expect(found.some((c) => c.source.kind === "compose" && c.component === "app")).toBe(true);
  });

  it("skips a .yaml file that is neither k8s nor compose", async () => {
    const random = ["name: something", "value: 42"].join("\n");
    await writeFile(path.join(cwd, "random.yaml"), random, "utf8");
    const found = await discoverComponents(cwd);
    // Should not produce any discovery results for this file
    expect(found.some((c) => c.source.ref.includes("random.yaml"))).toBe(false);
  });

  it("discovers k8s yaml found in a subdir (recursive + broad classification)", async () => {
    await mkdir(path.join(cwd, "k8s"));
    const k8sYaml = ["apiVersion: v1", "kind: ConfigMap", "metadata:", "  name: my-config"].join(
      "\n",
    );
    await writeFile(path.join(cwd, "k8s", "config.yaml"), k8sYaml, "utf8");
    const found = await discoverComponents(cwd);
    expect(found.some((c) => c.source.ref === "k8s/config.yaml#ConfigMap/my-config")).toBe(true);
  });
});
