import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "../routes/authRoutes.js";
import appointmentRoute from "../routes/appointmentRoutes.js";
import doctorRoute from "../routes/doctorRoutes.js";
import monitorRoute from "../routes/monitorRoutes.js";

const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.use("/auth", authRoutes);
app.use("/appointments", appointmentRoute);
app.use("/doctors", doctorRoute);
app.use("/monitor", monitorRoute);
app.get("/health", (req, res) => res.status(200).json({ status: "ok", uptime: process.uptime() }));
app.post("/send", (req, res) => res.status(200).send("ok"));

export default app;
