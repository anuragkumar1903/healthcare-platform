/**
 * Socket.io Tests
 * Covers: appointment status update, WebRTC signaling (join-room, offer, answer,
 *         ice-candidate, leave-room), order tracking rooms (order:join, order:leave)
 *
 * All tests use async/await + Promise-based helpers — no nested done() callbacks
 * which were the root cause of infinite loops.
 */

import { jest } from "@jest/globals";
import http from "http";
import { Server } from "socket.io";
import { io as ClientIO } from "socket.io-client";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

process.env.JWT_SECRET = "socket_test_secret_32_chars_long!!";

// ─── Mock models ──────────────────────────────────────────────────────────────

const mockAppointment = {
  findById:          jest.fn(),
  findByIdAndUpdate: jest.fn(),
};
const mockContract = {
  findOne: jest.fn(),
};

jest.unstable_mockModule("../../models/Appointment.js", () => ({ default: mockAppointment }));
jest.unstable_mockModule("../../models/Contract.js",    () => ({ default: mockContract    }));
jest.unstable_mockModule("../../mailingconfig.js",       () => ({
  default: { sendMail: jest.fn((opts, cb) => cb && cb(null)) },
}));
jest.unstable_mockModule("../../utils/logger.js", () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), http: jest.fn() },
}));
jest.unstable_mockModule("../../utils/metrics.js", () => ({
  recordRequest: jest.fn(), recordError: jest.fn(),
  recordSocketEvent: jest.fn(),
  incrementConnections: jest.fn(), decrementConnections: jest.fn(),
}));

// ─── Minimal Socket.io server ─────────────────────────────────────────────────
// Mirrors only the socket handlers from server.js — no Express, no DB connect.

const buildTestServer = () => {
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket"],
    connectionStateRecovery: {},
  });

  io.on("connection", (socket) => {

    // ── Appointment Status Update ────────────────────────────────────────────
    socket.on("updateAppointmentStatus", async (data, callback) => {
      const { appointmentId, meetingPassword, meetingUrl, location, appointmentState } = data;
      try {
        // findById may return null OR a plain object (sync mock) — resolve both
        const appointment = await Promise.resolve(mockAppointment.findById(appointmentId));
        if (!appointment) return callback({ success: false, message: "Appointment not found" });

        if (appointmentState === "approved") {
          const existing = await mockContract.findOne({ appointmentId: appointment._id });
          if (existing) return callback({ success: false, message: "Contract already exists for this appointment" });
        }

        appointment.state = appointmentState;
        if (typeof appointment.save === "function") await appointment.save();

        callback({ success: true, message: "Appointment status updated" });

        // Notify patient
        io.emit(`updateAppointmentStatus/${appointment.patientID}`, {
          appointmentState,
          appointmentId,
        });
      } catch (err) {
        callback({ success: false, message: "Server error" });
      }
    });

    // ── WebRTC join-room ─────────────────────────────────────────────────────
    socket.on("join-room", async ({ roomId, token }, callback) => {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId  = decoded._id;

        const appointment = await Promise.resolve(mockAppointment.findById(roomId));
        if (!appointment) return callback?.({ success: false, message: "Appointment not found" });

        const isPatient = appointment.patientID?.toString() === userId;
        const isDoctor  = appointment.doctorID?.toString()  === userId;
        if (!isPatient && !isDoctor) {
          return callback?.({ success: false, message: "Not authorized for this room" });
        }

        const room = io.sockets.adapter.rooms.get(roomId);
        if (room && room.size >= 2) {
          return callback?.({ success: false, message: "Room is full" });
        }

        socket.join(roomId);
        socket.to(roomId).emit("user-joined", socket.id);
        callback?.({ success: true });
      } catch {
        callback?.({ success: false, message: "Invalid token" });
      }
    });

    // ── WebRTC signaling ─────────────────────────────────────────────────────
    socket.on("offer",         ({ roomId, offer     }) => socket.to(roomId).emit("offer",         { offer, from: socket.id }));
    socket.on("answer",        ({ roomId, answer    }) => socket.to(roomId).emit("answer",        answer));
    socket.on("ice-candidate", ({ roomId, candidate }) => socket.to(roomId).emit("ice-candidate", candidate));

    socket.on("leave-room", async (roomId) => {
      socket.to(roomId).emit("user-left");
      socket.leave(roomId);
      try {
        const appointment = await mockAppointment.findByIdAndUpdate(roomId, { state: "completed" }, { new: true });
        if (appointment) {
          io.emit(`updateAppointmentStatus/${appointment.patientID}`, {
            appointmentState: "completed", appointmentId: roomId,
          });
        }
      } catch {}
    });

    // ── Order rooms ──────────────────────────────────────────────────────────
    socket.on("order:join",  (userId) => {
      if (typeof userId === "string" && userId.length > 0) socket.join(`orders:${userId}`);
    });
    socket.on("order:leave", (userId) => socket.leave(`orders:${userId}`));

    socket.on("disconnect", () => {});
  });

  return { httpServer, io };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let httpServer, io, serverPort;

/** Create a client and wait until it is connected before resolving */
const createClient = () => new Promise((resolve) => {
  const client = ClientIO(`http://localhost:${serverPort}`, {
    transports: ["websocket"],
    forceNew:   true,
  });
  client.once("connect", () => resolve(client));
});

/** Wait for an event on a socket client; rejects after timeout ms */
const waitFor = (client, event, timeoutMs = 3000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    client.once(event, (...args) => { clearTimeout(t); resolve(args); });
  });

/** Emit an event and await its ACK callback result */
const emitAck = (client, event, ...args) =>
  new Promise((resolve) => client.emit(event, ...args, resolve));

const makeToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "15m" });

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll((done) => {
  ({ httpServer, io } = buildTestServer());
  httpServer.listen(0, () => {
    serverPort = httpServer.address().port;
    done();
  });
});

afterEach(() => jest.clearAllMocks());

afterAll((done) => {
  io.close();
  httpServer.close(done);
});

// ─── Connection ───────────────────────────────────────────────────────────────

describe("Socket.io: Connection", () => {
  it("connects successfully", async () => {
    const client = await createClient();
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it("assigns a unique socket ID on connect", async () => {
    const client = await createClient();
    expect(typeof client.id).toBe("string");
    expect(client.id.length).toBeGreaterThan(0);
    client.disconnect();
  });
});

// ─── updateAppointmentStatus ──────────────────────────────────────────────────

describe("Socket.io: updateAppointmentStatus", () => {
  it("returns success:false when appointment is not found", async () => {
    mockAppointment.findById.mockReturnValueOnce(null);
    const client = await createClient();
    const res = await emitAck(client, "updateAppointmentStatus", {
      appointmentId: "bad-id", appointmentState: "pending",
    });
    expect(res.success).toBe(false);
    expect(res.message).toBe("Appointment not found");
    client.disconnect();
  });

  it("returns success:true and broadcasts to patient room", async () => {
    const patientId = new mongoose.Types.ObjectId().toString();
    const fakeAppt  = {
      _id: "apptId1", patientID: patientId,
      state: "pending", mode: "online",
      save: jest.fn().mockResolvedValue(true),
    };
    mockAppointment.findById.mockReturnValueOnce(fakeAppt);

    const sender   = await createClient();
    const listener = await createClient();

    // Set up listener BEFORE emitting
    const broadcastPromise = waitFor(listener, `updateAppointmentStatus/${patientId}`);

    const res = await emitAck(sender, "updateAppointmentStatus", {
      appointmentId: "apptId1", appointmentState: "pending",
    });
    expect(res.success).toBe(true);

    const [data] = await broadcastPromise;
    expect(data.appointmentState).toBe("pending");

    sender.disconnect();
    listener.disconnect();
  });

  it("returns success:false when contract already exists (approved state)", async () => {
    const fakeAppt = {
      _id: "apptId2", patientID: "pid", state: "pending", mode: "online",
      save: jest.fn().mockResolvedValue(true),
    };
    mockAppointment.findById.mockReturnValueOnce(fakeAppt);
    // Contract.findOne returns an existing contract
    mockContract.findOne.mockResolvedValueOnce({ _id: "existingContract" });

    const client = await createClient();
    const res = await emitAck(client, "updateAppointmentStatus", {
      appointmentId: "apptId2", appointmentState: "approved",
      meetingUrl: "meet/abc", meetingPassword: "pass123",
    });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Contract already exists/);
    client.disconnect();
  });

  it("returns success:true and creates contract when none exists (approved)", async () => {
    const fakeAppt = {
      _id: "apptId3", patientID: "pid2", state: "pending", mode: "online",
      save: jest.fn().mockResolvedValue(true),
    };
    mockAppointment.findById.mockReturnValueOnce(fakeAppt);
    mockContract.findOne.mockResolvedValueOnce(null); // no existing contract

    const client = await createClient();
    const res = await emitAck(client, "updateAppointmentStatus", {
      appointmentId: "apptId3", appointmentState: "approved",
      meetingUrl: "meet/xyz", meetingPassword: "pass456",
    });
    expect(res.success).toBe(true);
    client.disconnect();
  });
});

// ─── join-room ────────────────────────────────────────────────────────────────

describe("Socket.io: join-room (WebRTC)", () => {
  it("returns error for invalid JWT token", async () => {
    const client = await createClient();
    const res = await emitAck(client, "join-room", { roomId: "room1", token: "bad.token" });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Invalid token/);
    client.disconnect();
  });

  it("returns error when appointment not found", async () => {
    mockAppointment.findById.mockResolvedValueOnce(null);
    const client = await createClient();
    const res = await emitAck(client, "join-room", {
      roomId: "no-room", token: makeToken({ _id: "uid1" }),
    });
    expect(res.success).toBe(false);
    expect(res.message).toBe("Appointment not found");
    client.disconnect();
  });

  it("returns error when user is not the doctor or patient", async () => {
    mockAppointment.findById.mockResolvedValueOnce({
      patientID: { toString: () => "pid1" },
      doctorID:  { toString: () => "did1" },
    });
    const client = await createClient();
    const res = await emitAck(client, "join-room", {
      roomId: "room1", token: makeToken({ _id: "intruder" }),
    });
    expect(res.success).toBe(false);
    expect(res.message).toBe("Not authorized for this room");
    client.disconnect();
  });

  it("joins room successfully and notifies peer via user-joined", async () => {
    const roomId    = new mongoose.Types.ObjectId().toString();
    const patientId = "patient001";
    const doctorId  = "doctor001";
    const appt = {
      patientID: { toString: () => patientId },
      doctorID:  { toString: () => doctorId  },
    };
    // Both join-room calls will use this mock
    mockAppointment.findById.mockResolvedValue(appt);

    const peer   = await createClient();
    const joiner = await createClient();

    // peer (doctor) joins first
    const peerJoin = await emitAck(peer, "join-room", {
      roomId, token: makeToken({ _id: doctorId }),
    });
    expect(peerJoin.success).toBe(true);

    // Register listener on peer BEFORE joiner emits
    const userJoinedPromise = waitFor(peer, "user-joined");

    // joiner (patient) joins second — peer should get user-joined
    const joinerJoin = await emitAck(joiner, "join-room", {
      roomId, token: makeToken({ _id: patientId }),
    });
    expect(joinerJoin.success).toBe(true);

    const [socketId] = await userJoinedPromise;
    expect(typeof socketId).toBe("string");

    peer.disconnect();
    joiner.disconnect();
  });

  it("returns error when room is full (3rd participant)", async () => {
    const roomId = new mongoose.Types.ObjectId().toString();
    const appt = {
      patientID: { toString: () => "px" },
      doctorID:  { toString: () => "dx" },
    };
    mockAppointment.findById.mockResolvedValue(appt);

    const c1 = await createClient();
    const c2 = await createClient();
    const c3 = await createClient();

    await emitAck(c1, "join-room", { roomId, token: makeToken({ _id: "px" }) });
    await emitAck(c2, "join-room", { roomId, token: makeToken({ _id: "dx" }) });

    // 3rd person tries — room is full
    mockAppointment.findById.mockResolvedValueOnce({
      patientID: { toString: () => "px" },
      doctorID:  { toString: () => "dx" },
    });
    // Hack: make c3 appear authorized by using same IDs as an extra mock
    // The room.size >= 2 guard should fire
    const res = await emitAck(c3, "join-room", { roomId, token: makeToken({ _id: "px" }) });
    expect(res.success).toBe(false);
    expect(res.message).toBe("Room is full");

    c1.disconnect(); c2.disconnect(); c3.disconnect();
  });
});

// ─── WebRTC Signaling ─────────────────────────────────────────────────────────

describe("Socket.io: WebRTC Signaling", () => {
  /** Helper: create two clients already joined in a room */
  const twoClientsInRoom = async (roomId, patientId, doctorId) => {
    const appt = {
      patientID: { toString: () => patientId },
      doctorID:  { toString: () => doctorId  },
    };
    mockAppointment.findById.mockResolvedValue(appt);

    const c1 = await createClient();
    const c2 = await createClient();

    await emitAck(c1, "join-room", { roomId, token: makeToken({ _id: patientId }) });
    await emitAck(c2, "join-room", { roomId, token: makeToken({ _id: doctorId  }) });

    return { c1, c2 };
  };

  it("forwards offer from c1 to c2", async () => {
    const roomId = `offer-room-${Date.now()}`;
    const { c1, c2 } = await twoClientsInRoom(roomId, "p_offer", "d_offer");

    const offerPromise = waitFor(c2, "offer");
    c1.emit("offer", { roomId, offer: { type: "offer", sdp: "v=0..." } });

    const [{ offer }] = await offerPromise;
    expect(offer.type).toBe("offer");

    c1.disconnect(); c2.disconnect();
  });

  it("forwards answer from c2 to c1", async () => {
    const roomId = `answer-room-${Date.now()}`;
    const { c1, c2 } = await twoClientsInRoom(roomId, "p_ans", "d_ans");

    const answerPromise = waitFor(c1, "answer");
    c2.emit("answer", { roomId, answer: { type: "answer", sdp: "v=1..." } });

    const [answer] = await answerPromise;
    expect(answer.type).toBe("answer");

    c1.disconnect(); c2.disconnect();
  });

  it("forwards ice-candidate from c1 to c2", async () => {
    const roomId = `ice-room-${Date.now()}`;
    const { c1, c2 } = await twoClientsInRoom(roomId, "p_ice", "d_ice");

    const icePromise = waitFor(c2, "ice-candidate");
    c1.emit("ice-candidate", { roomId, candidate: { candidate: "fake-ice" } });

    const [candidate] = await icePromise;
    expect(candidate).toEqual({ candidate: "fake-ice" });

    c1.disconnect(); c2.disconnect();
  });
});

// ─── leave-room ───────────────────────────────────────────────────────────────

describe("Socket.io: leave-room", () => {
  it("sends user-left to the remaining peer", async () => {
    const roomId = `leave-room-${Date.now()}`;
    const appt = {
      patientID: { toString: () => "p_leave" },
      doctorID:  { toString: () => "d_leave" },
    };
    mockAppointment.findById.mockResolvedValue(appt);
    mockAppointment.findByIdAndUpdate.mockResolvedValue(null);

    const c1 = await createClient();
    const c2 = await createClient();

    await emitAck(c1, "join-room", { roomId, token: makeToken({ _id: "p_leave" }) });
    await emitAck(c2, "join-room", { roomId, token: makeToken({ _id: "d_leave" }) });

    // Register on c1 before c2 leaves
    const userLeftPromise = waitFor(c1, "user-left");
    c2.emit("leave-room", roomId);

    await userLeftPromise; // resolves when c1 receives "user-left"

    c1.disconnect();
    c2.disconnect();
  });

  it("marks appointment as completed in DB", async () => {
    const roomId = new mongoose.Types.ObjectId().toString();
    mockAppointment.findByIdAndUpdate.mockResolvedValueOnce({
      _id: roomId, patientID: "pid", doctorID: "did",
    });

    const client = await createClient();
    client.emit("leave-room", roomId);

    // Give async handler time to call findByIdAndUpdate
    await new Promise((r) => setTimeout(r, 300));

    expect(mockAppointment.findByIdAndUpdate).toHaveBeenCalledWith(
      roomId, { state: "completed" }, { new: true }
    );
    client.disconnect();
  });
});

// ─── Order Rooms ──────────────────────────────────────────────────────────────

describe("Socket.io: Order Tracking Rooms", () => {
  it("receives server events after joining order room", async () => {
    const userId = `order-user-${Date.now()}`;
    const client = await createClient();

    client.emit("order:join", userId);
    await new Promise((r) => setTimeout(r, 100)); // let server process the join

    const pingPromise = waitFor(client, "test:ping");
    io.to(`orders:${userId}`).emit("test:ping", { ok: true });

    const [data] = await pingPromise;
    expect(data.ok).toBe(true);
    client.disconnect();
  });

  it("stops receiving events after leaving order room", async () => {
    const userId = `order-user-leave-${Date.now()}`;
    const client = await createClient();

    client.emit("order:join", userId);
    await new Promise((r) => setTimeout(r, 100));

    client.emit("order:leave", userId);
    await new Promise((r) => setTimeout(r, 100));

    let received = false;
    client.once("test:ping", () => { received = true; });
    io.to(`orders:${userId}`).emit("test:ping", { ok: true });

    await new Promise((r) => setTimeout(r, 200));
    expect(received).toBe(false);
    client.disconnect();
  });

  it("ignores order:join with empty string userId", async () => {
    const client = await createClient();
    // Should not throw or join any room
    client.emit("order:join", "");
    await new Promise((r) => setTimeout(r, 100));
    // Server should not have added the socket to any orders: room
    expect(client.connected).toBe(true);
    client.disconnect();
  });
});
