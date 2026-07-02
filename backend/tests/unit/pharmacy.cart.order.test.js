/**
 * Unit Tests — Pharmacy: cartController + orderController
 *
 * moduleNameMapper for pgClient removed from package.json.
 * jest.unstable_mockModule intercepts the real import path so both this
 * test file and the controllers share the SAME mock instance via Jest's
 * module registry (no split-instance problem).
 */

import { jest } from "@jest/globals";

// ─── Shared mock factory ──────────────────────────────────────────────────────

const makeModel = () => ({
  findMany:   jest.fn(),
  findUnique: jest.fn(),
  findFirst:  jest.fn(),
  create:     jest.fn(),
  update:     jest.fn(),
  delete:     jest.fn(),
  deleteMany: jest.fn(),
  count:      jest.fn(),
  upsert:     jest.fn(),
});

const prismaMock = {
  category:     makeModel(),
  medicine:     makeModel(),
  cartItem:     makeModel(),
  order:        makeModel(),
  orderItem:    makeModel(),
  prescription: makeModel(),
  $transaction: jest.fn(),
  $queryRaw:    jest.fn(),
  $executeRaw:  jest.fn(),
  $connect:     jest.fn(),
  $disconnect:  jest.fn(),
};

// Intercept the REAL import path — controllers use this path
jest.unstable_mockModule("../../pharmacy/pgClient.js", () => ({
  default:           prismaMock,
  connectPharmacyDB: jest.fn().mockResolvedValue(undefined),
}));

// ─── Import controllers AFTER mock registration ───────────────────────────────

const { getCart, addToCart, updateCartItem, removeCartItem } =
  await import("../../pharmacy/controllers/cartController.js");

const { placeOrder, getMyOrders, adminGetOrders, adminUpdateOrderStatus } =
  await import("../../pharmacy/controllers/orderController.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body: {}, params: {}, query: {},
  user: { _id: "user123", role: "user" },
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
  shippingAddress: "123 Main St", paymentMethod: "COD",
  status: "PENDING", prescriptionId: null,
  createdAt: new Date(), updatedAt: new Date(),
  items: [{ id: 1, medicineId: 1, medicineName: "Paracetamol", priceAtPurchase: "10.00", quantity: 2 }],
  ...overrides,
});

// Reset all mocks + restore $transaction default before every test
const resetAll = () => {
  [prismaMock.category, prismaMock.medicine, prismaMock.cartItem,
   prismaMock.order, prismaMock.orderItem, prismaMock.prescription]
    .forEach((m) => Object.values(m).forEach((fn) => fn.mockReset()));
  prismaMock.$queryRaw.mockReset();
  prismaMock.$executeRaw.mockReset();
  prismaMock.$transaction.mockReset();
  prismaMock.$transaction.mockImplementation((arg) => {
    if (typeof arg === "function") return arg(prismaMock);
    if (Array.isArray(arg))        return Promise.all(arg);
    return Promise.resolve();
  });
};

beforeEach(resetAll);

// ─── getCart ──────────────────────────────────────────────────────────────────

describe("getCart", () => {
  it("returns items and correct totalAmount", async () => {
    prismaMock.cartItem.findMany.mockResolvedValue([fakeCartItem()]);
    const res = mockRes();
    await getCart(mockReq(), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.items).toHaveLength(1);
    expect(data.items[0].medicineName).toBe("Paracetamol");
    expect(data.totalAmount).toBe(20);
  });

  it("returns empty cart", async () => {
    prismaMock.cartItem.findMany.mockResolvedValue([]);
    const res = mockRes();
    await getCart(mockReq(), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.items).toEqual([]);
    expect(data.totalAmount).toBe(0);
  });

  it("returns 500 on DB error", async () => {
    prismaMock.cartItem.findMany.mockRejectedValue(new Error("DB fail"));
    const res = mockRes();
    await getCart(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── addToCart ────────────────────────────────────────────────────────────────

describe("addToCart", () => {
  it("returns 400 when medicineId missing", async () => {
    const res = mockRes();
    await addToCart(mockReq({ query: { quantity: "1" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/medicineId/);
  });

  it("returns 400 when quantity < 1", async () => {
    const res = mockRes();
    await addToCart(mockReq({ query: { medicineId: "1", quantity: "0" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when medicine not found", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      medicine: { findUnique: jest.fn().mockResolvedValue(null) },
      cartItem:  { findUnique: jest.fn(), upsert: jest.fn() },
    }));
    const res = mockRes();
    await addToCart(mockReq({ query: { medicineId: "999", quantity: "1" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when out of stock", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      medicine: { findUnique: jest.fn().mockResolvedValue({ id: 1, stock: 0 }) },
      cartItem:  { findUnique: jest.fn(), upsert: jest.fn() },
    }));
    const res = mockRes();
    await addToCart(mockReq({ query: { medicineId: "1", quantity: "1" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/out of stock/i);
  });

  it("returns 400 when qty exceeds stock", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      medicine: { findUnique: jest.fn().mockResolvedValue({ id: 1, stock: 3 }) },
      cartItem:  { findUnique: jest.fn().mockResolvedValue({ quantity: 2 }), upsert: jest.fn() },
    }));
    const res = mockRes();
    await addToCart(mockReq({ query: { medicineId: "1", quantity: "5" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/available/i);
  });

  it("returns updated cart on success", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      medicine: { findUnique: jest.fn().mockResolvedValue({ id: 1, stock: 10 }) },
      cartItem:  { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    }));
    prismaMock.cartItem.findMany.mockResolvedValue([fakeCartItem()]);
    const res = mockRes();
    await addToCart(mockReq({ query: { medicineId: "1", quantity: "2" } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.items).toHaveLength(1);
    expect(data.totalAmount).toBe(20);
  });
});

// ─── updateCartItem ───────────────────────────────────────────────────────────

describe("updateCartItem", () => {
  it("returns 400 for invalid qty", async () => {
    const res = mockRes();
    await updateCartItem(mockReq({ params: { itemId: "1" }, query: { quantity: "0" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when item not found", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      cartItem: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      medicine: { findUnique: jest.fn() },
    }));
    const res = mockRes();
    await updateCartItem(mockReq({ params: { itemId: "99" }, query: { quantity: "1" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when qty exceeds stock", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      cartItem: { findFirst: jest.fn().mockResolvedValue({ id: 1, medicineId: 1 }), update: jest.fn() },
      medicine: { findUnique: jest.fn().mockResolvedValue({ stock: 2 }) },
    }));
    const res = mockRes();
    await updateCartItem(mockReq({ params: { itemId: "1" }, query: { quantity: "10" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns updated cart on success", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      cartItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, medicineId: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      medicine: { findUnique: jest.fn().mockResolvedValue({ stock: 20 }) },
    }));
    prismaMock.cartItem.findMany.mockResolvedValue([fakeCartItem({ quantity: 3 })]);
    const res = mockRes();
    await updateCartItem(mockReq({ params: { itemId: "1" }, query: { quantity: "3" } }), res);
    expect(res.json.mock.calls[0][0].data.items[0].quantity).toBe(3);
  });
});

// ─── removeCartItem ───────────────────────────────────────────────────────────

describe("removeCartItem", () => {
  it("returns 404 when item not found", async () => {
    prismaMock.cartItem.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await removeCartItem(mockReq({ params: { itemId: "99" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("deletes item and returns empty cart", async () => {
    prismaMock.cartItem.findFirst.mockResolvedValue({ id: 1 });
    prismaMock.cartItem.delete.mockResolvedValue({});
    prismaMock.cartItem.findMany.mockResolvedValue([]);
    const res = mockRes();
    await removeCartItem(mockReq({ params: { itemId: "1" } }), res);
    expect(prismaMock.cartItem.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.json.mock.calls[0][0].data.items).toEqual([]);
  });

  it("returns 500 on DB error", async () => {
    prismaMock.cartItem.findFirst.mockRejectedValue(new Error("fail"));
    const res = mockRes();
    await removeCartItem(mockReq({ params: { itemId: "1" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── placeOrder ───────────────────────────────────────────────────────────────

describe("placeOrder", () => {
  it("returns 400 when shippingAddress missing", async () => {
    const res = mockRes();
    await placeOrder(mockReq({ body: { paymentMethod: "COD" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/shippingAddress/);
  });

  it("returns 400 for invalid paymentMethod", async () => {
    const res = mockRes();
    await placeOrder(mockReq({ body: { shippingAddress: "123", paymentMethod: "BITCOIN" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Invalid paymentMethod/);
  });

  it("returns 400 when cart is empty", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      prescription: { findFirst: jest.fn() },
      order: { create: jest.fn() },
      $queryRaw: jest.fn(), $executeRaw: jest.fn(),
    }));
    const res = mockRes();
    await placeOrder(mockReq({ body: { shippingAddress: "123", paymentMethod: "COD" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Cart is empty/);
  });

  it("returns 400 when prescription required but not provided", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      cartItem: {
        findMany: jest.fn().mockResolvedValue([{
          quantity: 1,
          medicine: { id: 1, name: "Rx", price: "50.00", stock: 5, requiresPrescription: true },
        }]),
      },
      prescription: { findFirst: jest.fn() },
      order: { create: jest.fn() },
      $queryRaw: jest.fn(), $executeRaw: jest.fn(),
    }));
    const res = mockRes();
    await placeOrder(mockReq({ body: { shippingAddress: "123", paymentMethod: "UPI" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Prescription required/);
  });

  it("returns 400 on insufficient stock", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      cartItem: {
        findMany: jest.fn().mockResolvedValue([{
          quantity: 5,
          medicine: { id: 1, name: "Paracetamol", price: "10.00", stock: 10, requiresPrescription: false },
        }]),
        deleteMany: jest.fn(),
      },
      prescription: { findFirst: jest.fn() },
      order: { create: jest.fn().mockResolvedValue(fakeOrder()) },
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      $executeRaw: jest.fn().mockResolvedValue(0),
    }));
    const res = mockRes();
    await placeOrder(mockReq({ body: { shippingAddress: "123", paymentMethod: "COD" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Insufficient stock/);
  });

  it("returns 201 on success", async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => fn({
      cartItem: {
        findMany: jest.fn().mockResolvedValue([{
          quantity: 2,
          medicine: { id: 1, name: "Paracetamol", price: "10.00", stock: 10, requiresPrescription: false },
        }]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      prescription: { findFirst: jest.fn() },
      order: { create: jest.fn().mockResolvedValue(fakeOrder()) },
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    }));
    const res = mockRes();
    await placeOrder(mockReq({ body: { shippingAddress: "123 Main St", paymentMethod: "COD" } }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.orderNumber).toMatch(/^ORD-/);
    expect(res.json.mock.calls[0][0].data.totalAmount).toBe(20);
  });
});

// ─── getMyOrders ──────────────────────────────────────────────────────────────

describe("getMyOrders", () => {
  it("returns paginated orders", async () => {
    prismaMock.order.count.mockResolvedValue(1);
    prismaMock.order.findMany.mockResolvedValue([fakeOrder()]);
    const res = mockRes();
    await getMyOrders(mockReq({ query: { page: "0", size: "10" } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.totalElements).toBe(1);
    expect(data.content[0].orderNumber).toBe("ORD-20260701-000001");
  });

  it("respects page and size", async () => {
    prismaMock.order.count.mockResolvedValue(25);
    prismaMock.order.findMany.mockResolvedValue([]);
    const res = mockRes();
    await getMyOrders(mockReq({ query: { page: "2", size: "5" } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.page).toBe(2);
    expect(data.totalPages).toBe(5);
  });

  it("returns 500 on DB error", async () => {
    prismaMock.order.count.mockRejectedValue(new Error("fail"));
    const res = mockRes();
    await getMyOrders(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── adminGetOrders ───────────────────────────────────────────────────────────

describe("adminGetOrders", () => {
  it("returns all orders without filter", async () => {
    prismaMock.order.count.mockResolvedValue(3);
    prismaMock.order.findMany.mockResolvedValue([
      fakeOrder({ id: 1 }), fakeOrder({ id: 2 }), fakeOrder({ id: 3 }),
    ]);
    const res = mockRes();
    await adminGetOrders(mockReq({ query: {} }), res);
    expect(res.json.mock.calls[0][0].data.totalElements).toBe(3);
  });

  it("passes status filter to Prisma", async () => {
    prismaMock.order.count.mockResolvedValue(1);
    prismaMock.order.findMany.mockResolvedValue([fakeOrder({ status: "SHIPPED" })]);
    const res = mockRes();
    await adminGetOrders(mockReq({ query: { status: "SHIPPED" } }), res);
    expect(prismaMock.order.count).toHaveBeenCalledWith({ where: { status: "SHIPPED" } });
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "SHIPPED" } })
    );
  });

  it("returns 500 on DB error", async () => {
    prismaMock.order.count.mockRejectedValue(new Error("fail"));
    const res = mockRes();
    await adminGetOrders(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── adminUpdateOrderStatus ───────────────────────────────────────────────────

describe("adminUpdateOrderStatus", () => {
  it("returns 400 for invalid status", async () => {
    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    const res = mockRes();
    await adminUpdateOrderStatus(io)(
      mockReq({ params: { id: "1" }, query: { status: "FLYING" } }), res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("updates and emits socket event", async () => {
    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    prismaMock.order.update.mockResolvedValue({
      id: 1, status: "SHIPPED", orderNumber: "ORD-001", userId: "user123",
    });
    const res = mockRes();
    await adminUpdateOrderStatus(io)(
      mockReq({ params: { id: "1" }, query: { status: "SHIPPED" } }), res
    );
    expect(res.json.mock.calls[0][0].data.status).toBe("SHIPPED");
    expect(io.to).toHaveBeenCalledWith("orders:user123");
    expect(io.emit).toHaveBeenCalledWith("shipment:status",
      expect.objectContaining({ orderId: 1, status: "SHIPPED" })
    );
  });

  it("returns 404 on P2025", async () => {
    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    prismaMock.order.update.mockRejectedValue(
      Object.assign(new Error("Not found"), { code: "P2025" })
    );
    const res = mockRes();
    await adminUpdateOrderStatus(io)(
      mockReq({ params: { id: "99" }, query: { status: "DELIVERED" } }), res
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe("Order not found");
  });

  it("returns 500 on unexpected error", async () => {
    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    prismaMock.order.update.mockRejectedValue(new Error("crash"));
    const res = mockRes();
    await adminUpdateOrderStatus(io)(
      mockReq({ params: { id: "1" }, query: { status: "CANCELLED" } }), res
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
