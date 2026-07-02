import Doctor from "../models/Doctor.js";
import User from "../models/user.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Hoist model — no need to re-instantiate per request
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const decodeBase64 = (base64String) => base64String || null;

const isSymptom = (query) => {
  const lower = query.toLowerCase();
  return /\b(i have|pain|ache|fever|cold|dizzy|nausea|vomit|symptom|cough|suffering|infection|headache|fatigue|swelling|rash|bleeding|breathing|chest|stomach|back|joint|skin|eye|ear|throat|heart|kidney|liver|diabetes|cancer|allergy)\b/.test(lower);
};

// Strip markdown code fences Gemini sometimes wraps around JSON
const extractJSON = (raw = "") => {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
  return match ? match[1].trim() : raw.trim();
};

import { Redis } from "@upstash/redis";

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const CACHE_KEY = "doctor:meta";
const CACHE_TTL = 6 * 60 * 60;

let _cache = { data: null, expiresAt: 0 };

const getProfessionsAndDepartments = async () => {
  if (redis) {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return cached;
  } else if (_cache.data && Date.now() < _cache.expiresAt) {
    return _cache.data;
  }

  const [profAgg, deptAgg] = await Promise.all([
    Doctor.aggregate([{ $unwind: "$profession" }, { $group: { _id: null, professions: { $addToSet: "$profession" } } }]),
    Doctor.aggregate([{ $group: { _id: null, departments: { $addToSet: "$department" } } }]),
  ]);

  const data = {
    professions: profAgg[0]?.professions || [],
    departments: deptAgg[0]?.departments || [],
  };

  if (redis) {
    await redis.set(CACHE_KEY, data, { ex: CACHE_TTL });
  } else {
    _cache = { data, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  }
  return data;
};

// Search Doctors
export const searchdoctor = async (req, res) => {
  const { query = "", page = 1, limit = 10, isDoctor } = req.query;
  const safeQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let searchQuery = {};

  try {
    let professions = [];
    let departments = [];

    if (isDoctor !== "true" && safeQuery && isSymptom(safeQuery)) {
      ({ professions, departments } = await getProfessionsAndDepartments());

      try {
        const prompt = `A patient reports: "${query}"\nChoose from:\n  professions: ${JSON.stringify(professions)}\n  departments: ${JSON.stringify(departments)}\nReturn ONLY valid JSON, no markdown: { "professions": [...], "departments": [...] }`;

        const aiResp = await geminiModel.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const raw = aiResp.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        try {
          const parsed = JSON.parse(extractJSON(raw));
          professions = Array.isArray(parsed.professions) ? parsed.professions : [];
          departments = Array.isArray(parsed.departments) ? parsed.departments : [];
        } catch {
          console.error("AI JSON parse error:", raw);
        }
      } catch (aiErr) {
        console.error("AI fetch error:", aiErr.message);
      }

      const orQuery = [];
      if (professions.length) orQuery.push({ profession: { $in: professions } });
      if (departments.length) orQuery.push({ department: { $in: departments } });

      if (orQuery.length) {
        searchQuery = { $or: orQuery };
      } else {
        searchQuery = { $or: [{ profession: { $regex: safeQuery, $options: "i" } }, { department: { $regex: safeQuery, $options: "i" } }] };
      }
    }

    if (!Object.keys(searchQuery).length) {
      const regex = new RegExp(safeQuery, "i");
      searchQuery = { $or: [{ name: regex }, { profession: regex }, { department: regex }] };
    }

    const doctors = await Doctor.find(searchQuery)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .select("image name department profession doctorId");

    res.status(200).json({
      success: true,
      totalResults: doctors.length,
      professions,
      departments,
      page: Number(page),
      doctors: doctors.map((doc) => ({ ...doc.toObject(), image: decodeBase64(doc.image) })),
    });
  } catch (err) {
    console.error("searchdoctor error:", err.message);
    res.status(500).json({ success: false, message: "Server Error: " + err.message });
  }
};

// Get all doctors (paginated)
export const getDoctors = async (req, res) => {
  try {
    const { limit = 10, lastId } = req.query;
    const filter = lastId ? { _id: { $gt: lastId } } : {};

    const [doctors, totalDoctors] = await Promise.all([
      Doctor.find(filter).sort({ _id: 1 }).limit(parseInt(limit)).select("image name rating fee bio profession doctorId"),
      Doctor.countDocuments(),
    ]);

    const result = doctors.map((doc) => ({ ...doc.toObject(), image: decodeBase64(doc.image) }));

    res.status(200).json({
      success: true,
      totalDoctors,
      doctors: result,
      lastId: result.length ? result[result.length - 1]._id : null,
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};

export const getTotalDoctors = async (req, res) => {
  try {
    const totalDoctors = await Doctor.countDocuments();
    res.status(200).json({ success: true, totalDoctors });
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};

export const getTotalUsers = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    res.status(200).json({ success: true, totalUsers });
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};

// Cached combined stats — used on landing page (public, no auth needed)
let _statsCache = { data: null, expiresAt: 0 };
export const clearStatsCache = () => { _statsCache = { data: null, expiresAt: 0 }; };
export const getStats = async (req, res) => {
  try {
    if (_statsCache.data && Date.now() < _statsCache.expiresAt) {
      return res.status(200).json(_statsCache.data);
    }
    const [totalDoctors, totalUsers] = await Promise.all([
      Doctor.countDocuments(),
      User.countDocuments(),
    ]);
    _statsCache = { data: { success: true, totalDoctors, totalUsers }, expiresAt: Date.now() + 5 * 60 * 1000 };
    res.status(200).json(_statsCache.data);
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};
