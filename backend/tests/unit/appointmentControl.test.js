/**
 * Unit Tests — appointmentControl
 */

import { jest } from "@jest/globals";

// ─── Mock DB models ────────────────────────────────────────────────────────────

// Appointment must be constructable (new Appointment(data))
jest.unstable_mockModule("../../models/Appointment.js", () => {
  const mock = Object.assign(
    jest.fn().mockImplementation(function (data) {
      Object.assign(this, data);
      this.save = jest.fn().mockResolvedValue(this);
      this.generateAppointmentID = jest.fn().mockResolvedValue("CAR20260701AB");
    }),
    {
      find:              jest.fn(),
      findById:          jest.fn(),
      findOne:           jest.fn(),
      findByIdAndDelete: jest.fn(),
      countDocuments:    jest.fn(),
    }
  );
  return { default: mock };
});

jest.unstable_mockModule("../../models/Contract.js", () => ({
  default: { findOne: jest.fn() },
}));

jest.unstable_mockModule("../../models/Doctor.js", () => ({
  default: { findById: jest.fn() },
}));

jest.unstable_mockModule("../../models/user.js", () => ({
  default: { findById: jest.fn() },
}));

// ─── Dynamic imports ──────────────────────────────────────────────────────────
const { default: Appointment } = await import("../../models/Appointment.js");
const { default: Contract }    = await import("../../models/Contract.js");
const { default: Doctor }      = await import("../../models/Doctor.js");
const { default: User }        = await import("../../models/user.js");

const {
  createAppointment,
  getUserAppointments,
  getAppointmentHistory,
  getAllAppointments,
  getDoctorAppointments,
  getAppointmentStats,
  appointmentpasswordverify,
  cancelAppointment,
  getAppointmentLocation,
} = await import("../../controllers/appointmentControl.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

// req.user._id matches the userId used in getUserAppointments tests
const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  user: { _id: "507f1f77bcf86cd799439011", role: "user" },
  ...overrides,
});

const fakeAppointment = (overrides = {}) => ({
  _id: "apptId001",
  appointmentID: "CAR20260701AB",
  patientName: "John Doe",
  patientEmail: "john@test.com",
  patientContact: "9876543210",
  patientID: { _id: "507f1f77bcf86cd799439011", name: "John Doe", email: "john@test.com", phone: "9876543210", gender: "male" },
  doctorID: { _id: "doctorId1", name: "Dr. Smith", email: "smith@clinic.com", phone: "9000000001", profession: "Cardiologist", department: "Cardiology", experience: 10, bio: "Expert", gender: "male", username: "drsmith" },
  gender: "male",
  age: 30,
  title: "Routine Checkup",
  desc: "Annual heart checkup",
  state: "pending",
  expectedDate: new Date(Date.now() + 86400000),
  patientAddress: "123 Main St",
  disease: "none",
  mode: "online",
  ...overrides,
});

const makeChain = (arr) => {
  const chain = {};
  chain.populate = jest.fn().mockReturnValue(chain);
  chain.select   = jest.fn().mockReturnValue(chain);
  chain.lean     = jest.fn().mockResolvedValue(arr);
  return chain;
};

// ─── createAppointment ────────────────────────────────────────────────────────
describe("createAppointment", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 404 when doctor or user not found", async () => {
    Doctor.findById.mockResolvedValueOnce(null);
    User.findById.mockResolvedValueOnce(null);
    const res = mockRes();
    await createAppointment(mockReq({ body: { doctorId: "did", userId: "uid" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("calls findById for doctor and user on valid data", async () => {
    Doctor.findById.mockResolvedValueOnce({ _id: "docId1", department: "Cardiology" });
    User.findById.mockResolvedValueOnce({ _id: "uid1" });
    await createAppointment(mockReq({ body: { doctorId: "docId1", userId: "uid1", patientName: "Jane", patientContact: "9876543210", gender: "female", age: 25, title: "Checkup", desc: "Routine", expectedDate: new Date().toISOString(), patientAddress: "123 St", mode: "online", email: "jane@test.com" } }), mockRes());
    expect(Doctor.findById).toHaveBeenCalledWith("docId1");
    expect(User.findById).toHaveBeenCalledWith("uid1");
  });

  it("returns 500 on unexpected error", async () => {
    Doctor.findById.mockRejectedValueOnce(new Error("DB crash"));
    const res = mockRes();
    await createAppointment(mockReq({ body: { doctorId: "did", userId: "uid" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ─── getUserAppointments ──────────────────────────────────────────────────────
describe("getUserAppointments", () => {
  beforeEach(() => jest.resetAllMocks());

  // Must be a valid ObjectId AND match req.user._id to pass both checks
  const userId = "507f1f77bcf86cd799439011";

  it("returns 400 when userId is missing", async () => {
    const res = mockRes();
    await getUserAppointments(mockReq({ params: { userId: "" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 for invalid mongoose ObjectId", async () => {
    const res = mockRes();
    await getUserAppointments(mockReq({ params: { userId: "not-an-objectid" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 404 when no appointments exist", async () => {
    Appointment.find.mockReturnValueOnce(makeChain([]));
    const res = mockRes();
    await getUserAppointments(mockReq({ params: { userId } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("returns 200 with appointments when found", async () => {
    Appointment.find.mockReturnValueOnce(makeChain([fakeAppointment()]));
    const res = mockRes();
    await getUserAppointments(mockReq({ params: { userId } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].totalAppointments).toBe(1);
  });

  it("returns 500 on DB error", async () => {
    Appointment.find.mockImplementationOnce(() => { throw new Error("DB crash"); });
    const res = mockRes();
    await getUserAppointments(mockReq({ params: { userId } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── getAppointmentHistory ────────────────────────────────────────────────────
describe("getAppointmentHistory", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 400 when userId is missing", async () => {
    const res = mockRes();
    await getAppointmentHistory(mockReq({ params: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 200 with empty array when no history", async () => {
    Appointment.find.mockReturnValueOnce(makeChain([]));
    const res = mockRes();
    await getAppointmentHistory(mockReq({ params: { userId: "507f1f77bcf86cd799439011" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].appointments).toEqual([]);
  });

  it("returns completed and rejected appointments in history", async () => {
    const items = [
      fakeAppointment({ state: "completed" }),
      fakeAppointment({ _id: "appt2", state: "rejected", expectedDate: new Date(Date.now() - 86400000) }),
    ];
    Appointment.find.mockReturnValueOnce(makeChain(items));
    const res = mockRes();
    await getAppointmentHistory(mockReq({ params: { userId: "507f1f77bcf86cd799439011" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].totalAppointments).toBe(2);
  });
});

// ─── getAllAppointments ───────────────────────────────────────────────────────
describe("getAllAppointments", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 404 when no appointments exist", async () => {
    Appointment.find.mockReturnValueOnce(makeChain([]));
    const res = mockRes();
    await getAllAppointments(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 with all appointments", async () => {
    Appointment.find.mockReturnValueOnce(makeChain([fakeAppointment(), fakeAppointment({ _id: "appt2" })]));
    const res = mockRes();
    await getAllAppointments(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].totalAppointments).toBe(2);
  });
});

// ─── getDoctorAppointments ────────────────────────────────────────────────────
describe("getDoctorAppointments", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 400 when doctorId is missing", async () => {
    const res = mockRes();
    await getDoctorAppointments(mockReq({ params: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 200 with pending and approved buckets", async () => {
    const pending  = [fakeAppointment({ state: "pending" })];
    const approved = [fakeAppointment({ _id: "appt2", state: "approved" })];
    Appointment.find
      .mockReturnValueOnce(makeChain(pending))
      .mockReturnValueOnce(makeChain(approved));
    const res = mockRes();
    await getDoctorAppointments(mockReq({ params: { doctorId: "507f1f77bcf86cd799439011" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.pendingAppointments).toHaveLength(1);
    expect(body.approvedAppointments).toHaveLength(1);
    expect(body.totalAppointments).toBe(2);
  });
});

// ─── getAppointmentStats ──────────────────────────────────────────────────────
describe("getAppointmentStats", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 200 with all counters", async () => {
    Appointment.countDocuments
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(20);
    const res = mockRes();
    await getAppointmentStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.totalAppointments).toBe(100);
    expect(body.pendingAppointments).toBe(40);
    expect(body.approvedAppointments).toBe(30);
    expect(body.rejectedAppointments).toBe(10);
    expect(body.completedAppointments).toBe(20);
  });

  it("returns 500 on DB error", async () => {
    Appointment.countDocuments.mockRejectedValueOnce(new Error("DB fail"));
    const res = mockRes();
    await getAppointmentStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── appointmentpasswordverify ────────────────────────────────────────────────
describe("appointmentpasswordverify", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 400 when meetingPassword or appointmentID is missing", async () => {
    const res = mockRes();
    await appointmentpasswordverify(mockReq({ body: { meetingPassword: "pass" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when appointment is not found", async () => {
    Appointment.findOne.mockResolvedValueOnce(null);
    const res = mockRes();
    await appointmentpasswordverify(mockReq({ body: { meetingPassword: "pass123", appointmentID: "CAR000001" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Appointment not found" }));
  });

  it("returns 404 when contract / password doesn't match", async () => {
    Appointment.findOne.mockResolvedValueOnce({ _id: "apptId", appointmentID: "CAR000001" });
    Contract.findOne.mockResolvedValueOnce(null);
    const res = mockRes();
    await appointmentpasswordverify(mockReq({ body: { meetingPassword: "wrongpass", appointmentID: "CAR000001" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid meeting password" }));
  });

  it("returns 200 with meetingUrl on correct password", async () => {
    Appointment.findOne.mockResolvedValueOnce({ _id: "apptId123", appointmentID: "CAR000001" });
    Contract.findOne.mockResolvedValueOnce({ meetingDetails: { meetingPassword: "pass123" } });
    const res = mockRes();
    await appointmentpasswordverify(mockReq({ body: { meetingPassword: "pass123", appointmentID: "CAR000001" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].meetingUrl).toBe("apptId123");
  });
});

// ─── cancelAppointment ────────────────────────────────────────────────────────
describe("cancelAppointment", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 404 when appointment not found", async () => {
    Appointment.findById.mockResolvedValueOnce(null);
    const res = mockRes();
    await cancelAppointment(mockReq({ params: { id: "apptId1" }, body: { role: "user" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when appointment is already completed", async () => {
    Appointment.findById.mockResolvedValueOnce({ state: "completed" });
    const res = mockRes();
    await cancelAppointment(mockReq({ params: { id: "apptId1" }, body: { role: "user" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Cannot cancel a completed appointment" }));
  });

  it("returns 403 when user tries to cancel non-pending appointment", async () => {
    Appointment.findById.mockResolvedValueOnce({ state: "approved" });
    const res = mockRes();
    await cancelAppointment(mockReq({ params: { id: "apptId1" }, body: { role: "user" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 200 and deletes pending appointment for user", async () => {
    Appointment.findById.mockResolvedValueOnce({ _id: "apptId1", state: "pending" });
    Appointment.findByIdAndDelete.mockResolvedValueOnce({});
    const res = mockRes();
    await cancelAppointment(mockReq({ params: { id: "apptId1" }, body: { role: "user" } }), res);
    expect(Appointment.findByIdAndDelete).toHaveBeenCalledWith("apptId1");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 200 and lets doctor cancel any non-completed appointment", async () => {
    Appointment.findById.mockResolvedValueOnce({ _id: "apptId2", state: "approved" });
    Appointment.findByIdAndDelete.mockResolvedValueOnce({});
    const res = mockRes();
    await cancelAppointment(mockReq({ params: { id: "apptId2" }, body: { role: "doctor" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─── getAppointmentLocation ───────────────────────────────────────────────────
describe("getAppointmentLocation", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 404 when appointment not found", async () => {
    Appointment.findOne.mockResolvedValueOnce(null);
    const res = mockRes();
    await getAppointmentLocation(mockReq({ params: { appointmentId: "CAR000001" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 404 when contract has no location", async () => {
    Appointment.findOne.mockResolvedValueOnce({ _id: "apptId", appointmentID: "CAR000001" });
    Contract.findOne.mockResolvedValueOnce({ meetingDetails: {} });
    const res = mockRes();
    await getAppointmentLocation(mockReq({ params: { appointmentId: "CAR000001" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 with location when contract has location data", async () => {
    Appointment.findOne.mockResolvedValueOnce({ _id: "apptId", appointmentID: "CAR000001" });
    Contract.findOne.mockResolvedValueOnce({
      meetingDetails: { location: { city: "Mumbai", state: "MH", pincode: "400001" } },
    });
    const res = mockRes();
    await getAppointmentLocation(mockReq({ params: { appointmentId: "CAR000001" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].location.city).toBe("Mumbai");
  });
});
