/**
 * Integration Tests — Pharmacy Routes
 * Uses: supertest + pharmacyApp (tests/pharmacyApp.js) + pgClient mock
 *
 * Routes tested:
 *   GET    /api/medicines
 *   GET    /api/medicines/:id
 *   POST   /api/medicines          (admin)
 *   DELETE /api/medicines/:id      (admin)
 *   GET    /api/categories
 *   POST   /api/categories         (admin)
 *   DELETE /api/categories/:id     (admin)
 *   GET    /api/cart
 *   POST   /api/cart/items
 *   DELETE /api/cart/items/:id
 *   GET    /api/orders
 *   POST   /api/orders
 *   GET    /api/prescriptions/my
 *   PATCH  /api/prescriptions/admin/:id (admin)
 */

import request from "supertest";
import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import prismaMock from "../../pharmacy/__mocks__/pgClient.js";

jest.unstable_mockModule("../../pharmacy/pgClient.js", () => ({
  default: prismaMock,
  connectPharmacyDB: jest.fn().mockResolvedValue(undefined),
}));

const app = (await import("../pharmacyApp.js")).default;

process.env.JWT_SECRET = "integration_test_secret_32_chars!!";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "15m" });

const userToken  = makeToken({ _id: "user123",  role: "user"  });
const adminToken = makeToken({ _id: "admin123", role: "admin" });

const authHdr  = (t) => ({ Authorization: `Bearer ${t}` });

const fakeMed = (overrides = {}) => ({
  id: 1, name: "Paracetamol", description: "Pain reliever",
  price: "10.00", stock: 50, imageUrl: null,
  manufacturer: "PharmaCo", dosage: "500mg",
  requiresPrescription: false, categoryId: 1,
  category: { name: "General" },
  createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const fakeCartItem = (overrides = {}) => ({
  id: 1, userId: "user123", medicineId: 1, quantity: 2,
  medicine: { name: "Paracetamol", imageUrl: null, price: "10.00", requiresPrescription: false },
  ...overrides,
});

const fakeOrder = (overrides = {}) => ({
  id: 1, orderNumber: "ORD-20260701-000001",
  userId: "user123", totalAmount: "20.00",
  shippingAddress: "123 St", paymentMethod: "COD",
  status: "PENDING", prescriptionId: null,
  createdAt: new Date(), updatedAt: new Date(),
  items: [{ id: 1, medicineId: 1, medicineName: "Paracetamol", priceAtPurchase: "10.00", quantity: 2 }],
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

// ─── GET /api/medicines ───────────────────────────────────────────────────────

describe("GET /api/medicines", () => {
  it("returns 200 with paginated medicines", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(1);
    prismaMock.medicine.findMany.mockResolvedValueOnce([fakeMed()]);

    const res = await request(app).get("/api/medicines");
    expect(res.status).toBe(200);
    expect(res.body.data.totalElements).toBe(1);
    expect(res.body.data.content[0].name).toBe("Paracetamol");
  });

  it("returns 200 with empty list when no medicines", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(0);
    prismaMock.medicine.findMany.mockResolvedValueOnce([]);

    const res = await request(app).get("/api/medicines");
    expect(res.status).toBe(200);
    expect(res.body.data.content).toEqual([]);
  });

  it("passes search param to Prisma where clause", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(0);
    prismaMock.medicine.findMany.mockResolvedValueOnce([]);

    await request(app).get("/api/medicines?search=Aspirin");
    expect(prismaMock.medicine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) })
    );
  });
});

// ─── GET /api/medicines/:id ───────────────────────────────────────────────────

describe("GET /api/medicines/:id", () => {
  it("returns 404 when medicine not found", async () => {
    prismaMock.medicine.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/medicines/999");
    expect(res.status).toBe(404);
  });

  it("returns 200 with medicine data", async () => {
    prismaMock.medicine.findUnique.mockResolvedValueOnce(fakeMed());
    const res = await request(app).get("/api/medicines/1");
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Paracetamol");
  });
});

// ─── POST /api/medicines (admin) ──────────────────────────────────────────────

describe("POST /api/medicines", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).post("/api/medicines").send({ name: "X", price: 1, stock: 1, categoryId: 1 });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin token", async () => {
    const res = await request(app)
      .post("/api/medicines")
      .set(authHdr(userToken))
      .send({ name: "X", price: 1, stock: 1, categoryId: 1 });
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await request(app)
      .post("/api/medicines")
      .set(authHdr(adminToken))
      .send({ description: "test" });
    expect(res.status).toBe(400);
  });

  it("returns 201 with created medicine for admin", async () => {
    prismaMock.medicine.create.mockResolvedValueOnce(fakeMed());
    const res = await request(app)
      .post("/api/medicines")
      .set(authHdr(adminToken))
      .send({ name: "Paracetamol", price: 10, stock: 50, categoryId: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Paracetamol");
  });
});

// ─── DELETE /api/medicines/:id (admin) ────────────────────────────────────────

describe("DELETE /api/medicines/:id", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).delete("/api/medicines/1");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin token", async () => {
    const res = await request(app).delete("/api/medicines/1").set(authHdr(userToken));
    expect(res.status).toBe(403);
  });

  it("returns 200 on successful delete by admin", async () => {
    prismaMock.medicine.delete.mockResolvedValueOnce({});
    const res = await request(app).delete("/api/medicines/1").set(authHdr(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Deleted");
  });

  it("returns 404 when medicine does not exist", async () => {
    const err = new Error("Not found"); err.code = "P2025";
    prismaMock.medicine.delete.mockRejectedValueOnce(err);
    const res = await request(app).delete("/api/medicines/999").set(authHdr(adminToken));
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/categories ──────────────────────────────────────────────────────

describe("GET /api/categories", () => {
  it("returns 200 with categories list", async () => {
    prismaMock.category.findMany.mockResolvedValueOnce([
      { id: 1, name: "General" }, { id: 2, name: "Cardiac" },
    ]);
    const res = await request(app).get("/api/categories");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

// ─── POST /api/categories (admin) ────────────────────────────────────────────

describe("POST /api/categories", () => {
  it("returns 403 for non-admin", async () => {
    const res = await request(app)
      .post("/api/categories")
      .set(authHdr(userToken))
      .send({ name: "New Cat" });
    expect(res.status).toBe(403);
  });

  it("returns 201 with new category for admin", async () => {
    prismaMock.category.create.mockResolvedValueOnce({ id: 3, name: "Antibiotics" });
    const res = await request(app)
      .post("/api/categories")
      .set(authHdr(adminToken))
      .send({ name: "Antibiotics" });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Antibiotics");
  });

  it("returns 409 for duplicate category", async () => {
    const err = new Error("Unique"); err.code = "P2002";
    prismaMock.category.create.mockRejectedValueOnce(err);
    const res = await request(app)
      .post("/api/categories")
      .set(authHdr(adminToken))
      .send({ name: "General" });
    expect(res.status).toBe(409);
  });
});

// ─── GET /api/cart ────────────────────────────────────────────────────────────

describe("GET /api/cart", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/cart");
    expect(res.status).toBe(401);
  });

  it("returns 200 with empty cart", async () => {
    prismaMock.cartItem.findMany.mockResolvedValueOnce([]);
    const res = await request(app).get("/api/cart").set(authHdr(userToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.totalAmount).toBe(0);
  });

  it("returns 200 with cart items and computed totals", async () => {
    prismaMock.cartItem.findMany.mockResolvedValueOnce([fakeCartItem()]);
    const res = await request(app).get("/api/cart").set(authHdr(userToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.totalAmount).toBe(20);
  });
});

// ─── POST /api/cart/items ─────────────────────────────────────────────────────

describe("POST /api/cart/items", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).post("/api/cart/items?medicineId=1&quantity=1");
    expect(res.status).toBe(401);
  });

  it("returns 400 when medicineId is missing", async () => {
    const res = await request(app)
      .post("/api/cart/items?quantity=1")
      .set(authHdr(userToken));
    expect(res.status).toBe(400);
  });

  it("returns 404 when medicine does not exist", async () => {
    prismaMock.$transaction.mockImplementationOnce(async (fn) => {
      const tx = {
        medicine: { findUnique: jest.fn().mockResolvedValueOnce(null) },
        cartItem: { findUnique: jest.fn(), upsert: jest.fn() },
      };
      return fn(tx);
    });
    const res = await request(app)
      .post("/api/cart/items?medicineId=999&quantity=1")
      .set(authHdr(userToken));
    expect(res.status).toBe(404);
  });

  it("returns 200 with updated cart on successful add", async () => {
    prismaMock.$transaction.mockImplementationOnce(async (fn) => {
      const tx = {
        medicine: { findUnique: jest.fn().mockResolvedValueOnce({ id: 1, stock: 10 }) },
        cartItem: { findUnique: jest.fn().mockResolvedValueOnce(null), upsert: jest.fn().mockResolvedValueOnce({}) },
      };
      return fn(tx);
    });
    prismaMock.cartItem.findMany.mockResolvedValueOnce([fakeCartItem()]);
    const res = await request(app)
      .post("/api/cart/items?medicineId=1&quantity=2")
      .set(authHdr(userToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });
});

// ─── DELETE /api/cart/items/:id ───────────────────────────────────────────────

describe("DELETE /api/cart/items/:id", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).delete("/api/cart/items/1");
    expect(res.status).toBe(401);
  });

  it("returns 404 when item not found", async () => {
    prismaMock.cartItem.findFirst.mockResolvedValueOnce(null);
    const res = await request(app).delete("/api/cart/items/99").set(authHdr(userToken));
    expect(res.status).toBe(404);
  });

  it("returns 200 with updated cart after removal", async () => {
    prismaMock.cartItem.findFirst.mockResolvedValueOnce({ id: 1 });
    prismaMock.cartItem.delete.mockResolvedValueOnce({});
    prismaMock.cartItem.findMany.mockResolvedValueOnce([]);
    const res = await request(app).delete("/api/cart/items/1").set(authHdr(userToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });
});

// ─── GET /api/orders ──────────────────────────────────────────────────────────

describe("GET /api/orders", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/orders");
    expect(res.status).toBe(401);
  });

  it("returns 200 with paginated user orders", async () => {
    prismaMock.order.count.mockResolvedValueOnce(1);
    prismaMock.order.findMany.mockResolvedValueOnce([fakeOrder()]);
    const res = await request(app).get("/api/orders").set(authHdr(userToken));
    expect(res.status).toBe(200);
    expect(res.body.data.totalElements).toBe(1);
    expect(res.body.data.content[0].orderNumber).toMatch(/^ORD-/);
  });
});

// ─── POST /api/orders ─────────────────────────────────────────────────────────

describe("POST /api/orders", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).post("/api/orders").send({ shippingAddress: "123 St", paymentMethod: "COD" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid paymentMethod", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(authHdr(userToken))
      .send({ shippingAddress: "123 St", paymentMethod: "BITCOIN" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when cart is empty", async () => {
    prismaMock.$transaction.mockImplementationOnce(async (fn) => {
      const tx = {
        cartItem: { findMany: jest.fn().mockResolvedValueOnce([]) },
        prescription: { findFirst: jest.fn() },
        order: { create: jest.fn() },
        $queryRaw: jest.fn(),
        $executeRaw: jest.fn(),
      };
      return fn(tx);
    });
    const res = await request(app)
      .post("/api/orders")
      .set(authHdr(userToken))
      .send({ shippingAddress: "123 St", paymentMethod: "COD" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cart is empty/);
  });

  it("returns 201 on successful order placement", async () => {
    const cartItems = [{
      quantity: 1,
      medicine: { id: 1, name: "Paracetamol", price: "10.00", stock: 10, requiresPrescription: false },
    }];
    prismaMock.$transaction.mockImplementationOnce(async (fn) => {
      const tx = {
        cartItem:     { findMany: jest.fn().mockResolvedValueOnce(cartItems), deleteMany: jest.fn().mockResolvedValueOnce({}) },
        prescription: { findFirst: jest.fn() },
        order:        { create: jest.fn().mockResolvedValueOnce(fakeOrder()) },
        $queryRaw:    jest.fn().mockResolvedValueOnce([{ nextval: 1n }]),
        $executeRaw:  jest.fn().mockResolvedValueOnce(1),
      };
      return fn(tx);
    });
    const res = await request(app)
      .post("/api/orders")
      .set(authHdr(userToken))
      .send({ shippingAddress: "123 Main St", paymentMethod: "COD" });
    expect(res.status).toBe(201);
    expect(res.body.data.orderNumber).toMatch(/^ORD-/);
  });
});

// ─── GET /api/prescriptions/my ────────────────────────────────────────────────

describe("GET /api/prescriptions/my", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/prescriptions/my");
    expect(res.status).toBe(401);
  });

  it("returns 200 with user prescriptions", async () => {
    prismaMock.prescription.findMany.mockResolvedValueOnce([
      { id: 1, fileUrl: "https://cdn.test/rx.jpg", status: "PENDING", createdAt: new Date() },
    ]);
    const res = await request(app).get("/api/prescriptions/my").set(authHdr(userToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// ─── PATCH /api/prescriptions/admin/:id ──────────────────────────────────────

describe("PATCH /api/prescriptions/admin/:id", () => {
  it("returns 403 for non-admin user", async () => {
    const res = await request(app)
      .patch("/api/prescriptions/admin/1")
      .set(authHdr(userToken))
      .send({ status: "APPROVED" });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid status value", async () => {
    const res = await request(app)
      .patch("/api/prescriptions/admin/1")
      .set(authHdr(adminToken))
      .send({ status: "MAYBE" });
    expect(res.status).toBe(400);
  });

  it("returns 200 after admin approves prescription", async () => {
    prismaMock.prescription.update.mockResolvedValueOnce({ id: 1, status: "APPROVED", userId: "user123" });
    const res = await request(app)
      .patch("/api/prescriptions/admin/1")
      .set(authHdr(adminToken))
      .send({ status: "APPROVED" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("APPROVED");
  });
});
