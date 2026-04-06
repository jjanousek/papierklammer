import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { privateHostnameGuard } from "../middleware/private-hostname-guard.js";

function createApp(opts: { enabled: boolean; allowedHostnames?: string[]; bindHost?: string }) {
  const app = express();
  app.use(
    privateHostnameGuard({
      enabled: opts.enabled,
      allowedHostnames: opts.allowedHostnames ?? [],
      bindHost: opts.bindHost ?? "0.0.0.0",
    }),
  );
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  app.get("/dashboard", (_req, res) => {
    res.status(200).send("ok");
  });
  return app;
}

function getWithHostname(app: express.Express, path: string, hostname: string) {
  const hostHeader = `${hostname}:3100`;
  return request(app).get(path).set("Host", hostHeader).set("X-Forwarded-Host", hostHeader);
}

describe("privateHostnameGuard", () => {
  it("allows requests when disabled", async () => {
    const app = createApp({ enabled: false });
    const res = await getWithHostname(app, "/api/health", "dotta-macbook-pro");
    expect(res.status).toBe(200);
  });

  it("allows loopback hostnames", async () => {
    const app = createApp({ enabled: true });
    const res = await getWithHostname(app, "/api/health", "localhost");
    expect(res.status).toBe(200);
  });

  it("allows explicitly configured hostnames", async () => {
    const app = createApp({ enabled: true, allowedHostnames: ["dotta-macbook-pro"] });
    const res = await getWithHostname(app, "/api/health", "dotta-macbook-pro");
    expect(res.status).toBe(200);
  });

  it("blocks unknown hostnames with remediation command", async () => {
    const app = createApp({ enabled: true, allowedHostnames: ["some-other-host"] });
    const res = await getWithHostname(app, "/api/health", "dotta-macbook-pro");
    expect(res.status).toBe(403);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body?.error).toContain("please run pnpm papierklammer allowed-hostname dotta-macbook-pro");
  });

  it("blocks unknown hostnames on page routes with plain-text remediation command", async () => {
    const app = createApp({ enabled: true, allowedHostnames: ["some-other-host"] });
    const res = await getWithHostname(app, "/dashboard", "dotta-macbook-pro").set("Accept", "*/*");
    expect(res.status).toBe(403);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("please run pnpm papierklammer allowed-hostname dotta-macbook-pro");
  }, 20_000);
});
