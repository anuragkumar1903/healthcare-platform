/**
 * Unit Tests — authController
 * Tests: registerUser, registerDoctor, loginAuth, refreshToken, logoutAuth,
 *        checkTokenExpiry, sendOtp, verifyOtp, updatePassword, listUsers, updateProfile
 *
 * All external deps (DB models, mailer, cloudinary, jwt) are mocked.
 */

import { jest } from "@jest/globals";

// ─── Mock dependencies before importing the controller ────────────────────────

jest.unstable_mockModule("../../models/user.js", () => ({
  default: Object.assign(
    // Constructable: new User(data) returns an object with a save() mock
    jest.fn().mockImplementation(function (data) {
      return { ...data, save: jest.fn().mockResolvedValue(true) };
    }),
    // Static query methods
    {
      findOne:  jest.fn(),
      findById: jest.fn(),
      find:     jest.fn(),
    }
  ),
}));

jest.unstable_mockModule("../../models/Doctor.js", () => ({
  default: {
    findOne:  jest.fn(),
    findById: jest.fn(),
  },
}));

jest.unstable_mockModule("../../models/Admin.js", () => ({
  default: {
    findOne:  jest.fn(),
    findById: jest.fn(),
  },
}));

jest.unstable_mockModule("../../mailingconfig.js", () => ({
  default: { sendMail: jest.fn() },
}));

jest.unstable_mockModule("../../utils/cloudinary.js", () => ({
  uploadToCloudinary: jest.fn().mockResolvedValue("https://cloudinary.com/test.jpg"),
}));

// ─── Dynamic imports after mock setup ────────────────────────────────────────
const { default: User }   = await import("../../models/user.js");
const { default: Doctor } = await import("../../models/Doctor.js");
const { default: Admin }  = await import("../../models/Admin.js");
const { default: mailer } = await import("../../mailingconfig.js");
const { uploadToCloudinary } = await import("../../utils/cloudinary.js");

const {
  registerUser, registerDoctor, loginAuth, refreshToken, logoutAuth,
  checkTokenExpiry, sendOtp, verifyOtp, updatePassword, listUsers, updateProfile,
} = await import("../../controllers/authController.js");

import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

process.env.JWT_SECRET         = "test_secret_key_minimum_32_chars_long!!";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret_key_minimum_32!!";
process.env.NODE_ENV           = "test";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a minimal mock response object */
const mockRes = () => {
  const res = {};
  res.status  = jest.fn().mockReturnValue(res);
  res.json    = jest.fn().mockReturnValue(res);
  res.send    = jest.fn().mockReturnValue(res);
  res.cookie  = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
};

/** Returns a req-like object */
const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  cookies: {},
  user: null,
  ...overrides,
});

const makeSaveUser = (data = {}) => {
  const user = { save: jest.fn().mockResolvedValue(true), ...data };
  return user;
};

// ─── registerUser ─────────────────────────────────────────────────────────────
describe("registerUser", () => {
  beforeEach(() => jest.clearAllMocks());

  const validBody = {
    name: "Alice Smith", email: "alice@test.com", phone: "9876543210",
    username: "alice99", password: "secret123", gender: "female", role: "user",
  };

  it("returns 400 when required fields are missing", async () => {
    const req = mockReq({ body: { name: "Alice" } });
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "All fields are required" }));
  });

  it("returns 400 for name shorter than 2 chars", async () => {
    const req = mockReq({ body: { ...validBody, name: "A" } });
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Name must be at least 2 characters" }));
  });

  it("returns 400 for invalid email format", async () => {
    const req = mockReq({ body: { ...validBody, email: "not-an-email" } });
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for non-10-digit phone", async () => {
    const req = mockReq({ body: { ...validBody, phone: "12345" } });
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Phone must be 10 digits" }));
  });

  it("returns 400 for password shorter than 6 chars", async () => {
    const req = mockReq({ body: { ...validBody, password: "abc" } });
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for invalid gender value", async () => {
    const req = mockReq({ body: { ...validBody, gender: "alien" } });
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when user already exists", async () => {
    User.findOne.mockResolvedValueOnce({ _id: "existingId" });
    const req = mockReq({ body: validBody });
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "User already exists" }));
  });

  it("creates user and returns 201 on success", async () => {
    // No duplicate found, cloudinary returns a URL
    User.findOne.mockResolvedValueOnce(null);
    uploadToCloudinary.mockResolvedValueOnce("https://cdn.test/user.jpg");

    const req = mockReq({ body: { ...validBody, image: "data:image/png;base64,abc" } });
    const res = mockRes();
    await registerUser(req, res);

    // User constructor was called to create the new document
    expect(User).toHaveBeenCalled();
    // Duplicate check was performed
    expect(User.findOne).toHaveBeenCalled();
    // 201 returned
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "User registered successfully" })
    );
  });

  it("returns 500 on unexpected DB error", async () => {
    User.findOne.mockRejectedValueOnce(new Error("DB crash"));
    const req = mockReq({ body: validBody });
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── loginAuth ─────────────────────────────────────────────────────────────
describe("loginAuth", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when password is missing", async () => {
    const req = mockReq({ body: { email: "doc@test.com", role: "user" } });
    const res = mockRes();
    await loginAuth(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for invalid role", async () => {
    const req = mockReq({ body: { email: "x@x.com", password: "pass", role: "superadmin" } });
    const res = mockRes();
    await loginAuth(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid role" }));
  });

  it("returns 401 when user not found", async () => {
    User.findOne.mockResolvedValueOnce(null);
    const req = mockReq({ body: { email: "ghost@test.com", password: "pass", role: "user" } });
    const res = mockRes();
    await loginAuth(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when password is wrong", async () => {
    const hashed = await bcrypt.hash("correctpass", 10);
    User.findOne.mockResolvedValueOnce({ _id: "uid", name: "Bob", email: "bob@t.com", role: "user", password: hashed });
    const req = mockReq({ body: { email: "bob@t.com", password: "wrongpass", role: "user" } });
    const res = mockRes();
    await loginAuth(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid Credentials" }));
  });

  it("returns 200 and accessToken on valid user login", async () => {
    const hashed = await bcrypt.hash("validpass", 10);
    User.findOne.mockResolvedValueOnce({ _id: "uid123", name: "Bob", email: "bob@t.com", role: "user", image: null, password: hashed });
    const req = mockReq({ body: { email: "bob@t.com", password: "validpass", role: "user" } });
    const res = mockRes();
    await loginAuth(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty("accessToken");
    expect(body.success).toBe(true);
    expect(res.cookie).toHaveBeenCalledWith("refreshToken", expect.any(String), expect.any(Object));
  });

  it("returns 200 on valid doctor login", async () => {
    const hashed = await bcrypt.hash("docpass", 10);
    Doctor.findOne.mockResolvedValueOnce({ _id: "did1", name: "Dr. A", email: "dr@t.com", role: "doctor", image: null, password: hashed });
    const req = mockReq({ body: { email: "dr@t.com", password: "docpass", role: "doctor" } });
    const res = mockRes();
    await loginAuth(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.user.role).toBe("doctor");
  });

  it("returns 200 on valid admin login", async () => {
    const hashed = await bcrypt.hash("adminpass", 10);
    Admin.findOne.mockResolvedValueOnce({ _id: "aid1", name: "Admin", username: "admin", role: "admin", email: "admin@t.com", password: hashed });
    const req = mockReq({ body: { username: "admin", password: "adminpass", role: "admin" } });
    const res = mockRes();
    await loginAuth(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.user).toHaveProperty("username");
    expect(body.user).not.toHaveProperty("email");
  });
});

// ─── refreshToken ─────────────────────────────────────────────────────────────
describe("refreshToken", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no cookie present", async () => {
    const req = mockReq({ cookies: {} });
    const res = mockRes();
    await refreshToken(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 for an expired/invalid refresh token", async () => {
    const req = mockReq({ cookies: { refreshToken: "invalid.token.here" } });
    const res = mockRes();
    await refreshToken(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.clearCookie).toHaveBeenCalledWith("refreshToken", expect.any(Object));
  });

  it("issues new accessToken for a valid refresh token", async () => {
    const validRefresh = jwt.sign(
      { _id: "uid123", role: "user" },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );
    const req = mockReq({ cookies: { refreshToken: validRefresh } });
    const res = mockRes();
    await refreshToken(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty("accessToken");
    const decoded = jwt.verify(body.accessToken, process.env.JWT_SECRET);
    expect(decoded._id).toBe("uid123");
  });
});

// ─── logoutAuth ────────────────────────────────────────────────────────────
describe("logoutAuth", () => {
  it("clears cookie and returns success", async () => {
    const req = mockReq();
    const res = mockRes();
    await logoutAuth(req, res);
    expect(res.clearCookie).toHaveBeenCalledWith("refreshToken", expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// ─── checkTokenExpiry ──────────────────────────────────────────────────────
describe("checkTokenExpiry", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns success: false when no token provided", async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await checkTokenExpiry(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("returns success: false for invalid token", async () => {
    const req = mockReq({ body: { token: "bad.token.here" } });
    const res = mockRes();
    await checkTokenExpiry(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: "Invalid Token" }));
  });

  it("returns success: true for valid token with existing user", async () => {
    const token = jwt.sign({ _id: "uid999", role: "user" }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const fakeUser = { _id: "uid999", name: "Carol", email: "carol@t.com", role: "user" };
    // Controller calls User.findById(id).select('-password -otp -otpExpires')
    User.findById.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(fakeUser) });
    const req = mockReq({ body: { token } });
    const res = mockRes();
    await checkTokenExpiry(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it("returns success: false when decoded user does not exist in DB", async () => {
    const token = jwt.sign({ _id: "ghost123", role: "user" }, process.env.JWT_SECRET, { expiresIn: "15m" });
    // All three models return null — user doesn't exist anywhere
    User.findById.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(null) });
    Doctor.findById.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(null) });
    Admin.findById.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(null) });
    const req = mockReq({ body: { token } });
    const res = mockRes();
    await checkTokenExpiry(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ─── sendOtp ────────────────────────────────────────────────────────────────
describe("sendOtp", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when email is missing", async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await sendOtp(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when neither User nor Doctor has the email", async () => {
    User.findOne.mockResolvedValueOnce(null);
    Doctor.findOne.mockResolvedValueOnce(null);
    const req = mockReq({ body: { email: "nobody@test.com" } });
    const res = mockRes();
    await sendOtp(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("sends OTP email and returns 200 on success", async () => {
    const userSave = jest.fn().mockResolvedValue(true);
    User.findOne.mockResolvedValueOnce({ email: "alice@test.com", save: userSave });
    mailer.sendMail.mockResolvedValueOnce({});
    const req = mockReq({ body: { email: "alice@test.com" } });
    const res = mockRes();
    await sendOtp(req, res);
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "alice@test.com", subject: expect.stringContaining("OTP") }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it("generates a 4-digit numeric OTP", async () => {
    let capturedOtp;
    const userSave = jest.fn().mockImplementation(function() { capturedOtp = this.otp; return Promise.resolve(); });
    const fakeUser = { email: "test@x.com", save: userSave };
    fakeUser.save = jest.fn().mockImplementation(async () => { capturedOtp = fakeUser.otp; });
    User.findOne.mockResolvedValueOnce(fakeUser);
    mailer.sendMail.mockResolvedValueOnce({});
    const req = mockReq({ body: { email: "test@x.com" } });
    const res = mockRes();
    await sendOtp(req, res);
    // OTP is set on the fakeUser object
    const otpValue = fakeUser.otp;
    expect(otpValue).toMatch(/^\d{4}$/);
  });
});

// ─── verifyOtp ───────────────────────────────────────────────────────────────
describe("verifyOtp", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when email or OTP is missing", async () => {
    const req = mockReq({ body: { email: "alice@test.com" } });
    const res = mockRes();
    await verifyOtp(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for wrong OTP", async () => {
    User.findOne.mockResolvedValueOnce({ email: "a@b.com", otp: "1234", otpExpires: new Date(Date.now() + 60000) });
    const req = mockReq({ body: { email: "a@b.com", otp: "9999" } });
    const res = mockRes();
    await verifyOtp(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid OTP" }));
  });

  it("returns 400 for expired OTP", async () => {
    User.findOne.mockResolvedValueOnce({ email: "a@b.com", otp: "1234", otpExpires: new Date(Date.now() - 1000) });
    const req = mockReq({ body: { email: "a@b.com", otp: "1234" } });
    const res = mockRes();
    await verifyOtp(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "OTP expired" }));
  });

  it("returns 200 and resetToken for correct, non-expired OTP", async () => {
    const fakeUser = {
      email: "alice@test.com",
      otp: "5678",
      otpExpires: new Date(Date.now() + 300000),
      save: jest.fn().mockResolvedValue(true),
    };
    User.findOne.mockResolvedValueOnce(fakeUser);
    const req = mockReq({ body: { email: "alice@test.com", otp: "5678" } });
    const res = mockRes();
    await verifyOtp(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body).toHaveProperty("resetToken");
    // OTP should be cleared
    expect(fakeUser.otp).toBeNull();
    expect(fakeUser.otpExpires).toBeNull();
  });
});

// ─── updatePassword ───────────────────────────────────────────────────────────
describe("updatePassword", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when resetToken or newPassword is missing", async () => {
    const req = mockReq({ body: { newPassword: "newpass1" } });
    const res = mockRes();
    await updatePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when newPassword is too short", async () => {
    const token = jwt.sign({ email: "a@b.com" }, process.env.JWT_SECRET, { expiresIn: "5m" });
    const req = mockReq({ body: { resetToken: token, newPassword: "ab" } });
    const res = mockRes();
    await updatePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 401 for expired reset token", async () => {
    const expiredToken = jwt.sign({ email: "a@b.com" }, process.env.JWT_SECRET, { expiresIn: "-1s" });
    const req = mockReq({ body: { resetToken: expiredToken, newPassword: "newpass123" } });
    const res = mockRes();
    await updatePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("expired") }));
  });

  it("returns 200 and updates password for valid token", async () => {
    const token = jwt.sign({ email: "alice@test.com" }, process.env.JWT_SECRET, { expiresIn: "5m" });
    const fakeUser = { email: "alice@test.com", password: "oldhash", save: jest.fn().mockResolvedValue(true) };
    User.findOne.mockResolvedValueOnce(fakeUser);
    const req = mockReq({ body: { resetToken: token, newPassword: "brandnewpass" } });
    const res = mockRes();
    await updatePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(fakeUser.password).toBe("brandnewpass"); // pre-save hook hashes; we check assignment
    expect(fakeUser.save).toHaveBeenCalled();
  });
});

// ─── listUsers ────────────────────────────────────────────────────────────────
describe("listUsers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 403 for non-admin role", async () => {
    const req = mockReq({ user: { role: "user" } });
    const res = mockRes();
    await listUsers(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 200 with users list for admin", async () => {
    const fakeUsers = [{ _id: "u1", name: "Alice" }, { _id: "u2", name: "Bob" }];
    User.find.mockReturnValueOnce({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValueOnce(fakeUsers) });
    const req = mockReq({ user: { role: "admin" } });
    const res = mockRes();
    await listUsers(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.users).toHaveLength(2);
  });
});
