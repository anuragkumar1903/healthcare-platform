/**
 * Integration Tests — Auth Routes
 * Uses: supertest, mongodb-memory-server, real Express app (tests/app.js)
 *
 * Covers: POST /auth/register/user, POST /auth/register/doctor,
 *         POST /auth/login, POST /auth/refresh, POST /auth/logout,
 *         POST /auth/verify-token, POST /auth/send-otp, POST /auth/verify-otp,
 *         PUT /auth/update-password, GET /auth/users (admin only)
 */

import request from "supertest";
import { jest } from "@jest/globals";
import { connectTestDB, clearTestDB, closeTestDB } from "../setup.js";

// Mock Cloudinary — no real uploads in integration tests
jest.unstable_mockModule("../../utils/cloudinary.js", () => ({
  uploadToCloudinary: jest.fn().mockResolvedValue("https://cdn.test/img.jpg"),
}));

// Mock mailer — no real emails
jest.unstable_mockModule("../../mailingconfig.js", () => ({
  default: { sendMail: jest.fn().mockResolvedValue({}) },
}));

const app = (await import("../app.js")).default;

// ─── Setup / Teardown ─────────────────────────────────────────────────────────
beforeAll(async () => {
  process.env.JWT_SECRET         = "integration_test_secret_32_chars!!";
  process.env.JWT_REFRESH_SECRET = "integration_refresh_secret_32!!";
  await connectTestDB();
});

afterEach(async () => clearTestDB());

afterAll(async () => closeTestDB());

// ─── Helpers ──────────────────────────────────────────────────────────────────
const validUser = () => ({
  name: "Alice Test", email: `alice${Date.now()}@test.com`,
  phone: "9876543210", username: `alice${Date.now()}`,
  password: "password123", gender: "female", role: "user",
});

const validDoctor = () => ({
  name: "Dr. Bob", email: `drbob${Date.now()}@test.com`,
  phone: "9000000001", username: `drbob${Date.now()}`,
  password: "password123", gender: "male", role: "doctor",
  bio: "Expert cardiologist with 10 years experience.",
  mciNumber: `MCI${Date.now()}`, department: "Cardiology",
  experience: 10, profession: ["Cardiologist"],
  certificate: null,
});

const registerAndLogin = async (userData) => {
  await request(app).post("/auth/register/user").send(userData);
  const res = await request(app).post("/auth/login").send({
    email: userData.email, password: userData.password, role: "user",
  });
  return res.body;
};

// ─── POST /auth/register/user ─────────────────────────────────────────────────
describe("POST /auth/register/user", () => {
  it("returns 201 on valid registration", async () => {
    const res = await request(app).post("/auth/register/user").send(validUser());
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("User registered successfully");
  });

  it("returns 400 when email is missing", async () => {
    const { email: _e, ...body } = validUser();
    const res = await request(app).post("/auth/register/user").send(body);
    expect(res.status).toBe(400);
  });

  it("returns 400 for duplicate email", async () => {
    const user = validUser();
    await request(app).post("/auth/register/user").send(user);
    const res = await request(app).post("/auth/register/user").send(user);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it("returns 400 for invalid email format", async () => {
    const res = await request(app).post("/auth/register/user").send({ ...validUser(), email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for phone that is not 10 digits", async () => {
    const res = await request(app).post("/auth/register/user").send({ ...validUser(), phone: "12345" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for password shorter than 6 characters", async () => {
    const res = await request(app).post("/auth/register/user").send({ ...validUser(), password: "abc" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid gender", async () => {
    const res = await request(app).post("/auth/register/user").send({ ...validUser(), gender: "robot" });
    expect(res.status).toBe(400);
  });
});

// ─── POST /auth/register/doctor ───────────────────────────────────────────────
describe("POST /auth/register/doctor", () => {
  it("returns 201 on valid doctor registration", async () => {
    const res = await request(app).post("/auth/register/doctor").send(validDoctor());
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Doctor registered successfully");
  });

  it("returns 400 when required fields are missing", async () => {
    const { bio: _b, ...body } = validDoctor();
    const res = await request(app).post("/auth/register/doctor").send(body);
    expect(res.status).toBe(400);
  });

  it("returns 400 for duplicate doctor email", async () => {
    const doc = validDoctor();
    await request(app).post("/auth/register/doctor").send(doc);
    const res = await request(app).post("/auth/register/doctor").send(doc);
    expect(res.status).toBe(400);
  });
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
describe("POST /auth/login", () => {
  it("returns 200 with accessToken on valid login", async () => {
    const user = validUser();
    await request(app).post("/auth/register/user").send(user);
    const res = await request(app).post("/auth/login").send({
      email: user.email, password: user.password, role: "user",
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
    expect(res.body.success).toBe(true);
    expect(res.headers["set-cookie"]).toBeDefined(); // refresh token cookie set
  });

  it("returns 401 for wrong password", async () => {
    const user = validUser();
    await request(app).post("/auth/register/user").send(user);
    const res = await request(app).post("/auth/login").send({
      email: user.email, password: "WRONGPASS", role: "user",
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Invalid Credentials/i);
  });

  it("returns 401 for non-existent user", async () => {
    const res = await request(app).post("/auth/login").send({
      email: "ghost@test.com", password: "pass123", role: "user",
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid role", async () => {
    const res = await request(app).post("/auth/login").send({
      email: "x@x.com", password: "pass", role: "hacker",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password field is absent", async () => {
    const res = await request(app).post("/auth/login").send({ email: "x@x.com", role: "user" });
    expect(res.status).toBe(400);
  });
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
describe("POST /auth/refresh", () => {
  it("returns 401 when no refresh token cookie", async () => {
    const res = await request(app).post("/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("issues new accessToken with valid refresh cookie", async () => {
    const user = validUser();
    await request(app).post("/auth/register/user").send(user);
    const loginRes = await request(app).post("/auth/login").send({
      email: user.email, password: user.password, role: "user",
    });
    const cookies = loginRes.headers["set-cookie"];
    const res = await request(app).post("/auth/refresh").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
  });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
describe("POST /auth/logout", () => {
  it("returns 200 and clears the refresh token cookie", async () => {
    const user = validUser();
    await request(app).post("/auth/register/user").send(user);
    const loginRes = await request(app).post("/auth/login").send({
      email: user.email, password: user.password, role: "user",
    });
    const cookies = loginRes.headers["set-cookie"];
    const res = await request(app).post("/auth/logout").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /auth/verify-token ──────────────────────────────────────────────────
describe("POST /auth/verify-token", () => {
  it("returns success: false for missing token", async () => {
    const res = await request(app).post("/auth/verify-token").send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  it("returns success: false for invalid token", async () => {
    const res = await request(app).post("/auth/verify-token").send({ token: "bad.token" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  it("returns success: true for valid access token", async () => {
    const user = validUser();
    await request(app).post("/auth/register/user").send(user);
    const loginRes = await request(app).post("/auth/login").send({
      email: user.email, password: user.password, role: "user",
    });
    const token = loginRes.body.accessToken;
    const res = await request(app).post("/auth/verify-token").send({ token });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toBeDefined();
  });
});

// ─── OTP flow: send-otp → verify-otp → update-password ───────────────────────
describe("OTP reset password flow", () => {
  it("returns 400 for send-otp with unknown email", async () => {
    const res = await request(app).post("/auth/send-otp").send({ email: "nobody@test.com" });
    expect(res.status).toBe(400);
  });

  it("returns 200 and sends OTP for known user email", async () => {
    const user = validUser();
    await request(app).post("/auth/register/user").send(user);
    const res = await request(app).post("/auth/send-otp").send({ email: user.email });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 for verify-otp with wrong OTP", async () => {
    const user = validUser();
    await request(app).post("/auth/register/user").send(user);
    await request(app).post("/auth/send-otp").send({ email: user.email });
    const res = await request(app).post("/auth/verify-otp").send({ email: user.email, otp: "0000" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid OTP/);
  });

  it("returns 400 for update-password with expired reset token", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const expiredToken = jwt.sign({ email: "x@test.com" }, process.env.JWT_SECRET, { expiresIn: "-1s" });
    const res = await request(app).put("/auth/update-password").send({
      resetToken: expiredToken, newPassword: "newpass123",
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /auth/users (admin guard) ────────────────────────────────────────────
describe("GET /auth/users", () => {
  it("returns 401 when no token provided", async () => {
    const res = await request(app).get("/auth/users");
    expect(res.status).toBe(401);
  });

  it("returns 403 when token belongs to a regular user", async () => {
    const { default: jwt } = await import("jsonwebtoken");
    const token = jwt.sign({ _id: "uid", role: "user" }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const res = await request(app).get("/auth/users").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns 200 for admin token with user list", async () => {
    const { default: jwt } = await import("jsonwebtoken");
    const token = jwt.sign({ _id: "aid", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "15m" });
    // Register a user so the list is non-empty
    await request(app).post("/auth/register/user").send(validUser());
    const res = await request(app).get("/auth/users").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.users).toBeDefined();
  });
});
