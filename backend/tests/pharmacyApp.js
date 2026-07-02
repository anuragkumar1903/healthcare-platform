// Minimal Express app for pharmacy integration tests.
import express from "express";
import cookieParser from "cookie-parser";
import createPharmacyRouter from "../pharmacy/routes/index.js";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", createPharmacyRouter());

export default app;
