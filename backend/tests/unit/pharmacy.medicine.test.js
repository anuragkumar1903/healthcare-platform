/**
 * Unit Tests — Pharmacy: medicineController + categoryController
 *
 * Uses jest.unstable_mockModule so controller and test share the same
 * prismaMock instance (moduleNameMapper removed from package.json).
 */

import { jest } from "@jest/globals";

// ─── Shared mock ──────────────────────────────────────────────────────────────
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

// Mock cloudinary used in medicineController
jest.unstable_mockModule("../../utils/cloudinary.js", () => ({
  uploadToCloudinary:   jest.fn().mockResolvedValue("https://cdn.example.com/med.jpg"),
  deleteFromCloudinary: jest.fn().mockResolvedValue({}),
}));

const {
  listMedicines,
  getMedicine,
  createMedicine,
  updateMedicine,
  deleteMedicine,
} = await import("../../pharmacy/controllers/medicineController.js");

const {
  listCategories,
  createCategory,
  deleteCategory,
} = await import("../../pharmacy/controllers/categoryController.js");

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

// Reset all mocks before every test
beforeEach(() => {
  [prismaMock.category, prismaMock.medicine, prismaMock.cartItem,
   prismaMock.order, prismaMock.orderItem, prismaMock.prescription]
    .forEach((m) => Object.values(m).forEach((fn) => fn.mockReset()));
  prismaMock.$queryRaw.mockReset();
  prismaMock.$executeRaw.mockReset();
  prismaMock.$transaction.mockReset();
  prismaMock.$transaction.mockImplementation((arg) =>
    typeof arg === "function" ? arg(prismaMock) : Promise.resolve()
  );
  jest.clearAllMocks();
});

const fakeMedicine = (overrides = {}) => ({
  id: 1, name: "Paracetamol", description: "Pain reliever",
  price: "10.50", stock: 100, imageUrl: null,
  manufacturer: "PharmaCo", dosage: "500mg",
  requiresPrescription: false, categoryId: 1,
  category: { name: "General" },
  createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

// ─── listMedicines ────────────────────────────────────────────────────────────
describe("listMedicines", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns paginated medicines with total", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(1);
    prismaMock.medicine.findMany.mockResolvedValueOnce([fakeMedicine()]);

    const req = mockReq({ query: { page: "0", size: "12" } });
    const res = mockRes();
    await listMedicines(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.totalElements).toBe(1);
    expect(body.data.content).toHaveLength(1);
    expect(body.data.content[0].price).toBe(10.5); // coerced to number
  });

  it("filters by search term", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(0);
    prismaMock.medicine.findMany.mockResolvedValueOnce([]);

    const req = mockReq({ query: { search: "Ibuprofen" } });
    const res = mockRes();
    await listMedicines(req, res);

    expect(prismaMock.medicine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) })
    );
  });

  it("filters by categoryId", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(2);
    prismaMock.medicine.findMany.mockResolvedValueOnce([fakeMedicine(), fakeMedicine({ id: 2 })]);

    const req = mockReq({ query: { categoryId: "1" } });
    const res = mockRes();
    await listMedicines(req, res);

    expect(prismaMock.medicine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ categoryId: 1 }) })
    );
  });

  it("filters by requiresPrescription=true", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(1);
    prismaMock.medicine.findMany.mockResolvedValueOnce([fakeMedicine({ requiresPrescription: true })]);

    const req = mockReq({ query: { requiresPrescription: "true" } });
    const res = mockRes();
    await listMedicines(req, res);

    expect(prismaMock.medicine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ requiresPrescription: true }) })
    );
  });

  it("uses default sort (name asc) and rejects invalid sortBy", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(0);
    prismaMock.medicine.findMany.mockResolvedValueOnce([]);

    const req = mockReq({ query: { sortBy: "injection", sortDir: "hack" } });
    const res = mockRes();
    await listMedicines(req, res);

    expect(prismaMock.medicine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: "asc" } })
    );
  });

  it("caps size at 100", async () => {
    prismaMock.medicine.count.mockResolvedValueOnce(0);
    prismaMock.medicine.findMany.mockResolvedValueOnce([]);

    const req = mockReq({ query: { size: "9999" } });
    const res = mockRes();
    await listMedicines(req, res);

    expect(prismaMock.medicine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });

  it("returns 500 on DB error", async () => {
    prismaMock.medicine.count.mockRejectedValueOnce(new Error("DB fail"));
    const req = mockReq({ query: {} });
    const res = mockRes();
    await listMedicines(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── getMedicine ──────────────────────────────────────────────────────────────
describe("getMedicine", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 404 when medicine not found", async () => {
    prismaMock.medicine.findUnique.mockResolvedValueOnce(null);
    const req = mockReq({ params: { id: "99" } });
    const res = mockRes();
    await getMedicine(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe("Medicine not found");
  });

  it("returns 200 with medicine data", async () => {
    prismaMock.medicine.findUnique.mockResolvedValueOnce(fakeMedicine());
    const req = mockReq({ params: { id: "1" } });
    const res = mockRes();
    await getMedicine(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.data.id).toBe(1);
    expect(body.data.name).toBe("Paracetamol");
  });

  it("returns 500 on DB error", async () => {
    prismaMock.medicine.findUnique.mockRejectedValueOnce(new Error("fail"));
    const req = mockReq({ params: { id: "1" } });
    const res = mockRes();
    await getMedicine(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── createMedicine ───────────────────────────────────────────────────────────
describe("createMedicine", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when required fields are missing", async () => {
    const req = mockReq({ body: { description: "test" } });
    const res = mockRes();
    await createMedicine(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/required/);
  });

  it("returns 400 when name is empty string", async () => {
    const req = mockReq({ body: { name: "  ", price: 10, stock: 5, categoryId: 1 } });
    const res = mockRes();
    await createMedicine(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 201 with created medicine on valid input", async () => {
    prismaMock.medicine.create.mockResolvedValueOnce(fakeMedicine());
    const req = mockReq({ body: { name: "Aspirin", price: 5, stock: 200, categoryId: 1 } });
    const res = mockRes();
    await createMedicine(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.name).toBe("Paracetamol");
  });

  it("returns 500 on DB error", async () => {
    prismaMock.medicine.create.mockRejectedValueOnce(new Error("DB fail"));
    const req = mockReq({ body: { name: "Aspirin", price: 5, stock: 200, categoryId: 1 } });
    const res = mockRes();
    await createMedicine(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── updateMedicine ───────────────────────────────────────────────────────────
describe("updateMedicine", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 404 when medicine does not exist", async () => {
    prismaMock.medicine.findUnique.mockResolvedValueOnce(null);
    const req = mockReq({ params: { id: "99" }, body: { name: "X", price: 1, stock: 1, categoryId: 1 } });
    const res = mockRes();
    await updateMedicine(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 with updated medicine", async () => {
    prismaMock.medicine.findUnique.mockResolvedValueOnce(fakeMedicine());
    prismaMock.medicine.update.mockResolvedValueOnce(fakeMedicine({ name: "Updated" }));
    const req = mockReq({ params: { id: "1" }, body: { name: "Updated", price: 15, stock: 50, categoryId: 1 } });
    const res = mockRes();
    await updateMedicine(req, res);
    expect(res.json.mock.calls[0][0].data).toBeDefined();
  });

  it("returns 404 via Prisma P2025 error code", async () => {
    prismaMock.medicine.findUnique.mockResolvedValueOnce(fakeMedicine());
    const err = new Error("Not found"); err.code = "P2025";
    prismaMock.medicine.update.mockRejectedValueOnce(err);
    const req = mockReq({ params: { id: "99" }, body: { name: "X", price: 1, stock: 1, categoryId: 1 } });
    const res = mockRes();
    await updateMedicine(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── deleteMedicine ───────────────────────────────────────────────────────────
describe("deleteMedicine", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 200 on successful delete", async () => {
    prismaMock.medicine.delete.mockResolvedValueOnce({});
    const req = mockReq({ params: { id: "1" } });
    const res = mockRes();
    await deleteMedicine(req, res);
    expect(res.json.mock.calls[0][0].message).toBe("Deleted");
  });

  it("returns 404 via Prisma P2025 error code", async () => {
    const err = new Error("Not found"); err.code = "P2025";
    prismaMock.medicine.delete.mockRejectedValueOnce(err);
    const req = mockReq({ params: { id: "99" } });
    const res = mockRes();
    await deleteMedicine(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── listCategories ───────────────────────────────────────────────────────────
describe("listCategories", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 200 with categories array", async () => {
    prismaMock.category.findMany.mockResolvedValueOnce([
      { id: 1, name: "General" }, { id: 2, name: "Cardiac" },
    ]);
    const req = mockReq();
    const res = mockRes();
    await listCategories(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.data).toHaveLength(2);
  });

  it("returns empty array when no categories", async () => {
    prismaMock.category.findMany.mockResolvedValueOnce([]);
    const req = mockReq();
    const res = mockRes();
    await listCategories(req, res);
    expect(res.json.mock.calls[0][0].data).toEqual([]);
  });

  it("returns 500 on DB error", async () => {
    prismaMock.category.findMany.mockRejectedValueOnce(new Error("fail"));
    const req = mockReq();
    const res = mockRes();
    await listCategories(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── createCategory ───────────────────────────────────────────────────────────
describe("createCategory", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when name is missing or blank", async () => {
    const req = mockReq({ body: { name: "  " } });
    const res = mockRes();
    await createCategory(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 201 with created category", async () => {
    prismaMock.category.create.mockResolvedValueOnce({ id: 3, name: "Antibiotics" });
    const req = mockReq({ body: { name: "Antibiotics" } });
    const res = mockRes();
    await createCategory(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.name).toBe("Antibiotics");
  });

  it("returns 409 on duplicate category name (P2002)", async () => {
    const err = new Error("Unique constraint"); err.code = "P2002";
    prismaMock.category.create.mockRejectedValueOnce(err);
    const req = mockReq({ body: { name: "General" } });
    const res = mockRes();
    await createCategory(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toBe("Category already exists");
  });
});

// ─── deleteCategory ───────────────────────────────────────────────────────────
describe("deleteCategory", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 200 on successful delete", async () => {
    prismaMock.category.delete.mockResolvedValueOnce({});
    const req = mockReq({ params: { id: "1" } });
    const res = mockRes();
    await deleteCategory(req, res);
    expect(res.json.mock.calls[0][0].message).toBe("Deleted");
  });

  it("returns 404 when category not found (P2025)", async () => {
    const err = new Error("Not found"); err.code = "P2025";
    prismaMock.category.delete.mockRejectedValueOnce(err);
    const req = mockReq({ params: { id: "99" } });
    const res = mockRes();
    await deleteCategory(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
