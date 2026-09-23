import { describe, expect, test } from "bun:test";

import { routeByHost } from "../hostRouting";

const APEX = "usepraxis.fun";

describe("routeByHost — app subdomain", () => {
  test("/ rewrites to /app", () => {
    expect(routeByHost("app.usepraxis.fun", "/", APEX)).toEqual({ type: "rewrite", pathname: "/app" });
  });

  test("/app/* strips to /* (canonical, same host)", () => {
    expect(routeByHost("app.usepraxis.fun", "/app", APEX)).toEqual({
      type: "redirect",
      host: null,
      pathname: "/",
    });
    expect(routeByHost("app.usepraxis.fun", "/app/settings", APEX)).toEqual({
      type: "redirect",
      host: null,
      pathname: "/settings",
    });
  });

  test("api and other paths pass through", () => {
    expect(routeByHost("app.usepraxis.fun", "/api/praxis/get-policy", APEX)).toEqual({
      type: "passthrough",
    });
    expect(routeByHost("app.usepraxis.fun", "/opengraph-image", APEX)).toEqual({ type: "passthrough" });
  });

  test("host is case-insensitive and port-tolerant", () => {
    expect(routeByHost("APP.USEPRAXIS.FUN", "/", APEX)).toEqual({ type: "rewrite", pathname: "/app" });
    expect(routeByHost("app.usepraxis.fun:443", "/", APEX)).toEqual({ type: "rewrite", pathname: "/app" });
  });
});

describe("routeByHost — apex", () => {
  test("/app* redirects to the subdomain", () => {
    expect(routeByHost("usepraxis.fun", "/app", APEX)).toEqual({
      type: "redirect",
      host: "app.usepraxis.fun",
      pathname: "/",
    });
    expect(routeByHost("usepraxis.fun", "/app/", APEX)).toEqual({
      type: "redirect",
      host: "app.usepraxis.fun",
      pathname: "/",
    });
    expect(routeByHost("www.usepraxis.fun", "/app/x", APEX)).toEqual({
      type: "redirect",
      host: "app.usepraxis.fun",
      pathname: "/x",
    });
  });

  test("landing and api pass through", () => {
    expect(routeByHost("usepraxis.fun", "/", APEX)).toEqual({ type: "passthrough" });
    expect(routeByHost("usepraxis.fun", "/api/praxis/get-policy", APEX)).toEqual({ type: "passthrough" });
  });

  test("www canonicalizes to apex", () => {
    expect(routeByHost("www.usepraxis.fun", "/pricing", APEX)).toEqual({
      type: "redirect",
      host: "usepraxis.fun",
      pathname: "/pricing",
    });
  });
});

describe("routeByHost — non-production hosts", () => {
  test("preview deployments are never redirected", () => {
    expect(routeByHost("praxis-git-feature-acme.vercel.app", "/app", APEX)).toEqual({
      type: "passthrough",
    });
    expect(routeByHost("praxis-git-feature-acme.vercel.app", "/", APEX)).toEqual({
      type: "passthrough",
    });
  });

  test("localhost keeps path routing; app.localhost previews the split", () => {
    expect(routeByHost("localhost:3000", "/app", APEX)).toEqual({ type: "passthrough" });
    expect(routeByHost("localhost:3000", "/", APEX)).toEqual({ type: "passthrough" });
    expect(routeByHost("app.localhost:3000", "/", APEX)).toEqual({ type: "rewrite", pathname: "/app" });
  });

  test("missing host passes through", () => {
    expect(routeByHost(null, "/app", APEX)).toEqual({ type: "passthrough" });
  });
});
