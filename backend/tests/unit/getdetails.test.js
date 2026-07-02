/**
 * Unit Tests — getdetails controller
 * Tests: searchdoctor, getDoctors, getTotalDoctors, getTotalUsers, getStats
 *
 * Mocks: Doctor, User models and @google/generative-ai, @upstash/redis
 */

import { jest } from "@jest/globals";

// ─── Mock external deps ────────────────────────────────────────────────────────
jest.unstable_mockModule("../../models/Doctor.js", () => ({
  default: {
    find:                   jest.fn(),
    aggregate:              jest.fn(),
    countDocuments:         jest.fn(),
    estimatedDocumentCount: jest.fn(),
  },
}));

jest.unstable_mockModule("../../models/user.js", () => ({
  default: {
    countDocuments:         jest.fn(),
    estimatedDocumentCount: jest.fn(),
  },
}));

// Mock Gemini AI
jest.unstable_mockModule("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          candidates: [{
            content: {
              parts: [{ text: '{"professions":["Cardiologist"],"departments":["Cardiology"]}' }],
            },
          }],
        },
      }),
    }),
  })),
}));

// Mock @upstash/redis — no Redis in tests
jest.unstable_mockModule("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
  })),
}));

// ─── Dynamic imports ─────────────────────────────────────────────────────────
const { default: Doctor } = await import("../../models/Doctor.js");
const { default: User }   = await import("../../models/user.js");

const {
  searchdoctor,
  getDoctors,
  getTotalDoctors,
  getTotalUsers,
  getStats,
} = await import("../../controllers/getdetails.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  ...overrides,
});

const makeDoctorQuery = (arr = []) => ({
  limit:  jest.fn().mockReturnThis(),
  skip:   jest.fn().mockReturnThis(),
  sort:   jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  find:   jest.fn().mockReturnThis(),
  then:   (fn) => Promise.resolve(fn(arr)),
  // Make it thenable (await-able)
  [Symbol.asyncIterator]: undefined,
});

const mockDoctorFind = (arr = []) => {
  const chain = {
    limit:  jest.fn().mockReturnThis(),
    skip:   jest.fn().mockReturnThis(),
    sort:   jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue(arr),
  };
  return chain;
};

// Fake doctor with toObject()
const fakeDoctor = (overrides = {}) => ({
  _id: "did001",
  name: "Dr. Smith",
  department: "Cardiology",
  profession: ["Cardiologist"],
  image: null,
  rating: 4.5,
  fee: 500,
  bio: "Expert cardiologist",
  doctorId: "CAR-0001",
  toObject: jest.fn().mockReturnThis(),
  ...overrides,
});

// ─── searchdoctor ─────────────────────────────────────────────────────────────
describe("searchdoctor", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 200 with empty doctors array for no match", async () => {
    Doctor.find.mockReturnValueOnce({
      limit:  jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([]),
    });
    const req = mockReq({ query: { query: "zzznomatch" } });
    const res = mockRes();
    await searchdoctor(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.doctors).toEqual([]);
  });

  it("returns 200 with doctors on a name search", async () => {
    const doctors = [fakeDoctor()];
    Doctor.find.mockReturnValueOnce({
      limit:  jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce(doctors),
    });
    const req = mockReq({ query: { query: "Smith" } });
    const res = mockRes();
    await searchdoctor(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].totalResults).toBe(1);
  });

  it("triggers AI path when query looks like a symptom", async () => {
    // Provide professions/departments for the AI prompt
    Doctor.aggregate
      .mockResolvedValueOnce([{ professions: ["Cardiologist"] }])
      .mockResolvedValueOnce([{ departments: ["Cardiology"] }]);

    Doctor.find.mockReturnValueOnce({
      limit:  jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([fakeDoctor()]),
    });

    const req = mockReq({ query: { query: "I have chest pain", isDoctor: "false" } });
    const res = mockRes();
    await searchdoctor(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("falls back to regex search when AI returns empty arrays", async () => {
    Doctor.aggregate
      .mockResolvedValueOnce([{ professions: [] }])
      .mockResolvedValueOnce([{ departments: [] }]);

    Doctor.find.mockReturnValueOnce({
      limit:  jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([]),
    });

    const req = mockReq({ query: { query: "I have fever", isDoctor: "false" } });
    const res = mockRes();
    await searchdoctor(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Doctor.find).toHaveBeenCalled();
  });

  it("returns 200 with pagination metadata", async () => {
    Doctor.find.mockReturnValueOnce({
      limit:  jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([fakeDoctor()]),
    });
    const req = mockReq({ query: { query: "cardio", page: "2", limit: "5" } });
    const res = mockRes();
    await searchdoctor(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.page).toBe(2);
  });

  it("returns 500 on DB error", async () => {
    Doctor.find.mockImplementationOnce(() => { throw new Error("DB crash"); });
    const req = mockReq({ query: { query: "cardio" } });
    const res = mockRes();
    await searchdoctor(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("escapes regex special characters in query", async () => {
    Doctor.find.mockReturnValueOnce({
      limit:  jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([]),
    });
    const req = mockReq({ query: { query: "Dr. Smith (Cardio)" } });
    const res = mockRes();
    // Should not throw on special chars
    await searchdoctor(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("skips AI path when isDoctor=true", async () => {
    Doctor.find.mockReturnValueOnce({
      limit:  jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([]),
    });
    const req = mockReq({ query: { query: "I have headache", isDoctor: "true" } });
    const res = mockRes();
    await searchdoctor(req, res);
    // aggregate should NOT be called for doctor-side search
    expect(Doctor.aggregate).not.toHaveBeenCalled();
  });
});

// ─── getDoctors ──────────────────────────────────────────────────────────────
describe("getDoctors", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 200 with paginated doctors", async () => {
    const doctors = [fakeDoctor()];
    Doctor.find.mockReturnValueOnce({
      sort:   jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce(doctors),
    });
    Doctor.countDocuments.mockResolvedValueOnce(1);
    const req = mockReq({ query: { limit: "10" } });
    const res = mockRes();
    await getDoctors(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.totalDoctors).toBe(1);
    expect(body.doctors).toHaveLength(1);
    expect(body).toHaveProperty("lastId");
  });

  it("returns 200 with cursor-based pagination using lastId", async () => {
    Doctor.find.mockReturnValueOnce({
      sort:   jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([fakeDoctor()]),
    });
    Doctor.countDocuments.mockResolvedValueOnce(50);
    const req = mockReq({ query: { lastId: "507f1f77bcf86cd799439011", limit: "10" } });
    const res = mockRes();
    await getDoctors(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    // Verify find was called with a $gt filter
    expect(Doctor.find).toHaveBeenCalledWith(expect.objectContaining({ _id: expect.any(Object) }));
  });

  it("returns lastId as null when no doctors returned", async () => {
    Doctor.find.mockReturnValueOnce({
      sort:   jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([]),
    });
    Doctor.countDocuments.mockResolvedValueOnce(0);
    const req = mockReq({ query: {} });
    const res = mockRes();
    await getDoctors(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.lastId).toBeNull();
  });

  it("returns 500 on DB error", async () => {
    Doctor.find.mockImplementationOnce(() => { throw new Error("DB fail"); });
    const req = mockReq({ query: {} });
    const res = mockRes();
    await getDoctors(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── getTotalDoctors ──────────────────────────────────────────────────────────
describe("getTotalDoctors", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 200 with correct count", async () => {
    Doctor.countDocuments.mockResolvedValueOnce(42);
    const req = mockReq();
    const res = mockRes();
    await getTotalDoctors(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({ success: true, totalDoctors: 42 });
  });

  it("returns 500 on DB error", async () => {
    Doctor.countDocuments.mockRejectedValueOnce(new Error("DB fail"));
    const req = mockReq();
    const res = mockRes();
    await getTotalDoctors(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── getTotalUsers ────────────────────────────────────────────────────────────
describe("getTotalUsers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 200 with correct count", async () => {
    User.countDocuments.mockResolvedValueOnce(150);
    const req = mockReq();
    const res = mockRes();
    await getTotalUsers(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({ success: true, totalUsers: 150 });
  });

  it("returns 500 on error", async () => {
    User.countDocuments.mockRejectedValueOnce(new Error("fail"));
    const req = mockReq();
    const res = mockRes();
    await getTotalUsers(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────
// getStats holds a module-level in-memory cache (_statsCache).
// We must reset Jest's module registry before each test so each test gets a
// fresh module with an empty cache — otherwise the first test's result poisons
// subsequent tests and the 500 branch can never be reached.
describe("getStats", () => {
  let freshGetStats;
  let freshDoctor;
  let freshUser;

  beforeEach(async () => {
    jest.resetModules();

    // Re-register mocks AFTER resetModules so the fresh module picks them up
    jest.unstable_mockModule("../../models/Doctor.js", () => ({
      default: {
        find:                   jest.fn(),
        aggregate:              jest.fn(),
        countDocuments:         jest.fn(),
        estimatedDocumentCount: jest.fn(),
      },
    }));
    jest.unstable_mockModule("../../models/user.js", () => ({
      default: {
        countDocuments:         jest.fn(),
        estimatedDocumentCount: jest.fn(),
      },
    }));
    jest.unstable_mockModule("@google/generative-ai", () => ({
      GoogleGenerativeAI: jest.fn(() => ({
        getGenerativeModel: jest.fn(() => ({ generateContent: jest.fn() })),
      })),
    }));
    jest.unstable_mockModule("@upstash/redis", () => ({
      Redis: jest.fn(() => ({ get: jest.fn().mockResolvedValue(null), set: jest.fn() })),
    }));

    // Fresh imports — new module instance, empty _statsCache
    ({ default: freshDoctor } = await import("../../models/Doctor.js"));
    ({ default: freshUser   } = await import("../../models/user.js"));
    ({ getStats: freshGetStats } = await import("../../controllers/getdetails.js"));
  });

  it("returns 200 with correct totalDoctors and totalUsers", async () => {
    freshDoctor.countDocuments.mockResolvedValueOnce(25);
    freshUser.countDocuments.mockResolvedValueOnce(300);

    const req = mockReq();
    const res = mockRes();
    await freshGetStats(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.totalDoctors).toBe(25);
    expect(body.totalUsers).toBe(300);
  });

  it("returns 500 when countDocuments rejects", async () => {
    freshDoctor.countDocuments.mockRejectedValueOnce(new Error("DB fail"));
    freshUser.countDocuments.mockResolvedValueOnce(0);

    const req = mockReq();
    const res = mockRes();
    await freshGetStats(req, res);

    // Must be exactly 500 — no ambiguity, cache is empty
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("serves from cache on second call without hitting the DB", async () => {
    freshDoctor.countDocuments.mockResolvedValueOnce(10);
    freshUser.countDocuments.mockResolvedValueOnce(50);

    // First call — populates cache
    await freshGetStats(mockReq(), mockRes());

    // Second call — should use cache, NOT call countDocuments again
    const res2 = mockRes();
    await freshGetStats(mockReq(), res2);

    expect(freshDoctor.countDocuments).toHaveBeenCalledTimes(1);
    expect(res2.status).toHaveBeenCalledWith(200);
    expect(res2.json.mock.calls[0][0].totalDoctors).toBe(10);
  });
});
