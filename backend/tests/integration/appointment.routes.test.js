/**
 * Integration Tests — Appointment Routes
 * Uses: supertest + mongodb-memory-server + real Express app (tests/app.js)
 *
 * Routes tested:
 *   POST   /appointments/create
 *   GET    /appointments/current/:userId
 *   GET    /appointments/history/:userId
 *   GET    /appointments/docapp/:doctorId
 *   GET    /appointments/all
 *   GET    /appointments/stats
 *   POST   /appointments/veify
 *   DELETE /appointments/:id
 */

import request from "supertest";
import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { connectTestDB, clearTestDB, closeTestDB } from "../setup.js";

jest.unstable_mockModule("../../utils/cloudinary.js", () => ({
  uploadToCloudinary: jest.fn().mockResolvedValue("https://cdn.test/img.jpg"),
}));
jest.unstable_mockModule("../../mailingconfig.js", () => ({
  default: { sendMail: jest.fn().mockResolvedValue({}) },
}));

const app = (await import("../app.js")).default;

process.env.JWT_SECRET         = "integration_test_secret_32_chars!!";
process.env.JWT_REFRESH_SECRET = "integration_refresh_secret_32!!";

beforeAll(() => connectTestDB());
afterEach(() => clearTestDB());
afterAll(() => closeTestDB());

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "15m" });

const authHdr = (token) => ({ Authorization: `Bearer ${token}` });

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
  return { userId: login.body.user._id, token: login.body.accessToken, email: body.email };
};

const seedDoctor = async () => {
  const ts = Date.now();
  const body = {
    name: "Dr. Test", email: `d${ts}@test.com`,
    phone: "9000000002", username: `d${ts}`,
    password: "password123", gender: "male", role: "doctor",
    bio: "Expert cardiologist", mciNumber: `MCI${ts}`,
    department: "Cardiology", experience: 8,
    profession: ["Cardiologist"], certificate: null,
  };
  const reg = await request(app).post("/auth/register/doctor").send(body);
  const login = await request(app).post("/auth/login").send({
    email: body.email, password: body.password, role: "doctor",
  });
  return {
    doctorId: reg.body.doctor?._id ?? login.body.user?._id,
    token: login.body.accessToken,
  };
};

const apptBody = (userId, doctorId, email) => ({
  patientName: "Test Patient", patientContact: "9876543210",
  gender: "male", age: 30,
  title: "Checkup", desc: "Routine checkup",
  expectedDate: new Date(Date.now() + 86400000).toISOString(),
  patientAddress: "123 Main St", disease: "none",
  mode: "online", doctorId, userId, email,
});

// ─── POST /appointments/create ────────────────────────────────────────────────

describe("POST /appointments/create", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app).post("/appointments/create").send({});
    expect(res.status).toBe(401);
  });

  it("returns 404 when doctor/user IDs do not exist in DB", async () => {
    const { token } = await seedUser();
    const res = await request(app)
      .post("/appointments/create")
      .set(authHdr(token))
      .send(apptBody(
        new mongoose.Types.ObjectId().toString(),
        new mongoose.Types.ObjectId().toString(),
        "x@test.com",
      ));
    expect(res.status).toBe(404);
  });

  it("returns 201 and creates appointment with valid data", async () => {
    const { userId, token, email } = await seedUser();
    const { doctorId } = await seedDoctor();
    const res = await request(app)
      .post("/appointments/create")
      .set(authHdr(token))
      .send(apptBody(userId, doctorId, email));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.appointment).toHaveProperty("appointmentID");
  });

  it("generates a non-empty appointmentID string", async () => {
    const { userId, token, email } = await seedUser();
    const { doctorId } = await seedDoctor();
    const res = await request(app)
      .post("/appointments/create")
      .set(authHdr(token))
      .send(apptBody(userId, doctorId, email));
    expect(typeof res.body.appointment.appointmentID).toBe("string");
    expect(res.body.appointment.appointmentID.length).toBeGreaterThan(0);
  });
});

// ─── GET /appointments/current/:userId ───────────────────────────────────────

describe("GET /appointments/current/:userId", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/appointments/current/someId");
    expect(res.status).toBe(401);
  });

  it("returns 404 for invalid ObjectId format", async () => {
    const { token } = await seedUser();
    const res = await request(app)
      .get("/appointments/current/not-an-id")
      .set(authHdr(token));
    expect(res.status).toBe(404);
  });

  it("returns 404 when user has no upcoming appointments", async () => {
    const { userId, token } = await seedUser();
    const res = await request(app)
      .get(`/appointments/current/${userId}`)
      .set(authHdr(token));
    expect(res.status).toBe(404);
  });

  it("returns 200 with appointments after booking", async () => {
    const { userId, token, email } = await seedUser();
    const { doctorId } = await seedDoctor();
    await request(app)
      .post("/appointments/create")
      .set(authHdr(token))
      .send(apptBody(userId, doctorId, email));
    const res = await request(app)
      .get(`/appointments/current/${userId}`)
      .set(authHdr(token));
    expect(res.status).toBe(200);
    expect(res.body.totalAppointments).toBeGreaterThan(0);
  });
});

// ─── GET /appointments/history/:userId ───────────────────────────────────────

describe("GET /appointments/history/:userId", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/appointments/history/someId");
    expect(res.status).toBe(401);
  });

  it("returns 200 with empty array when no history", async () => {
    const { userId, token } = await seedUser();
    const res = await request(app)
      .get(`/appointments/history/${userId}`)
      .set(authHdr(token));
    expect(res.status).toBe(200);
    expect(res.body.appointments).toEqual([]);
  });
});

// ─── GET /appointments/docapp/:doctorId ──────────────────────────────────────

describe("GET /appointments/docapp/:doctorId", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/appointments/docapp/someId");
    expect(res.status).toBe(401);
  });

  it("returns 200 with empty arrays for doctor with no appointments", async () => {
    const { doctorId, token } = await seedDoctor();
    const res = await request(app)
      .get(`/appointments/docapp/${doctorId}`)
      .set(authHdr(token));
    expect(res.status).toBe(200);
    expect(res.body.pendingAppointments).toEqual([]);
    expect(res.body.approvedAppointments).toEqual([]);
  });

  it("returns pending appointment after patient books", async () => {
    const { userId, token: userToken, email } = await seedUser();
    const { doctorId, token: docToken } = await seedDoctor();
    await request(app)
      .post("/appointments/create")
      .set(authHdr(userToken))
      .send(apptBody(userId, doctorId, email));
    const res = await request(app)
      .get(`/appointments/docapp/${doctorId}`)
      .set(authHdr(docToken));
    expect(res.status).toBe(200);
    expect(res.body.pendingAppointments.length).toBeGreaterThan(0);
  });
});

// ─── GET /appointments/all ────────────────────────────────────────────────────

describe("GET /appointments/all", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/appointments/all");
    expect(res.status).toBe(401);
  });

  it("returns 404 when no appointments exist", async () => {
    const token = makeToken({ _id: "aid", role: "admin" });
    const res = await request(app).get("/appointments/all").set(authHdr(token));
    expect(res.status).toBe(404);
  });

  it("returns 200 with all appointments after booking", async () => {
    const { userId, token, email } = await seedUser();
    const { doctorId } = await seedDoctor();
    await request(app)
      .post("/appointments/create")
      .set(authHdr(token))
      .send(apptBody(userId, doctorId, email));
    const adminToken = makeToken({ _id: "aid", role: "admin" });
    const res = await request(app).get("/appointments/all").set(authHdr(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.totalAppointments).toBeGreaterThan(0);
  });
});

// ─── GET /appointments/stats ──────────────────────────────────────────────────

describe("GET /appointments/stats", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/appointments/stats");
    expect(res.status).toBe(401);
  });

  it("returns 200 with all stat fields", async () => {
    const token = makeToken({ _id: "uid", role: "user" });
    const res = await request(app).get("/appointments/stats").set(authHdr(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalAppointments");
    expect(res.body).toHaveProperty("pendingAppointments");
    expect(res.body).toHaveProperty("approvedAppointments");
    expect(res.body).toHaveProperty("rejectedAppointments");
    expect(res.body).toHaveProperty("completedAppointments");
  });
});

// ─── DELETE /appointments/:id ─────────────────────────────────────────────────

describe("DELETE /appointments/:id", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).delete("/appointments/someId");
    expect(res.status).toBe(401);
  });

  it("returns 404 when appointment does not exist", async () => {
    const token = makeToken({ _id: "uid", role: "user" });
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete(`/appointments/${fakeId}`)
      .set(authHdr(token))
      .send({ role: "user" });
    expect(res.status).toBe(404);
  });

  it("returns 200 and deletes a pending appointment", async () => {
    const { userId, token, email } = await seedUser();
    const { doctorId } = await seedDoctor();
    const create = await request(app)
      .post("/appointments/create")
      .set(authHdr(token))
      .send(apptBody(userId, doctorId, email));
    const apptId = create.body.appointment._id;
    const res = await request(app)
      .delete(`/appointments/${apptId}`)
      .set(authHdr(token))
      .send({ role: "user" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 403 when user tries to cancel non-pending appointment", async () => {
    // Direct model manipulation to set state to 'approved'
    const { userId, token, email } = await seedUser();
    const { doctorId } = await seedDoctor();
    const create = await request(app)
      .post("/appointments/create")
      .set(authHdr(token))
      .send(apptBody(userId, doctorId, email));
    const apptId = create.body.appointment._id;

    // Update state directly via Mongoose
    const Appointment = (await import("../../models/Appointment.js")).default;
    await Appointment.findByIdAndUpdate(apptId, { state: "approved" });

    const res = await request(app)
      .delete(`/appointments/${apptId}`)
      .set(authHdr(token))
      .send({ role: "user" });
    expect(res.status).toBe(403);
  });
});

// ─── POST /appointments/veify ─────────────────────────────────────────────────

describe("POST /appointments/veify", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).post("/appointments/veify").send({});
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    const token = makeToken({ _id: "uid", role: "user" });
    const res = await request(app)
      .post("/appointments/veify")
      .set(authHdr(token))
      .send({ meetingPassword: "pass" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent appointmentID", async () => {
    const token = makeToken({ _id: "uid", role: "user" });
    const res = await request(app)
      .post("/appointments/veify")
      .set(authHdr(token))
      .send({ meetingPassword: "pass", appointmentID: "CAR99999999" });
    expect(res.status).toBe(404);
  });
});
