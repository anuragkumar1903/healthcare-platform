// Manual mock for pharmacy/pgClient.js — ESM-compatible (no jest global)
// Exports a `resetMocks()` helper so test files can reset the singleton
// cleanly in beforeEach without jest.resetAllMocks() (which doesn't track
// these manually-created jest.fn() instances in ESM mode).
import { jest } from "@jest/globals";

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

  $transaction: jest.fn((arg) => {
    if (typeof arg === "function") return arg(prismaMock);
    if (Array.isArray(arg))        return Promise.all(arg);
    return Promise.resolve();
  }),

  $queryRaw:   jest.fn(),
  $executeRaw: jest.fn(),
  $connect:    jest.fn(),
  $disconnect: jest.fn(),
};

/**
 * Reset every jest.fn() on prismaMock to a clean state, then restore the
 * default $transaction pass-through.  Call this in beforeEach.
 */
export const resetMocks = () => {
  const models = [
    prismaMock.category, prismaMock.medicine, prismaMock.cartItem,
    prismaMock.order, prismaMock.orderItem, prismaMock.prescription,
  ];
  models.forEach((model) =>
    Object.values(model).forEach((fn) => fn.mockReset())
  );
  prismaMock.$queryRaw.mockReset();
  prismaMock.$executeRaw.mockReset();
  prismaMock.$connect.mockReset();
  prismaMock.$disconnect.mockReset();

  // Restore default $transaction: passes prismaMock itself as tx
  prismaMock.$transaction.mockReset();
  prismaMock.$transaction.mockImplementation((arg) => {
    if (typeof arg === "function") return arg(prismaMock);
    if (Array.isArray(arg))        return Promise.all(arg);
    return Promise.resolve();
  });
};

export const connectPharmacyDB = jest.fn().mockResolvedValue(undefined);
export default prismaMock;
