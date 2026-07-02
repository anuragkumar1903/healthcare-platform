/**
 * Unit Tests — Middleware
 * Tests: verifyToken, adminGuard
 *
 * These are pure unit tests — no DB, no external deps.
 * JWT signing uses the same secret as the middleware.
 */

import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test_secret_key_minimum_32_chars_long!!";

// ─── verifyToken ──────────────────────────────────────────────────────────────
const { verifyToken } = await import("../../middleware/verifyToken.js");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (headers = {}, overrides = {}) => ({
  headers,
  body: {},
  ...overrides,
});

describe("verifyToken middleware", () => {
  const next = jest.fn();

  beforeEach(() => next.mockClear());

  it("returns 401 when no Authorization header is present", () => {
    const req = mockReq({});
    const res = mockRes();
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Unauthorized. No token provided." }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when Bearer token is missing after the keyword", () => {
    const req = mockReq({ authorization: "Bearer " });
    const res = mockRes();
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid / malformed token", () => {
    const req = mockReq({ authorization: "Bearer thisisnotavalidjwttoken" });
    const res = mockRes();
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid or expired token." }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for an expired token", () => {
    const expiredToken = jwt.sign({ _id: "uid", role: "user" }, process.env.JWT_SECRET, { expiresIn: "-1s" });
    const req = mockReq({ authorization: `Bearer ${expiredToken}` });
    const res = mockRes();
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for a token signed with a different secret", () => {
    const wrongToken = jwt.sign({ _id: "uid", role: "user" }, "WRONG_SECRET_KEY", { expiresIn: "15m" });
    const req = mockReq({ authorization: `Bearer ${wrongToken}` });
    const res = mockRes();
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and attaches decoded user for a valid token", () => {
    const token = jwt.sign({ _id: "uid123", role: "user" }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    verifyToken(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user._id).toBe("uid123");
    expect(req.user.role).toBe("user");
  });

  it("attaches correct role (doctor) to req.user", () => {
    const token = jwt.sign({ _id: "did1", role: "doctor" }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    verifyToken(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.role).toBe("doctor");
  });

  it("attaches correct role (admin) to req.user", () => {
    const token = jwt.sign({ _id: "aid1", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    verifyToken(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.role).toBe("admin");
  });

  it("handles token passed without Bearer prefix gracefully", () => {
    const token = jwt.sign({ _id: "uid", role: "user" }, process.env.JWT_SECRET, { expiresIn: "15m" });
    // Authorization header without "Bearer" — split(" ")[1] returns undefined
    const req = mockReq({ authorization: token });
    const res = mockRes();
    verifyToken(req, res, next);
    // Without "Bearer " prefix, token split gives wrong chunk → should return 401
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── adminGuard ──────────────────────────────────────────────────────────────
const { adminGuard } = await import("../../pharmacy/middleware/adminGuard.js");

describe("adminGuard middleware", () => {
  const next = jest.fn();

  beforeEach(() => next.mockClear());

  it("returns 403 when req.user is undefined", () => {
    const req = { user: undefined };
    const res = mockRes();
    adminGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Forbidden. Admin access required." }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when role is 'user'", () => {
    const req = { user: { _id: "uid", role: "user" } };
    const res = mockRes();
    adminGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when role is 'doctor'", () => {
    const req = { user: { _id: "did", role: "doctor" } };
    const res = mockRes();
    adminGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when role is 'admin'", () => {
    const req = { user: { _id: "aid", role: "admin" } };
    const res = mockRes();
    adminGuard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not leak user data in the 403 response", () => {
    const req = { user: { _id: "uid", role: "user", password: "secret" } };
    const res = mockRes();
    adminGuard(req, res, next);
    const body = res.json.mock.calls[0][0];
    // Response should not contain user data
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("uid");
  });
});
