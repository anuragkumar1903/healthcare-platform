import Appointment from "../models/Appointment.js";
import Contract from "../models/Contract.js";
import Doctor from "../models/Doctor.js";
import User from "../models/user.js";
import mongoose from "mongoose";

const findDoctorAndUser = async (doctorId, userId) => {
    const [doctor, user] = await Promise.all([
        Doctor.findById(doctorId),
        User.findById(userId)
    ]);
    return { doctor, user };
};

// Map appointment document to structured response object
const mapAppointment = (appointment) => ({
    appointmentID: appointment._id,
    customAppointmentID: appointment.appointmentID,
    patientID: appointment.patientID?._id ?? appointment.patientID,
    doctorID: appointment.doctorID?._id ?? appointment.doctorID,
    status: appointment.state,
    appointment: {
        title: appointment.title,
        description: appointment.desc,
        date: appointment.expectedDate,
        mode: appointment.mode,
    },
    patient: {
        name: appointment.patientName,
        email: appointment.patientEmail,
        phone: appointment.patientContact,
        gender: appointment.gender,
        age: appointment.age,
        address: appointment.patientAddress,
        disease: appointment.disease,
    },
    doctor: appointment.doctorID ? {
        name: appointment.doctorID.name,
        email: appointment.doctorID.email,
        phone: appointment.doctorID.phone,
        profession: appointment.doctorID.profession,
        department: appointment.doctorID.department,
        experience: appointment.doctorID.experience,
        bio: appointment.doctorID.bio,
        gender: appointment.doctorID.gender,
        username: appointment.doctorID.username,
    } : null,
});

// Create appointment
export const createAppointment = async (req, res) => {
    try {
        const { patientName, patientContact, gender, age, title, desc, expectedDate, patientAddress, disease, mode, doctorId, userId, email } = req.body;

        const { doctor, user } = await findDoctorAndUser(doctorId, userId);
        if (!doctor || !user) {
            return res.status(404).json({ message: "Doctor or User not found", success: false });
        }

        const newAppointment = new Appointment({
            patientName, patientContact, gender, age, title, desc,
            expectedDate, patientAddress, disease, mode,
            doctorID: doctor._id, patientID: user._id, patientEmail: email,
        });

        await newAppointment.generateAppointmentID();
        await newAppointment.save();

        res.status(201).json({ message: "Appointment created successfully", appointment: newAppointment, success: true });
    } catch (error) {
        console.error("❌ Server Error:", error.message);
        res.status(500).json({ message: "Server Error: " + error.message, success: false });
    }
};

// Get current/future appointments for a user
export const getUserAppointments = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ success: false, message: "User ID is required" });
        if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(404).json({ success: false, message: "No appointments found for this user" });
        if (req.user?._id && String(req.user._id) !== String(userId)) {
            return res.status(403).json({ success: false, message: "Forbidden. You can only access your own appointments." });
        }

        // Use UTC midnight — MongoDB stores dates in UTC
        const currentDate = new Date();
        currentDate.setUTCHours(0, 0, 0, 0);

        const appointments = await Appointment.find({ patientID: userId, expectedDate: { $gte: currentDate } })
            .populate({ path: "doctorID", select: "name email phone department experience bio profession gender username" })
            .select('-__v')
            .lean();

        if (!appointments.length) {
            return res.status(404).json({ success: false, message: "No appointments found for this user" });
        }

        res.status(200).json({ success: true, totalAppointments: appointments.length, appointments: appointments.map(mapAppointment) });
    } catch (error) {
        console.error("❌ Error fetching user appointments:", error.message);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};

// Get past appointments for a user
export const getAppointmentHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ success: false, message: "User ID is required" });

        // Fix: setUTCHours mutates and returns Number — must use the Date object
        const currentDate = new Date();
        currentDate.setUTCHours(0, 0, 0, 0);

        // Include completed appointments OR past-date appointments
        const appointments = await Appointment.find({
            patientID: userId,
            $or: [
                { state: "completed" },
                { state: "rejected" },
                { expectedDate: { $lt: currentDate } },
            ],
        })
            .populate({ path: "doctorID", select: "name email phone department experience bio profession gender username" })
            .select('-__v')
            .lean();

        res.status(200).json({ success: true, totalAppointments: appointments.length, appointments: appointments.map(mapAppointment) });
    } catch (error) {
        console.error("❌ Error fetching appointment history:", error.message);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};

// Get all appointments (admin)
export const getAllAppointments = async (req, res) => {
    try {
        const appointments = await Appointment.find()
            .populate({ path: "doctorID", select: "name email phone department experience bio profession gender username" })
            .populate({ path: "patientID", select: "name email phone gender" })
            .select('-__v')
            .lean();

        if (!appointments.length) {
            return res.status(404).json({ success: false, message: "No appointments found" });
        }

        // totalAppointments from array length — no extra countDocuments needed
        res.status(200).json({ success: true, totalAppointments: appointments.length, appointments: appointments.map(mapAppointment) });
    } catch (error) {
        console.error("❌ Error fetching all appointments:", error.message);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};

// Get doctor's pending + approved appointments
export const getDoctorAppointments = async (req, res) => {
    try {
        const { doctorId } = req.params;
        if (!doctorId) return res.status(400).json({ success: false, message: "Doctor ID is required" });

        // Push state filter into DB — two parallel queries instead of fetching all and filtering in JS
        const [pendingRaw, approvedRaw] = await Promise.all([
            Appointment.find({ doctorID: doctorId, state: "pending" })
                .populate({ path: "patientID", select: "name email phone gender" })
                .select('-__v').lean(),
            Appointment.find({ doctorID: doctorId, state: { $in: ["approved", "completed"] } })
                .populate({ path: "patientID", select: "name email phone gender" })
                .select('-__v').lean(),
        ]);

        const mapDoc = (appointment) => ({
            appointmentID: appointment._id,
            // Guard against deleted patient
            patientID: appointment.patientID?._id ?? null,
            status: appointment.state,
            appointment: {
                appointmentID: appointment.appointmentID,
                title: appointment.title,
                description: appointment.desc,
                date: appointment.expectedDate,
                mode: appointment.mode,
            },
            patient: appointment.patientID ? {
                name: appointment.patientName,
                email: appointment.patientEmail,
                phone: appointment.patientContact,
                gender: appointment.gender,
                age: appointment.age,
                address: appointment.patientAddress,
                disease: appointment.disease,
            } : null,
        });

        res.status(200).json({
            success: true,
            totalAppointments: pendingRaw.length + approvedRaw.length,
            pendingAppointments: pendingRaw.map(mapDoc),
            approvedAppointments: approvedRaw.map(mapDoc),
        });
    } catch (error) {
        console.error("❌ Error fetching doctor appointments:", error.message);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};

// Appointment stats (admin)
export const getAppointmentStats = async (req, res) => {
    try {
        const [total, pending, approved, rejected, completed] = await Promise.all([
            Appointment.countDocuments(),
            Appointment.countDocuments({ state: "pending" }),
            Appointment.countDocuments({ state: "approved" }),
            Appointment.countDocuments({ state: "rejected" }),
            Appointment.countDocuments({ state: "completed" }),
        ]);

        res.status(200).json({ success: true, totalAppointments: total, pendingAppointments: pending, approvedAppointments: approved, rejectedAppointments: rejected, completedAppointments: completed });
    } catch (error) {
        console.error("❌ Error fetching appointment stats:", error.message);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};

// Verify meeting password
export const appointmentpasswordverify = async (req, res) => {
    try {
        const { meetingPassword, appointmentID } = req.body;
        if (!meetingPassword || !appointmentID) {
            return res.status(400).json({ success: false, message: "Meeting password and appointment ID are required" });
        }

        const appointment = await Appointment.findOne({ appointmentID });
        if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found" });

        const contract = await Contract.findOne({
            appointmentId: appointment._id,
            "meetingDetails.meetingPassword": meetingPassword,
        });

        if (!contract) return res.status(404).json({ success: false, message: "Invalid meeting password" });

        return res.status(200).json({ success: true, message: "Password verified", meetingUrl: appointment._id });
    } catch (error) {
        console.error("❌ Error verifying meeting password:", error.message);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};


// Cancel appointment — user: only if pending; doctor: any time except completed
export const cancelAppointment = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body; // "user" or "doctor"

        const appointment = await Appointment.findById(id);
        if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found" });

        if (appointment.state === "completed") {
            return res.status(400).json({ success: false, message: "Cannot cancel a completed appointment" });
        }
        if (role === "user" && appointment.state !== "pending") {
            return res.status(403).json({ success: false, message: "You can only cancel pending appointments" });
        }

        await Appointment.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: "Appointment cancelled" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};

// Get offline appointment location for patient map view
export const getAppointmentLocation = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const appointment = await Appointment.findOne({ appointmentID: appointmentId });
        if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found" });

        const contract = await Contract.findOne({ appointmentId: appointment._id });
        if (!contract?.meetingDetails?.location) {
            return res.status(404).json({ success: false, message: "Location not set for this appointment" });
        }

        res.status(200).json({ success: true, location: contract.meetingDetails.location });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};
