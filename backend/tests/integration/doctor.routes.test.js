/**
 * Integration Tests — Doctor / Stats Routes
 * Uses: supertest + mongodb-memory-server + real Express app
 *
 * Routes tested:
 *   GET /doctors/searchdoctor
 *   GET /doctors/listdoctors
 *   GET /doctors/stats          (public, cached)
 *   GET /doctors/totaldoctors   (protected)
 *   GET /doctors/totalusers     (protected)
 *   GET /health                 (server health check)
 */

import request from "supertest";
import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import { connectTestDB, clearTestDB, closeTestDB } from "../setup.js";

jest.unstable_mockModule("../../utils/cloudinary.js", () => ({
  uploadToCloudinary: jest.fn().mockResolvedValue("https://cdn.test/img.jpg"),
}));
jest.unstable_mockModule("../../mailingconfig.js", () => ({
  default: { sendMail: jest.fn().mockResolvedValue({}) },
}));

// Gemini AI — prevent real API calls
jest.unstable_mockModule("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn(() => ({
    getGenerativeModel: jest.fn(() => ({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          candidates: [{
            content: { parts: [{ text: '{"professions":[],"departments":[]}' }] },
          }],
        },
      }),
    })),
  })),
}));

jest.unstable_mockModule("@upstash/redis", () => ({
  Redis: jest.fn(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
  })),
}));

const app = (await import("../app.js")).default;
const { clearStatsCache } = await import("../../controllers/getdetails.js");

process.env.JWT_SECRET = "integration_test_secret_32_chars!!";

beforeAll(() => connectTestDB());
afterEach(async () => { clearStatsCache(); await clearTestDB(); });
afterAll(() => closeTestDB());

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "15m" });

const authHdr = (token) => ({ Authorization: `Bearer ${token}` });

const seedDoctor = async (overrides = {}) => {
  const ts = Date.now() + Math.random();
  const body = {
    name: "Dr. Search", email: `dr${ts}@test.com`,
    phone: "9000000003", username: `dr${ts}`,
    password: "password123", gender: "female", role: "doctor",
    bio: "Experienced neurologist", mciNumber: `MCI${ts}`,
    department: "Neurology", experience: 5,
    profession: ["Neurologist"], certificate: null,
    ...overrides,
  };
  const res = await request(app).post("/auth/register/doctor").send(body);
  return res.body.doctor;
};

const seedUser = async () => {
  const ts = Date.now();
  const body = {
    name: "Test User", email: `u${ts}@test.com`,
    phone: "9876543210", username: `u${ts}`,
    password: "password123", gender: "male", role: "user",
  };
  await request(app).post("/auth/register/user").send(body);
  const login = await request(app).post("/auth/login").send({
    email: body.email, password: body.password, role: "user",
  });
  return { token: login.body.accessToken };
};

// ─── GET /health ──────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });
});

// ─── GET /doctors/listdoctors ─────────────────────────────────────────────────

describe("GET /doctors/listdoctors", () => {
  it("returns 200 with empty doctors list when DB is empty", async () => {
    const res = await request(app).get("/doctors/listdoctors");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.doctors)).toBe(true);
  });

  it("returns 200 with doctors after seeding", async () => {
    await seedDoctor();
    const res = await request(app).get("/doctors/listdoctors");
    expect(res.status).toBe(200);
    expect(res.body.doctors.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty("totalDoctors");
    expect(res.body).toHaveProperty("lastId");
  });

  it("supports cursor-based pagination via lastId", async () => {
    await seedDoctor();
    const first = await request(app).get("/doctors/listdoctors?limit=1");
    const lastId = first.body.lastId;
    const second = await request(app).get(`/doctors/listdoctors?lastId=${lastId}&limit=10`);
    expect(second.status).toBe(200);
    // Doctors returned should not include the one with lastId
    const ids = second.body.doctors.map((d) => d._id);
    expect(ids).not.toContain(lastId);
  });

  it("respects the limit query parameter", async () => {
    await seedDoctor();
    await seedDoctor({ phone: "9000000004", mciNumber: `X${Date.now()}` });
    const res = await request(app).get("/doctors/listdoctors?limit=1");
    expect(res.status).toBe(200);
    expect(res.body.doctors.length).toBeLessThanOrEqual(1);
  });
});

// ─── GET /doctors/searchdoctor ────────────────────────────────────────────────

describe("GET /doctors/searchdoctor", () => {
  it("returns 200 with empty results for unmatched query", async () => {
    const res = await request(app).get("/doctors/searchdoctor?query=zzznomatch");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.doctors).toEqual([]);
  });

  it("returns 200 with matched doctor for name query", async () => {
    await seedDoctor();
    const res = await request(app).get("/doctors/searchdoctor?query=Search");
    expect(res.status).toBe(200);
    expect(res.body.doctors.length).toBeGreaterThan(0);
  });

  it("returns 200 for department query", async () => {
    await seedDoctor();
    const res = await request(app).get("/doctors/searchdoctor?query=Neurology");
    expect(res.status).toBe(200);
    expect(res.body.doctors.length).toBeGreaterThan(0);
  });

  it("returns pagination metadata in response", async () => {
    const res = await request(app).get("/doctors/searchdoctor?query=test&page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("page");
    expect(res.body.page).toBe(1);
  });

  it("handles symptom queries without crashing (AI path)", async () => {
    const res = await request(app).get("/doctors/searchdoctor?query=I+have+chest+pain&isDoctor=false");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("skips AI path when isDoctor=true", async () => {
    const res = await request(app).get("/doctors/searchdoctor?query=I+have+fever&isDoctor=true");
    expect(res.status).toBe(200);
  });

  it("returns 200 for empty query string (list all)", async () => {
    await seedDoctor();
    const res = await request(app).get("/doctors/searchdoctor?query=");
    expect(res.status).toBe(200);
  });

  it("safely handles regex special characters in query", async () => {
    const res = await request(app).get("/doctors/searchdoctor?query=Dr.+(Cardio)");
    expect(res.status).toBe(200);
  });
});

// ─── GET /doctors/stats (public) ──────────────────────────────────────────────

describe("GET /doctors/stats", () => {
  it("returns 200 with totalDoctors and totalUsers", async () => {
    const res = await request(app).get("/doctors/stats");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.totalDoctors).toBe("number");
    expect(typeof res.body.totalUsers).toBe("number");
  });

  it("reflects actual counts after seeding", async () => {
    await seedDoctor();
    await seedUser();
    const res = await request(app).get("/doctors/stats");
    expect(res.status).toBe(200);
    expect(res.body.totalDoctors).toBeGreaterThanOrEqual(1);
    expect(res.body.totalUsers).toBeGreaterThanOrEqual(1);
  });
});

// ─── GET /doctors/totaldoctors (protected) ────────────────────────────────────

describe("GET /doctors/totaldoctors", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/doctors/totaldoctors");
    expect(res.status).toBe(401);
  });

  it("returns 200 with count for authenticated user", async () => {
    await seedDoctor();
    const token = makeToken({ _id: "uid", role: "user" });
    const res = await request(app)
      .get("/doctors/totaldoctors")
      .set(authHdr(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalDoctors");
    expect(res.body.totalDoctors).toBeGreaterThanOrEqual(1);
  });
});

// ─── GET /doctors/totalusers (protected) ─────────────────────────────────────

describe("GET /doctors/totalusers", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/doctors/totalusers");
    expect(res.status).toBe(401);
  });

  it("returns 200 with user count for authenticated user", async () => {
    await seedUser();
    const token = makeToken({ _id: "uid", role: "user" });
    const res = await request(app)
      .get("/doctors/totalusers")
      .set(authHdr(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalUsers");
    expect(res.body.totalUsers).toBeGreaterThanOrEqual(1);
  });
});
