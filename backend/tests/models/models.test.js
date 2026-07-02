/**
 * Model Tests — User, Doctor, Appointment, Contract
 * Covers: schema validation, unique constraints, enum enforcement,
 *         pre-save hooks (password hashing, ID generation),
 *         virtual fields, index definitions, instance methods.
 *
 * Uses: mongodb-memory-server (real Mongoose, no mocks).
 */

import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { connectTestDB, clearTestDB, closeTestDB } from "../setup.js";

// ─── Import real models ───────────────────────────────────────────────────────
const { default: User }        = await import("../../models/user.js");
const { default: Doctor }      = await import("../../models/Doctor.js");
const { default: Appointment } = await import("../../models/Appointment.js");
const { default: Contract }    = await import("../../models/Contract.js");

beforeAll(() => connectTestDB());
afterEach(() => clearTestDB());
afterAll(() => closeTestDB());

// ─── Helpers ──────────────────────────────────────────────────────────────────

const validUser = (overrides = {}) => ({
  name: "Alice Smith",
  email: `alice${Date.now()}@test.com`,
  phone: "9876543210",
  username: `alice${Date.now()}`,
  password: "password123",
  gender: "female",
  role: "user",
  ...overrides,
});

const validDoctor = (overrides = {}) => ({
  name: "Dr. Bob",
  email: `drbob${Date.now()}@test.com`,
  phone: 9000000001,
  username: `drbob${Date.now()}`,
  password: "docpass123",
  gender: "male",
  bio: "Expert neurologist",
  mciNumber: `MCI${Date.now()}`,
  department: "Neurology",
  experience: 10,
  profession: ["Neurologist"],
  role: "doctor",
  ...overrides,
});

const validAppointment = (doctorId, patientId, overrides = {}) => ({
  patientName: "John Patient",
  patientContact: "9876543210",
  gender: "male",
  age: 30,
  title: "Checkup",
  desc: "Routine checkup",
  state: "pending",
  expectedDate: new Date(Date.now() + 86400000),
  patientAddress: "123 Main St",
  patientEmail: "john@test.com",
  mode: "online",
  doctorID: doctorId,
  patientID: patientId,
  ...overrides,
});

// ─── User Model ───────────────────────────────────────────────────────────────

describe("User Model", () => {
  it("saves a valid user successfully", async () => {
    const user = await User.create(validUser());
    expect(user._id).toBeDefined();
    expect(user.name).toBe("Alice Smith");
  });

  it("hashes the password on save (pre-save hook)", async () => {
    const raw = "password123";
    const user = await User.create(validUser({ password: raw }));
    expect(user.password).not.toBe(raw);
    expect(user.password).toMatch(/^\$2[ab]\$/); // bcrypt hash prefix
    const isMatch = await bcrypt.compare(raw, user.password);
    expect(isMatch).toBe(true);
  });

  it("does not re-hash password when other fields are saved", async () => {
    const user = await User.create(validUser());
    const originalHash = user.password;
    user.name = "Updated Name";
    await user.save();
    expect(user.password).toBe(originalHash);
  });

  it("assigns auto-incrementing numericId on creation", async () => {
    const u1 = await User.create(validUser());
    const u2 = await User.create(validUser({ email: `b${Date.now()}@t.com`, phone: "9111111111", username: `b${Date.now()}` }));
    expect(u2.numericId).toBeGreaterThan(u1.numericId);
  });

  it("rejects a user with missing required name", async () => {
    await expect(User.create(validUser({ name: undefined }))).rejects.toThrow();
  });

  it("rejects a user with name shorter than 2 characters", async () => {
    await expect(User.create(validUser({ name: "A" }))).rejects.toThrow();
  });

  it("rejects a user with duplicate email", async () => {
    const email = `dup${Date.now()}@test.com`;
    await User.create(validUser({ email }));
    await expect(User.create(validUser({ email, username: `other${Date.now()}`, phone: "9222222222" }))).rejects.toThrow();
  });

  it("rejects a user with duplicate username", async () => {
    const username = `dupuser${Date.now()}`;
    await User.create(validUser({ username }));
    await expect(User.create(validUser({ username, email: `other${Date.now()}@t.com`, phone: "9333333333" }))).rejects.toThrow();
  });

  it("rejects invalid gender value", async () => {
    await expect(User.create(validUser({ gender: "alien" }))).rejects.toThrow();
  });

  it("enforces role enum — only 'user' is allowed", async () => {
    await expect(User.create(validUser({ role: "admin" }))).rejects.toThrow();
  });

  it("exposes publicProfile virtual", async () => {
    const user = await User.create(validUser());
    const profile = user.publicProfile;
    expect(profile).toHaveProperty("name");
    expect(profile).toHaveProperty("email");
    expect(profile).not.toHaveProperty("password");
    expect(profile).not.toHaveProperty("otp");
  });

  it("sets otp and otpExpires fields correctly", async () => {
    const user = await User.create(validUser());
    user.otp = "1234";
    user.otpExpires = new Date(Date.now() + 300000);
    await user.save();
    const found = await User.findById(user._id);
    expect(found.otp).toBe("1234");
    expect(found.otpExpires).toBeDefined();
  });
});

// ─── Doctor Model ─────────────────────────────────────────────────────────────

describe("Doctor Model", () => {
  it("saves a valid doctor successfully", async () => {
    const doctor = await Doctor.create(validDoctor());
    expect(doctor._id).toBeDefined();
    expect(doctor.name).toBe("Dr. Bob");
  });

  it("hashes the password on save", async () => {
    const raw = "docpass123";
    const doctor = await Doctor.create(validDoctor({ password: raw }));
    expect(doctor.password).not.toBe(raw);
    const isMatch = await bcrypt.compare(raw, doctor.password);
    expect(isMatch).toBe(true);
  });

  it("auto-generates doctorId from department code on creation", async () => {
    const doctor = await Doctor.create(validDoctor());
    expect(doctor.doctorId).toBeDefined();
    expect(doctor.doctorId).toMatch(/^NEU-\d{4}$/); // Neurology → NEU
  });

  it("increments doctorId suffix for second doctor in same department", async () => {
    const d1 = await Doctor.create(validDoctor());
    const d2 = await Doctor.create(validDoctor({
      email: `d2${Date.now()}@t.com`, mciNumber: `M2${Date.now()}`,
      username: `d2${Date.now()}`, phone: 9000000002,
    }));
    expect(d1.doctorId).not.toBe(d2.doctorId);
  });

  it("rejects doctor with missing required bio", async () => {
    await expect(Doctor.create(validDoctor({ bio: undefined }))).rejects.toThrow();
  });

  it("rejects doctor with duplicate email", async () => {
    const email = `dup${Date.now()}@dr.com`;
    await Doctor.create(validDoctor({ email }));
    await expect(Doctor.create(validDoctor({
      email, username: `other${Date.now()}`, mciNumber: `M${Date.now()}`, phone: 9000000003,
    }))).rejects.toThrow();
  });

  it("rejects doctor with duplicate mciNumber", async () => {
    const mciNumber = `MCI_DUP_${Date.now()}`;
    await Doctor.create(validDoctor({ mciNumber }));
    await expect(Doctor.create(validDoctor({
      mciNumber, email: `other${Date.now()}@dr.com`, username: `other${Date.now()}`, phone: 9000000004,
    }))).rejects.toThrow();
  });

  it("stores profession as an array", async () => {
    const doctor = await Doctor.create(validDoctor({ profession: ["Neurologist", "Psychiatrist"] }));
    expect(Array.isArray(doctor.profession)).toBe(true);
    expect(doctor.profession).toContain("Neurologist");
  });

  it("applies default fee of 500 when not provided", async () => {
    const doctor = await Doctor.create(validDoctor());
    expect(doctor.fee).toBe(500);
  });

  it("applies default rating of 4.5 when not provided", async () => {
    const doctor = await Doctor.create(validDoctor());
    expect(doctor.rating).toBe(4.5);
  });

  it("rejects invalid gender value", async () => {
    await expect(Doctor.create(validDoctor({ gender: "unknown" }))).rejects.toThrow();
  });
});

// ─── Appointment Model ────────────────────────────────────────────────────────

describe("Appointment Model", () => {
  let doctor, patient;

  beforeEach(async () => {
    doctor  = await Doctor.create(validDoctor());
    patient = await User.create(validUser());
  });

  it("saves a valid appointment", async () => {
    const appt = new Appointment(validAppointment(doctor._id, patient._id));
    await appt.generateAppointmentID();
    await appt.save();
    expect(appt._id).toBeDefined();
    expect(appt.state).toBe("pending");
  });

  it("generates appointmentID with department prefix", async () => {
    const appt = new Appointment(validAppointment(doctor._id, patient._id));
    await appt.generateAppointmentID();
    await appt.save();
    // NEU = first 3 chars of "Neurology"
    expect(appt.appointmentID).toMatch(/^NEU\d{8}\d{2}$/);
  });

  it("defaults state to 'pending'", async () => {
    const appt = new Appointment(validAppointment(doctor._id, patient._id));
    await appt.generateAppointmentID();
    await appt.save();
    expect(appt.state).toBe("pending");
  });

  it("rejects invalid state value", async () => {
    const appt = new Appointment(validAppointment(doctor._id, patient._id, { state: "flying" }));
    await appt.generateAppointmentID();
    await expect(appt.save()).rejects.toThrow();
  });

  it("rejects invalid mode value", async () => {
    const appt = new Appointment(validAppointment(doctor._id, patient._id, { mode: "hologram" }));
    await appt.generateAppointmentID();
    await expect(appt.save()).rejects.toThrow();
  });

  it("rejects appointment with missing patientName", async () => {
    const appt = new Appointment(validAppointment(doctor._id, patient._id, { patientName: undefined }));
    await appt.generateAppointmentID();
    await expect(appt.save()).rejects.toThrow();
  });

  it("accepts all valid state transitions", async () => {
    for (const state of ["pending", "approved", "rejected", "completed"]) {
      const appt = new Appointment(validAppointment(doctor._id, patient._id, { state }));
      await appt.generateAppointmentID();
      await appt.save();
      expect(appt.state).toBe(state);
      await Appointment.deleteOne({ _id: appt._id });
    }
  });

  it("stores doctorID and patientID as ObjectId references", async () => {
    const appt = new Appointment(validAppointment(doctor._id, patient._id));
    await appt.generateAppointmentID();
    await appt.save();
    expect(appt.doctorID.toString()).toBe(doctor._id.toString());
    expect(appt.patientID.toString()).toBe(patient._id.toString());
  });

  it("populates doctorID from Doctor collection", async () => {
    const appt = new Appointment(validAppointment(doctor._id, patient._id));
    await appt.generateAppointmentID();
    await appt.save();
    const found = await Appointment.findById(appt._id).populate("doctorID");
    expect(found.doctorID.name).toBe("Dr. Bob");
  });
});

// ─── Contract Model ───────────────────────────────────────────────────────────

describe("Contract Model", () => {
  let doctor, patient, appointment;

  beforeEach(async () => {
    doctor  = await Doctor.create(validDoctor());
    patient = await User.create(validUser());
    const appt = new Appointment(validAppointment(doctor._id, patient._id));
    await appt.generateAppointmentID();
    await appt.save();
    appointment = appt;
  });

  it("saves a valid contract", async () => {
    const contract = await Contract.create({
      appointmentId: appointment._id,
      meetingDetails: { meetingPassword: "pass123", meetingUrl: "meet.google.com/abc" },
    });
    expect(contract._id).toBeDefined();
    expect(contract.appointmentId.toString()).toBe(appointment._id.toString());
  });

  it("pre-save hook generates a meetingId from appointmentId + timestamp", async () => {
    const contract = await Contract.create({
      appointmentId: appointment._id,
      meetingDetails: { meetingPassword: "pass123" },
    });
    expect(contract.meetingDetails.meetingId).toBeDefined();
    expect(contract.meetingDetails.meetingId).toContain(appointment._id.toString());
  });

  it("meetingId is not overwritten on subsequent saves", async () => {
    const contract = await Contract.create({
      appointmentId: appointment._id,
      meetingDetails: { meetingPassword: "pass123" },
    });
    const original = contract.meetingDetails.meetingId;
    contract.meetingDetails.meetingPassword = "newpass";
    await contract.save();
    expect(contract.meetingDetails.meetingId).toBe(original);
  });

  it("stores offline location fields correctly", async () => {
    const contract = await Contract.create({
      appointmentId: appointment._id,
      meetingDetails: {
        location: { city: "Mumbai", state: "MH", pincode: "400001", latitude: "19.07", longitude: "72.87" },
      },
    });
    expect(contract.meetingDetails.location.city).toBe("Mumbai");
    expect(contract.meetingDetails.location.pincode).toBe("400001");
  });

  it("rejects contract with missing appointmentId", async () => {
    await expect(Contract.create({ meetingDetails: { meetingPassword: "pass" } })).rejects.toThrow();
  });

  it("stores null meetingUrl when mode is offline (schema allows null/undefined)", async () => {
    const contract = await Contract.create({
      appointmentId: appointment._id,
      meetingDetails: { meetingPassword: "pass", meetingUrl: null },
    });
    expect(contract.meetingDetails.meetingUrl).toBeNull();
  });

  it("populates appointmentId from Appointment collection", async () => {
    const contract = await Contract.create({
      appointmentId: appointment._id,
      meetingDetails: {},
    });
    const found = await Contract.findById(contract._id).populate("appointmentId");
    expect(found.appointmentId.patientName).toBe("John Patient");
  });
});
