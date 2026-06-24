import { describe, test, expect, vi } from "vitest";

function loadMiddleware() {
  // Dynamic import to get fresh module
  return import("../src/middleware/auth.js").then((m) => m.authMiddleware);
}

function mockReqRes(authHeader, serviceConfig) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
    _serviceConfig: serviceConfig !== undefined ? serviceConfig : { name: "test", api_key: "test-key" },
  };
  const res = {
    _status: null,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  return { req, res };
}

describe("authMiddleware", () => {
  test("rejects request without Authorization header", async () => {
    const authMiddleware = await loadMiddleware();
    const { req, res } = mockReqRes(null);
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.error).toContain("Missing Authorization header");
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects malformed Authorization header", async () => {
    const authMiddleware = await loadMiddleware();
    const { req, res } = mockReqRes("Basic abc");
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("accepts Bearer token and calls next when service has api_key", async () => {
    const authMiddleware = await loadMiddleware();
    const { req, res } = mockReqRes("Bearer client-token", {
      name: "test",
      api_key: "service-key",
    });
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req._passthroughToken).toBeUndefined();
  });

  test("sets _passthroughToken when service has no api_key", async () => {
    const authMiddleware = await loadMiddleware();
    const { req, res } = mockReqRes("Bearer my-anthropic-token", {
      name: "test",
      api_key: "",
    });
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req._passthroughToken).toBe("my-anthropic-token");
  });

  test("sets _passthroughToken when api_key is omitted", async () => {
    const authMiddleware = await loadMiddleware();
    const { req, res } = mockReqRes("Bearer my-token", {
      name: "test",
    });
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req._passthroughToken).toBe("my-token");
  });

  test("sets _passthroughToken when no service config is present", async () => {
    const authMiddleware = await loadMiddleware();
    const { req, res } = mockReqRes("Bearer my-token", null);
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req._passthroughToken).toBe("my-token");
  });

  test("still requires Authorization header in passthrough mode", async () => {
    const authMiddleware = await loadMiddleware();
    const { req, res } = mockReqRes(null, { name: "test", api_key: "" });
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
