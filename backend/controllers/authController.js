import Doctor from "../models/Doctor.js";
import User from "../models/user.js";
import Admin from "../models/Admin.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mailerSystem from "../mailingconfig.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";

// ✅ User Registration
export const registerUser = async (req, res) => {
  const { name, email, phone, role, image, username, password, gender } = req.body;

  // Input validation
  if (!name || !email || !phone || !username || !password || !gender) {
    return res.status(400).json({ message: "All fields are required" });
  }
  if (name.trim().length < 2) {
    return res.status(400).json({ message: "Name must be at least 2 characters" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }
  if (!/^[0-9]{10}$/.test(phone)) {
    return res.status(400).json({ message: "Phone must be 10 digits" });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }
  if (!['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ message: "Invalid gender value" });
  }

  try {
    const userExists = await User.findOne({ $or: [{ email }, { phone }, { username }] });
    if (userExists) return res.status(400).json({ message: "User already exists" });

    const imageUrl = await uploadToCloudinary(image, "medimentor/users");

    const user = new User({ role, name, email, phone, username, image: imageUrl, password, gender });

    try {
      await user.save();
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({ message: "User already exists", duplicateField: Object.keys(err.keyValue)[0] });
      }
      throw err;
    }

    return res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("❌ Error in registerUser:", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ✅ Doctor Registration
export const registerDoctor = async (req, res) => {
  const { role, name, email, phone, username, bio, gender, mciNumber, department, experience, password, certificate, profession, image } = req.body;

  // Input validation
  if (!name || !email || !phone || !username || !bio || !gender || !mciNumber || !department || !experience || !password || !profession) {
    return res.status(400).json({ message: "All fields are required" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  try {
    const doctorExists = await Doctor.findOne({ $or: [{ email }, { phone }, { username }, { mciNumber }] });
    if (doctorExists) return res.status(400).json({ message: "Doctor already exists" });

    const imageUrl = image ? await uploadToCloudinary(image, "medimentor/doctors") : null;
    const certificateData = certificate ? await uploadToCloudinary(certificate, "medimentor/certificates") : null;

    const doctor = new Doctor({ role, name, email, phone, username, certificate: certificateData, image: imageUrl, bio, gender, mciNumber, department, experience, profession, password });

    await doctor.save();
    return res.status(201).json({ message: "Doctor registered successfully", doctor: { _id: doctor._id, name: doctor.name, email: doctor.email } });
  } catch (error) {
    console.error("❌ Error in registerDoctor:", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ✅ Create JWT Token
// ✅ Token helpers
const createAccessToken = (userId, role) =>
  jwt.sign({ _id: userId, role, jti: Math.random().toString(36).slice(2) }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "15m" });

const createRefreshToken = (userId, role) =>
  jwt.sign({ _id: userId, role }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "_refresh", { algorithm: "HS256", expiresIn: "7d" });

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ✅ Login
export const loginAuth = async (req, res) => {
  const { email, username, password, role } = req.body;

  if ((!email && !username) || !password || !role) {
    return res.status(400).json({ message: "Please fill all the fields" });
  }
  if (!['user', 'doctor', 'admin'].includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  try {
    let user;
    if (role === "user") {
      user = await User.findOne({ $or: [{ email }, { username }] }, { password: 1, name: 1, email: 1, role: 1, image: 1 });
    } else if (role === "doctor") {
      user = await Doctor.findOne({ $or: [{ email }, { username }] }, { password: 1, name: 1, email: 1, role: 1, image: 1 });
    } else if (role === "admin") {
      user = await Admin.findOne({ $or: [{ email }, { username }] }, { password: 1, name: 1, username: 1, role: 1, email: 1 });
    }

    if (!user) return res.status(401).json({ message: "Invalid Credentials" });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ message: "Invalid Credentials" });

    const accessToken = createAccessToken(user._id, user.role);
    const refreshToken = createRefreshToken(user._id, user.role);

    // Set refresh token in httpOnly cookie
    res.cookie("refreshToken", refreshToken, COOKIE_OPTS);

    const responseData = { _id: user._id, name: user.name, role: user.role, image: user.image };
    if (role === "admin") {
      responseData.username = user.username;
    } else {
      responseData.email = user.email;
    }

    return res.status(200).json({ message: "Login Success", accessToken, success: true, user: responseData });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// ✅ Refresh — issues new accessToken using httpOnly cookie
export const refreshToken = (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ message: "No refresh token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "_refresh");
    const accessToken = createAccessToken(decoded._id, decoded.role);
    return res.status(200).json({ accessToken });
  } catch {
    res.clearCookie("refreshToken", COOKIE_OPTS);
    return res.status(401).json({ message: "Refresh token expired. Please login again." });
  }
};

// ✅ Logout — clears the refresh token cookie
export const logoutAuth = (req, res) => {
  res.clearCookie("refreshToken", COOKIE_OPTS);
  return res.status(200).json({ success: true, message: "Logged out" });
};


// ✅ Token Expiry Check — checks User, Doctor, and Admin
export const checkTokenExpiry = async (req, res) => {
  const token = req.body?.token;
  if (!token) {
    return res.status(200).json({ success: false, message: "No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user =
      (await User.findById(decoded._id).select('-password -otp -otpExpires')) ||
      (await Doctor.findById(decoded._id).select('-password -otp -otpExpires')) ||
      (await Admin.findById(decoded._id).select('-password'));

    if (!user) {
      return res.status(200).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, message: "Token is valid", user });
  } catch (error) {
    console.error("❌ Token verification failed:", error.message);
    return res.status(200).json({ success: false, message: "Invalid Token" });
  }
};

// ✅ Send OTP
export const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = (await User.findOne({ email })) || (await Doctor.findOne({ email }));
    if (!user) return res.status(400).json({ message: "User not found" });

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    await mailerSystem.sendMail({
      to: email,
      subject: "OTP for password reset",
      text: `Your OTP is ${otp}. Valid for 5 minutes.`,
    });

    res.status(200).json({ success: true, message: "OTP sent to email" });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// ✅ Verify OTP
export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });

    const user = (await User.findOne({ email })) || (await Doctor.findOne({ email }));
    if (!user) return res.status(400).json({ message: "Email not found" });

    if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });
    if (!user.otpExpires || user.otpExpires < Date.now()) return res.status(400).json({ message: "OTP expired" });

    user.otp = null;
    user.otpExpires = null;
    await user.save();

    const resetToken = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: "5m" });

    res.status(200).json({ success: true, message: "OTP verified.", resetToken });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// ✅ Update Password
export const updatePassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) return res.status(400).json({ message: "Reset token and new password are required" });
    if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

    const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);

    const user = (await User.findOne({ email: decoded.email })) || (await Doctor.findOne({ email: decoded.email }));
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = newPassword; // pre-save hook will hash it
    await user.save();

    res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Reset token expired. Please generate a new OTP." });
    }
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};


// ✅ List all users (admin only)
export const listUsers = async (req, res) => {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  try {
    const users = await User.find().select('-password -otp -otpExpires').lean();
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};

// ✅ Update profile — name, image, password
export const updateProfile = async (req, res) => {
  try {
    const { name, image, currentPassword, newPassword } = req.body;
    const userId = req.user._id;
    const role = req.user.role;

    const Model = role === "doctor" ? Doctor : role === "user" ? User : null;
    if (!Model) return res.status(400).json({ message: "Invalid role" });

    const user = await Model.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name.trim();

    if (image) {
      const folder = role === "doctor" ? "medimentor/doctors" : "medimentor/users";
      user.image = await uploadToCloudinary(image, folder);
    }

    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ message: "Current password required" });
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return res.status(401).json({ message: "Current password is incorrect" });
      if (newPassword.length < 6) return res.status(400).json({ message: "New password must be at least 6 characters" });
      user.password = newPassword; // pre-save hook hashes it
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: { _id: user._id, name: user.name, image: user.image, role: user.role },
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};
