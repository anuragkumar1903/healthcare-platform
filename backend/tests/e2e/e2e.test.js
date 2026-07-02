/**
 * E2E Tests — Full User Journeys
 * Covers:
 *   1. Auth lifecycle: register → login → refresh → logout
 *   2. Appointment: register → book → view → cancel
 *   3. Doctor: register → login → view appointments
 *   4. OTP reset: send-otp → verify-otp → update-password → login
 *   5. Admin: list users, view all appointments, stats
 *   6. Pharmacy: browse → cart → order (Prisma mocked)
 */

import request from "supertest";
import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import { connectTestDB, clearTestDB, closeTestDB } from "../setup.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.unstable_mockModule("../../utils/cloudinary.js", () => ({
  uploadToCloudinary:   jest.fn().mockResolvedValue("https://cdn.test/img.jpg"),
  deleteFromCloudinary: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule("../../mailingconfig.js", () => ({
  default: { sendMail: jest.fn().mockResolvedValue({}) },
}));

jest.unstable_mockModule("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn(() => ({
    getGenerativeModel: jest.fn(() => ({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          candidates: [{ content: { parts: [{ text: '{"professions":[],"departments":[]}' }] } }],
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

// Pharmacy Prisma mock
const makeModel = () => ({
  findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(),
  create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  deleteMany: jest.fn(), count: jest.fn(), upsert: jest.fn(),
});
const prismaMock = {
  category: makeModel(), medicine: makeModel(), cartItem: makeModel(),
  order: makeModel(), orderItem: makeModel(), prescription: makeModel(),
  $transaction: jest.fn((arg) => typeof arg === "function" ? arg(prismaMock) : Promise.resolve()),
  $queryRaw: jest.fn(), $executeRaw: jest.fn(),
};
jest.unstable_mockModule("../../pharmacy/pgClient.js", () => ({
  default: prismaMock,
  connectPharmacyDB: jest.fn().mockResolvedValue(undefined),
}));

// ─── App imports (after mocks) ────────────────────────────────────────────────

const app         = (await import("../app.js")).default;
const pharmacyApp = (await import("../pharmacyApp.js")).default;

process.env.JWT_SECRET         = "e2e_test_secret_32_chars_long!!!!";
process.env.JWT_REFRESH_SECRET = "e2e_refresh_secret_32_chars_long!";

beforeAll(() => connectTestDB());
afterEach(async () => {
  await clearTestDB();
  [prismaMock.category, prismaMock.medicine, prismaMock.cartItem,
   prismaMock.order, prismaMock.orderItem, prismaMock.prescription]
    .forEach((m) => Object.values(m).forEach((fn) => fn.mockReset()));
  prismaMock.$queryRaw.mockReset();
  prismaMock.$executeRaw.mockReset();
  prismaMock.$transaction.mockReset();
  prismaMock.$transaction.mockImplementation((arg) =>
    typeof arg === "function" ? arg(prismaMock) : Promise.resolve()
  );
});
afterAll(() => closeTestDB());

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
const uid = () => ++_seq;

const newUser = (o = {}) => {
  const n = uid();
  return {
    name: `User ${n}`, email: `u${n}@e2e.com`,
    phone: `9${String(n).padStart(9, "0")}`, username: `user${n}`,
    password: "password123", gender: "male", role: "user", ...o,
  };
};

const newDoctor = (o = {}) => {
  const n = uid();
  return {
    name: `Doctor ${n}`, email: `d${n}@e2e.com`,
    phone: `8${String(n).padStart(9, "0")}`, username: `doc${n}`,
    password: "password123", gender: "female", role: "doctor",
    bio: "Specialist", mciNumber: `MCI${n}`,
    department: "Cardiology", experience: 5,
    profession: ["Cardiologist"], certificate: null, ...o,
  };
};

const reg  = (body) => request(app).post("/auth/register/user").send(body);
const regD = (body) => request(app).post("/auth/register/doctor").send(body);
const doLogin = (email, password, role) =>
  request(app).post("/auth/login").send({ email, password, role });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const makeAdminToken = () =>
  jwt.sign({ _id: "adminId", role: "admin" }, process.env.JWT_SECRET, { expiresIn: "15m" });

// ─── Journey 1: Auth lifecycle ────────────────────────────────────────────────

describe("E2E: Auth lifecycle", () => {
  it("register → login → refresh → logout", async () => {
    const u = newUser();

    const r = await reg(u);
    expect(r.status).toBe(201);

    const l = await doLogin(u.email, u.password, "user");
    expect(l.status).toBe(200);
    expect(l.body).toHaveProperty("accessToken");
    const cookies = l.headers["set-cookie"];

    const refresh = await request(app).post("/auth/refresh").set("Cookie", cookies);
    expect(refresh.status).toBe(200);
    expect(refresh.body).toHaveProperty("accessToken");

    const logout = await request(app).post("/auth/logout").set("Cookie", cookies);
    expect(logout.status).toBe(200);
    expect(logout.body.success).toBe(true);
  });

  it("duplicate email returns 400", async () => {
    const u = newUser();
    await reg(u);
    const dup = await reg(u);
    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/already exists/i);
  });

  it("wrong password returns 401", async () => {
    const u = newUser();
    await reg(u);
    const l = await doLogin(u.email, "WRONG", "user");
    expect(l.status).toBe(401);
  });

  it("verify-token returns success:true for valid token", async () => {
    const u = newUser();
    await reg(u);
    const l = await doLogin(u.email, u.password, "user");
    const res = await request(app).post("/auth/verify-token").send({ token: l.body.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toBeDefined();
  });

  it("refresh returns 401 after logout clears cookie", async () => {
    const u = newUser();
    await reg(u);
    const l = await doLogin(u.email, u.password, "user");
    const cookies = l.headers["set-cookie"];
    await request(app).post("/auth/logout").set("Cookie", cookies);
    const r = await request(app).post("/auth/refresh"); // no cookie
    expect(r.status).toBe(401);
  });
});

// ─── Journey 2: Appointment booking lifecycle ─────────────────────────────────

describe("E2E: Appointment booking lifecycle", () => {
  it("book → view → cancel", async () => {
    const u = newUser();
    const d = newDoctor();
    await reg(u);
    const dr = await regD(d);
    expect(dr.status).toBe(201);
    const doctorId = dr.body.doctor._id;

    const l = await doLogin(u.email, u.password, "user");
    const token  = l.body.accessToken;
    const userId = l.body.user._id;

    const book = await request(app)
      .post("/appointments/create")
      .set(bearer(token))
      .send({
        patientName: u.name, patientContact: u.phone,
        gender: "male", age: 28, title: "Checkup", desc: "Routine",
        expectedDate: new Date(Date.now() + 86400000).toISOString(),
        patientAddress: "123 St", disease: "none",
        mode: "online", doctorId, userId, email: u.email,
      });
    expect(book.status).toBe(201);
    const apptId = book.body.appointment._id;

    const view = await request(app)
      .get(`/appointments/current/${userId}`)
      .set(bearer(token));
    expect(view.status).toBe(200);
    expect(view.body.totalAppointments).toBeGreaterThan(0);

    const cancel = await request(app)
      .delete(`/appointments/${apptId}`)
      .set(bearer(token))
      .send({ role: "user" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.success).toBe(true);

    const viewAfter = await request(app)
      .get(`/appointments/current/${userId}`)
      .set(bearer(token));
    expect(viewAfter.status).toBe(404);
  });

  it("cannot cancel an approved appointment as user", async () => {
    const u = newUser();
    const d = newDoctor();
    await reg(u);
    const dr = await regD(d);
    const doctorId = dr.body.doctor._id;

    const l = await doLogin(u.email, u.password, "user");
    const token  = l.body.accessToken;
    const userId = l.body.user._id;

    const book = await request(app)
      .post("/appointments/create")
      .set(bearer(token))
      .send({
        patientName: u.name, patientContact: u.phone,
        gender: "male", age: 28, title: "Checkup", desc: "Routine",
        expectedDate: new Date(Date.now() + 86400000).toISOString(),
        patientAddress: "123 St", disease: "none",
        mode: "online", doctorId, userId, email: u.email,
      });
    const apptId = book.body.appointment._id;

    const { default: Appointment } = await import("../../models/Appointment.js");
    await Appointment.findByIdAndUpdate(apptId, { state: "approved" });

    const cancel = await request(app)
      .delete(`/appointments/${apptId}`)
      .set(bearer(token))
      .send({ role: "user" });
    expect(cancel.status).toBe(403);
  });

  it("appointment history is empty before any completed appointments", async () => {
    const u = newUser();
    await reg(u);
    const l = await doLogin(u.email, u.password, "user");
    const res = await request(app)
      .get(`/appointments/history/${l.body.user._id}`)
      .set(bearer(l.body.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.appointments).toEqual([]);
  });
});

// ─── Journey 3: Doctor flow ───────────────────────────────────────────────────

describe("E2E: Doctor flow", () => {
  it("doctor registers, logs in, sees empty then populated appointments", async () => {
    const d = newDoctor();
    const u = newUser();

    const dr = await regD(d);
    expect(dr.status).toBe(201);
    const doctorId = dr.body.doctor._id;

    const dl = await doLogin(d.email, d.password, "doctor");
    expect(dl.status).toBe(200);
    const docToken = dl.body.accessToken;

    const empty = await request(app)
      .get(`/appointments/docapp/${doctorId}`)
      .set(bearer(docToken));
    expect(empty.status).toBe(200);
    expect(empty.body.pendingAppointments).toEqual([]);

    await reg(u);
    const ul = await doLogin(u.email, u.password, "user");
    const userToken = ul.body.accessToken;
    const userId    = ul.body.user._id;

    await request(app)
      .post("/appointments/create")
      .set(bearer(userToken))
      .send({
        patientName: u.name, patientContact: u.phone,
        gender: "male", age: 30, title: "Visit", desc: "Check",
        expectedDate: new Date(Date.now() + 86400000).toISOString(),
        patientAddress: "Addr", disease: "none",
        mode: "online", doctorId, userId, email: u.email,
      });

    const filled = await request(app)
      .get(`/appointments/docapp/${doctorId}`)
      .set(bearer(docToken));
    expect(filled.status).toBe(200);
    expect(filled.body.pendingAppointments.length).toBeGreaterThan(0);
  });
});

// ─── Journey 4: OTP password reset ───────────────────────────────────────────

describe("E2E: OTP password reset", () => {
  it("send-otp → verify-otp → update-password → login with new password", async () => {
    const u = newUser();
    await reg(u);

    const send = await request(app).post("/auth/send-otp").send({ email: u.email });
    expect(send.status).toBe(200);

    const { default: User } = await import("../../models/user.js");
    const dbUser = await User.findOne({ email: u.email });
    const otp = dbUser.otp;
    expect(otp).toMatch(/^\d{4}$/);

    const verify = await request(app).post("/auth/verify-otp").send({ email: u.email, otp });
    expect(verify.status).toBe(200);
    const resetToken = verify.body.resetToken;

    const newPwd = "newpassword456";
    const update = await request(app).put("/auth/update-password").send({ resetToken, newPassword: newPwd });
    expect(update.status).toBe(200);

    const newLogin = await doLogin(u.email, newPwd, "user");
    expect(newLogin.status).toBe(200);
    expect(newLogin.body).toHaveProperty("accessToken");

    const oldLogin = await doLogin(u.email, u.password, "user");
    expect(oldLogin.status).toBe(401);
  });

  it("wrong OTP returns 400", async () => {
    const u = newUser();
    await reg(u);
    await request(app).post("/auth/send-otp").send({ email: u.email });
    const res = await request(app).post("/auth/verify-otp").send({ email: u.email, otp: "0000" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid OTP/);
  });

  it("expired reset token returns 401 on update-password", async () => {
    const expired = jwt.sign({ email: "x@x.com" }, process.env.JWT_SECRET, { expiresIn: "-1s" });
    const res = await request(app).put("/auth/update-password").send({ resetToken: expired, newPassword: "newpass123" });
    expect(res.status).toBe(401);
  });
});

// ─── Journey 5: Admin operations ─────────────────────────────────────────────

describe("E2E: Admin operations", () => {
  it("admin lists users and passwords are not exposed", async () => {
    await reg(newUser());
    await reg(newUser());
    const res = await request(app).get("/auth/users").set(bearer(makeAdminToken()));
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(2);
    res.body.users.forEach((u) => {
      expect(u).not.toHaveProperty("password");
      expect(u).not.toHaveProperty("otp");
    });
  });

  it("non-admin cannot access /auth/users", async () => {
    const u = newUser();
    await reg(u);
    const l = await doLogin(u.email, u.password, "user");
    const res = await request(app).get("/auth/users").set(bearer(l.body.accessToken));
    expect(res.status).toBe(403);
  });

  it("admin views all appointments after booking", async () => {
    const u = newUser();
    const d = newDoctor();
    await reg(u);
    const dr = await regD(d);
    const doctorId = dr.body.doctor._id;
    const l = await doLogin(u.email, u.password, "user");
    const token  = l.body.accessToken;
    const userId = l.body.user._id;

    await request(app)
      .post("/appointments/create")
      .set(bearer(token))
      .send({
        patientName: u.name, patientContact: u.phone,
        gender: "male", age: 30, title: "Admin Test", desc: "Check",
        expectedDate: new Date(Date.now() + 86400000).toISOString(),
        patientAddress: "Addr", disease: "none",
        mode: "online", doctorId, userId, email: u.email,
      });

    const res = await request(app).get("/appointments/all").set(bearer(makeAdminToken()));
    expect(res.status).toBe(200);
    expect(res.body.totalAppointments).toBeGreaterThan(0);
  });

  it("appointment stats returns all required fields", async () => {
    const res = await request(app).get("/appointments/stats").set(bearer(makeAdminToken()));
    expect(res.status).toBe(200);
    ["totalAppointments", "pendingAppointments", "approvedAppointments",
     "rejectedAppointments", "completedAppointments"].forEach((k) => {
      expect(res.body).toHaveProperty(k);
    });
  });
});

// ─── Journey 6: Pharmacy order flow ──────────────────────────────────────────

describe("E2E: Pharmacy order flow", () => {
  const pharmToken = jwt.sign({ _id: "pharmUser", role: "user" }, process.env.JWT_SECRET, { expiresIn: "15m" });
  const authH = { Authorization: `Bearer ${pharmToken}` };

  const fakeMed = {
    id: 1, name: "Paracetamol", description: "Pain reliever",
    price: "10.00", stock: 50, imageUrl: null,
    manufacturer: "PharmaCo", dosage: "500mg",
    requiresPrescription: false, categoryId: 1,
    category: { name: "General" },
    createdAt: new Date(), updatedAt: new Date(),
  };

  const fakeCartItem = {
    id: 1, userId: "pharmUser", medicineId: 1, quantity: 2,
    medicine: { name: "Paracetamol", imageUrl: null, price: "10.00", requiresPrescription: false },
  };

  it("browse medicines list", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(1);
    prismaMock.medicine.findMany.mockResolvedValueOnce([fakeMed]);
    const res = await request(pharmacyApp).get("/api/medicines");
    expect(res.status).toBe(200);
    expect(res.body.data.content[0].name).toBe("Paracetamol");
  });

  it("get single medicine by id", async () => {
    prismaMock.medicine.findUnique.mockResolvedValueOnce(fakeMed);
    const res = await request(pharmacyApp).get("/api/medicines/1");
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Paracetamol");
  });

  it("add to cart and view cart", async () => {
    prismaMock.$transaction.mockImplementationOnce(async (fn) => fn({
      medicine: { findUnique: jest.fn().mockResolvedValue({ id: 1, stock: 10 }) },
      cartItem:  { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    }));
    prismaMock.cartItem.findMany.mockResolvedValueOnce([fakeCartItem]);

    const add = await request(pharmacyApp)
      .post("/api/cart/items?medicineId=1&quantity=2")
      .set(authH);
    expect(add.status).toBe(200);
    expect(add.body.data.totalAmount).toBe(20);

    prismaMock.cartItem.findMany.mockResolvedValueOnce([fakeCartItem]);
    const cart = await request(pharmacyApp).get("/api/cart").set(authH);
    expect(cart.status).toBe(200);
    expect(cart.body.data.items[0].medicineName).toBe("Paracetamol");
  });

  it("place order successfully", async () => {
    const fakeOrder = {
      id: 1, orderNumber: "ORD-20260701-000001",
      userId: "pharmUser", totalAmount: "20.00",
      shippingAddress: "123 St", paymentMethod: "COD",
      status: "PENDING", prescriptionId: null,
      createdAt: new Date(), updatedAt: new Date(),
      items: [{ id: 1, medicineId: 1, medicineName: "Paracetamol", priceAtPurchase: "10.00", quantity: 2 }],
    };
    prismaMock.$transaction.mockImplementationOnce(async (fn) => fn({
      cartItem: {
        findMany: jest.fn().mockResolvedValue([{
          quantity: 2,
          medicine: { id: 1, name: "Paracetamol", price: "10.00", stock: 10, requiresPrescription: false },
        }]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      prescription: { findFirst: jest.fn() },
      order: { create: jest.fn().mockResolvedValue(fakeOrder) },
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    }));

    const res = await request(pharmacyApp)
      .post("/api/orders")
      .set(authH)
      .send({ shippingAddress: "123 St", paymentMethod: "COD" });
    expect(res.status).toBe(201);
    expect(res.body.data.orderNumber).toMatch(/^ORD-/);
    expect(res.body.data.totalAmount).toBe(20);
  });

  it("empty cart returns 400 on order", async () => {
    prismaMock.$transaction.mockImplementationOnce(async (fn) => fn({
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      prescription: { findFirst: jest.fn() },
      order: { create: jest.fn() },
      $queryRaw: jest.fn(), $executeRaw: jest.fn(),
    }));
    const res = await request(pharmacyApp)
      .post("/api/orders")
      .set(authH)
      .send({ shippingAddress: "123 St", paymentMethod: "COD" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cart is empty/);
  });

  it("view order history", async () => {
    prismaMock.order.count.mockResolvedValueOnce(1);
    prismaMock.order.findMany.mockResolvedValueOnce([{
      id: 1, orderNumber: "ORD-20260701-000001",
      userId: "pharmUser", totalAmount: "20.00",
      shippingAddress: "123 St", paymentMethod: "COD",
      status: "PENDING", prescriptionId: null,
      createdAt: new Date(), updatedAt: new Date(), items: [],
    }]);
    const res = await request(pharmacyApp).get("/api/orders").set(authH);
    expect(res.status).toBe(200);
    expect(res.body.data.totalElements).toBe(1);
    expect(res.body.data.content[0].orderNumber).toMatch(/^ORD-/);
  });
});
