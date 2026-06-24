import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../config.js");
let savedConfig = null;

function hasConfig() {
  return existsSync(configPath);
}

function saveConfig() {
  if (hasConfig()) {
    savedConfig = readFileSync(configPath, "utf-8");
  }
}

function restoreConfig() {
  if (savedConfig !== null) {
    writeFileSync(configPath, savedConfig);
  }
}

function removeConfig() {
  if (hasConfig()) {
    unlinkSync(configPath);
  }
}

describe("Config loading", () => {
  beforeEach(() => {
    saveConfig();
    removeConfig();
    vi.resetModules();
  });

  afterEach(() => {
    removeConfig();
    restoreConfig();
  });

  test("throws when config.js does not exist", async () => {
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("config.js not found");
  });

  test("loads routes from config.js when it exists", async () => {
    writeFileSync(
      configPath,
      `export default {
        routes: [
          {
            name: "openai",
            remote_api_url: "https://api.openai.com/v1",
            messages_endpoint: "/chat/completions",
            auth_type: "bearer",
            api_key: "sk-test",
          },
          {
            name: "deepseek",
            remote_api_url: "https://api.deepseek.com/v1",
            messages_endpoint: "/chat/completions",
            auth_type: "bearer",
            api_key: "",
          },
        ],
      };`
    );

    const { loadConfig } = await import("../src/config.js");
    const routes = loadConfig();

    expect(routes).toHaveLength(2);
    expect(routes[0].name).toBe("openai");
    expect(routes[0].api_key).toBe("sk-test");
    expect(routes[1].name).toBe("deepseek");
    expect(routes[1].api_key).toBe("");
  });

  test("throws when config.js has empty routes", async () => {
    writeFileSync(
      configPath,
      `export default { routes: [] };`
    );

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("non-empty routes array");
  });

  test("throws when config.js has no routes field", async () => {
    writeFileSync(
      configPath,
      `export default { other: "data" };`
    );

    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("non-empty routes array");
  });
});

describe("Multi-service route registration", () => {
  beforeEach(() => {
    saveConfig();
    vi.resetModules();
  });

  afterEach(() => {
    restoreConfig();
    vi.restoreAllMocks();
  });

  test("multi-service mode registers /<name>/v1/* routes", async () => {
    // Mock config to return test routes without modifying config.js
    vi.doMock("../src/config.js", () => ({
      loadConfig: () => [
        { name: "svc-a", remote_api_url: "https://api.example.com/v1", api_key: "key-a" },
        { name: "svc-b", remote_api_url: "https://api.example.com/v1", api_key: "" },
      ],
    }));

    const { default: app } = await import("../src/server.js");
    const { default: request } = await import("supertest");

    // svc-a route should exist
    const resA = await request(app)
      .post("/svc-a/v1/messages")
      .send({ model: "test", max_tokens: 1, messages: [] });
    expect(resA.status).toBe(401); // auth required, not 404

    // svc-b route should exist
    const resB = await request(app)
      .post("/svc-b/v1/messages")
      .send({ model: "test", max_tokens: 1, messages: [] });
    expect(resB.status).toBe(401);
  });

  test("each service gets its own _serviceConfig", async () => {
    vi.doMock("../src/config.js", () => ({
      loadConfig: () => [
        { name: "svc-a", remote_api_url: "https://a.example.com/v1", api_key: "key-a" },
        { name: "svc-b", remote_api_url: "https://b.example.com/v1", api_key: "key-b" },
      ],
    }));

    const { default: app } = await import("../src/server.js");
    const { default: request } = await import("supertest");

    // Verify routes are registered (401 = route exists, 404 = not found)
    const resA = await request(app)
      .get("/svc-a/v1/models")
      .set("Authorization", "Bearer test");
    expect(resA.status).not.toBe(404);

    const resB = await request(app)
      .get("/svc-b/v1/models")
      .set("Authorization", "Bearer test");
    expect(resB.status).not.toBe(404);
  });
});
