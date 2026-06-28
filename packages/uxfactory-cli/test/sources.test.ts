import { describe, it, expect } from "vitest";
import { resolveSource, getByPath, parseRef } from "../src/drift/sources.js";

const tf = `
resource "aws_apigatewayv2_api" "main" {
  name        = "api-gateway"
  target_port = "8080"
  # a comment
}

resource "aws_lambda_function" "worker" {
  function_name = "worker"
}
`;

const k8s = `
apiVersion: v1
kind: Service
metadata:
  name: api-gateway
spec:
  ports:
    - targetPort: 8080
      port: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
`;

const compose = `
services:
  api-gateway:
    image: nginx:1.27
    ports:
      - "8080:80"
  db:
    image: postgres:16
`;

describe("getByPath", () => {
  it("reads nested keys and array indices", () => {
    const o = { spec: { ports: [{ targetPort: 8080 }] } };
    expect(getByPath(o, "spec.ports[0].targetPort")).toBe(8080);
  });

  it("returns undefined for a missing path", () => {
    expect(getByPath({ a: 1 }, "a.b.c")).toBeUndefined();
  });
});

describe("parseRef", () => {
  it("splits file#ident", () => {
    expect(parseRef("infra/main.tf#aws_apigatewayv2_api.main")).toEqual({
      file: "infra/main.tf",
      ident: "aws_apigatewayv2_api.main",
    });
  });
});

describe("resolveSource — terraform", () => {
  it("resolves a block and extracts the compare attributes (quotes stripped)", () => {
    const r = resolveSource("terraform", tf, "aws_apigatewayv2_api.main", {
      label: "name",
      port: "target_port",
    });
    expect(r.resolved).toBe(true);
    expect(r.values).toEqual({ name: "api-gateway", target_port: "8080" });
  });

  it("returns resolved:false when the block is absent", () => {
    const r = resolveSource("terraform", tf, "aws_apigatewayv2_api.gone", { label: "name" });
    expect(r.resolved).toBe(false);
    expect(r.values).toEqual({});
  });
});

describe("resolveSource — k8s", () => {
  it("matches a document by kind/name and reads a dotted path", () => {
    const r = resolveSource("k8s", k8s, "Service/api-gateway", {
      port: "spec.ports[0].targetPort",
    });
    expect(r.resolved).toBe(true);
    expect(r.values).toEqual({ "spec.ports[0].targetPort": "8080" });
  });

  it("matches by bare name when no kind is given", () => {
    expect(resolveSource("k8s", k8s, "worker", {}).resolved).toBe(true);
  });

  it("returns resolved:false for an unknown document", () => {
    expect(resolveSource("k8s", k8s, "Service/missing", {}).resolved).toBe(false);
  });
});

describe("resolveSource — compose", () => {
  it("resolves a service and reads its attributes", () => {
    const r = resolveSource("compose", compose, "api-gateway", { image: "image" });
    expect(r.resolved).toBe(true);
    expect(r.values).toEqual({ image: "nginx:1.27" });
  });

  it("returns resolved:false for an unknown service", () => {
    expect(resolveSource("compose", compose, "cache", {}).resolved).toBe(false);
  });
});
