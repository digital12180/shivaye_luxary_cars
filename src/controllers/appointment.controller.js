import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Customer from "../models/Customer.js";
import Vehicle from "../models/Vehicle.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/leadActivity.js";
import { ok, fail } from "../utils/response.js";
import { sendNotification } from "../services/notification.service.js";

/* ============================================================
   PUBLIC — Create appointment (finds/creates a Lead)
   POST /api/v1/appointments/public
   ============================================================ */
export const publicCreateAppointment = async (req, res, next) => {
    try {
        const {
            name, phone, email, location,
            vehicle: vehicleId,
            type,
            scheduledAt,
            notes,
            source,
            attribution,
        } = req.body;

        if (!name || !phone) return fail(res, "Name and phone are required", 400);
        if (!type || !["showroom_visit", "test_drive"].includes(type))
            return fail(res, "type must be showroom_visit or test_drive", 400);
        if (!scheduledAt) return fail(res, "scheduledAt is required", 400);

        const when = new Date(scheduledAt);
        if (isNaN(when.getTime())) return fail(res, "Invalid scheduledAt", 400);
        if (when < new Date()) return fail(res, "scheduledAt must be in the future", 400);

        /* 1. Resolve vehicle (optional) */
        let vehicle = null;
        if (vehicleId && mongoose.isValidObjectId(vehicleId)) {
            vehicle = await Vehicle.findById(vehicleId);
        }

        /* 2. Find or create Lead by phone */
        let lead = await Lead.findOne({ phone });
        if (!lead) {
            lead = await Lead.create({
                name,
                phone,
                email,
                city: location,
                source: source || "direct_website",
                attribution: attribution || {},
                ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
                status: "new",
                ...(vehicle ? { vehicle: vehicle._id } : {}),
            });
        }

        /* 3. Conflict check — same lead, same 30-min slot */
        const slotStart = new Date(when.getTime() - 15 * 60 * 1000);
        const slotEnd = new Date(when.getTime() + 45 * 60 * 1000);
        const clash = await Appointment.findOne({
            lead: lead._id,
            scheduledAt: { $gte: slotStart, $lte: slotEnd },
            status: { $in: ["Requested", "Confirmed"] },
        });
        if (clash)
            return fail(res, "You already have an appointment around this time", 409);

        /* 4. Create appointment */
        const appointment = await Appointment.create({
            lead: lead._id,
            customerName: lead.name || name,
            customerPhone: lead.phone || phone,
            vehicle: vehicle?._id || null,
            vehicleName: vehicle ? `${vehicle.brand} ${vehicle.model}` : null,
            type,
            scheduledAt: when,
            notes,
            source: source || lead.source || "direct_website",
            attribution: attribution || {},
            location: location || lead.city,
            status: "Requested",
        });

        /* 5. Log activity on the lead */
        await LeadActivity.create({
            lead: lead._id,
            type: type === "test_drive" ? "test_drive" : "showroom_visit",
            title:
                type === "test_drive"
                    ? "Test drive requested"
                    : "Showroom visit scheduled",
            description: `Scheduled for ${when.toISOString()}`,
            meta: { appointmentId: appointment._id, scheduledAt: when },
        });

        /* 6. Move lead status if it's in an early stage */
        const earlyStages = ["new", "contacted", "qualified", "car_shared"];
        if (earlyStages.includes(lead.status)) {
            lead.status = type === "test_drive" ? "test_drive" : "visit_scheduled";
            lead.updatedBy = null;
            await lead.save();
        }

        /* 7. Notify the lead (customer) */
        await sendNotification({
            recipientType: "lead",
            leadId: lead._id,
            to: lead.phone,
            channel: "whatsapp",
            type: "appointment_scheduled",
            title:
                type === "test_drive"
                    ? "Test drive scheduled"
                    : "Showroom visit scheduled",
            body: `Your appointment is scheduled for ${when.toLocaleString()}.`,
            relatedTo: { appointment: appointment._id, vehicle: appointment.vehicle },
        });

        return ok(res, appointment, "Appointment scheduled successfully", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — List appointments
   GET /api/v1/appointments
   ============================================================ */
export const listAppointments = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const {
            status, type, assignedTo, lead,
            fromDate, toDate, today, upcoming,
        } = req.query;

        const filter = {};

        if (req.user.role === "sales_executive") {
            filter.assignedTo = req.user._id;
        } else if (assignedTo) {
            filter.assignedTo = assignedTo;
        }

        if (status) filter.status = status;
        if (type) filter.type = type;
        if (lead) filter.lead = lead;

        if (fromDate || toDate) {
            filter.scheduledAt = {};
            if (fromDate) filter.scheduledAt.$gte = new Date(fromDate);
            if (toDate) filter.scheduledAt.$lte = new Date(toDate);
        }

        if (today === "true") {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const end = new Date();
            end.setHours(23, 59, 59, 999);
            filter.scheduledAt = { $gte: start, $lte: end };
        }

        if (upcoming === "true") {
            filter.scheduledAt = { $gte: new Date() };
            filter.status = { $in: ["Requested", "Confirmed"] };
        }

        const [data, total] = await Promise.all([
            Appointment.find(filter)
                .populate("lead", "name phone email city status source")
                .populate("vehicle", "brand model year price images slug")
                .populate("assignedTo", "name email role")
                .sort("scheduledAt")
                .skip((page - 1) * limit)
                .limit(limit),
            Appointment.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Get single appointment
   GET /api/v1/appointments/:id
   ============================================================ */
export const getAppointment = async (req, res, next) => {
    try {
        const appointment = await Appointment.findById(req.params.id)
            .populate("lead", "name phone email city state source status assignedTo")
            .populate("vehicle", "brand model variant year price images slug status")
            .populate("assignedTo", "name email role")
            .populate("campaign", "name source type")
            .populate("createdBy", "name")
            .populate("updatedBy", "name");

        if (!appointment) return fail(res, "Appointment not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(appointment.assignedTo?._id) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        return ok(res, appointment);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Create appointment manually (for a Lead)
   POST /api/v1/appointments
   ============================================================ */
export const createAppointment = async (req, res, next) => {
    try {
        const {
            lead: leadId,
            customerName,
            customerPhone,
            vehicle: vehicleId,
            vehicleName,
            type,
            scheduledAt,
            time,
            status,
            assignedTo,
            notes,
        } = req.body;

        if (!leadId || !mongoose.isValidObjectId(leadId)) {
            return fail(res, "A valid lead is required", 400);
        }
        if (!scheduledAt) {
            return fail(res, "Visit date is required", 400);
        }

        const lead = await Lead.findById(leadId);
        if (!lead) return fail(res, "Lead not found", 404);

        let vehicle = null;
        if (vehicleId && mongoose.isValidObjectId(vehicleId)) {
            vehicle = await Vehicle.findById(vehicleId);
        }

        const appointment = await Appointment.create({
            lead: lead._id,
            customerName: customerName || lead.name || null,
            customerPhone: customerPhone || lead.phone || null,
            vehicle: vehicle?._id || null,
            vehicleName:
                vehicleName || (vehicle ? `${vehicle.brand} ${vehicle.model}` : null),
            type: type || "showroom_visit",
            scheduledAt: new Date(scheduledAt),
            time: time || null,
            status: status || "Requested",
            assignedTo:
                assignedTo && mongoose.isValidObjectId(assignedTo)
                    ? assignedTo
                    : req.user._id,
            notes,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        await appointment.populate([
            { path: "lead", select: "name phone email city status source assignedTo" },
            { path: "vehicle", select: "brand model year price images slug" },
            { path: "assignedTo", select: "name email role" },
        ]);

        return ok(res, appointment, "Appointment created", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Update appointment
   PATCH /api/v1/appointments/:id
   ============================================================ */
export const updateAppointment = async (req, res, next) => {
    try {
        const protectedFields = [
            "feedback", "completedAt", "cancelledAt",
            "rescheduledFrom", "rescheduledCount",
            "createdBy", "deletedAt",
        ];
        protectedFields.forEach((f) => delete req.body[f]);

        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) return fail(res, "Appointment not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(appointment.assignedTo) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        const {
            scheduledAt, time, status,
            customerName, customerPhone,
            vehicleName, assignedTo, notes,
        } = req.body;

        if (scheduledAt) appointment.scheduledAt = new Date(scheduledAt);
        if (time) appointment.time = time;
        if (status) appointment.status = status;
        if (customerName) appointment.customerName = customerName;
        if (customerPhone) appointment.customerPhone = customerPhone;
        if (vehicleName) appointment.vehicleName = vehicleName;
        if (assignedTo) appointment.assignedTo = assignedTo;
        if (notes) appointment.notes = notes;

        appointment.updatedBy = req.user._id;
        await appointment.save();

        return ok(res, appointment, "Appointment updated");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Assign to sales exec
   PATCH /api/v1/appointments/:id/assign
   ============================================================ */
export const assignAppointment = async (req, res, next) => {
    try {
        const { assignedTo } = req.body;
        if (!assignedTo) return fail(res, "assignedTo is required", 400);

        const appointment = await Appointment.findByIdAndUpdate(
            req.params.id,
            { assignedTo, updatedBy: req.user._id },
            { new: true }
        ).populate("assignedTo", "name email role");

        if (!appointment) return fail(res, "Appointment not found", 404);
        return ok(res, appointment, "Appointment assigned");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Update status
   PATCH /api/v1/appointments/:id/status
   ============================================================ */
export const updateAppointmentStatus = async (req, res, next) => {
    try {
        const { status, cancelledReason, cancelledReasonCategory } = req.body;

        const allowed = ["Requested", "Confirmed", "Completed", "Rescheduled", "Cancelled"];
        if (!allowed.includes(status)) return fail(res, "Invalid status", 400);

        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) return fail(res, "Appointment not found", 404);

        appointment.status = status;
        appointment.updatedBy = req.user._id;

        if (status === "Confirmed") {
            appointment.confirmedAt = new Date();
            appointment.customerConfirmed = true;
        }
        if (status === "Completed") appointment.completedAt = new Date();
        if (status === "Cancelled") {
            appointment.cancelledAt = new Date();
            appointment.cancelledReason = cancelledReason || null;
            appointment.cancelledReasonCategory = cancelledReasonCategory || null;
        }

        await appointment.save();

        if (appointment.lead) {
            await LeadActivity.create({
                lead: appointment.lead,
                type: "status_change",
                title: `Appointment ${status}`,
                description: `Appointment status changed to ${status}`,
                meta: { appointmentId: appointment._id, status },
            });
        }

        return ok(res, appointment, `Appointment marked as ${status}`);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Reschedule
   PATCH /api/v1/appointments/:id/reschedule
   ============================================================ */
export const rescheduleAppointment = async (req, res, next) => {
    try {
        const { scheduledAt, reason } = req.body;
        if (!scheduledAt) return fail(res, "scheduledAt is required", 400);

        const when = new Date(scheduledAt);
        if (isNaN(when.getTime())) return fail(res, "Invalid scheduledAt", 400);

        const appointment = await Appointment.findById(req.params.id).populate(
            "lead",
            "name phone"
        );
        if (!appointment) return fail(res, "Appointment not found", 404);

        appointment.rescheduledFrom = appointment.scheduledAt;
        appointment.scheduledAt = when;
        appointment.rescheduledCount += 1;
        appointment.status = "Rescheduled";
        appointment.notes = reason
            ? `${appointment.notes || ""}\nRescheduled: ${reason}`.trim()
            : appointment.notes;
        appointment.updatedBy = req.user._id;

        await appointment.save();

        if (appointment.lead) {
            await LeadActivity.create({
                lead: appointment.lead._id,
                type: "status_change",
                title: "Appointment rescheduled",
                description: `Rescheduled to ${when.toISOString()}${reason ? " — " + reason : ""}`,
                meta: { appointmentId: appointment._id },
            });

            await sendNotification({
                recipientType: "lead",
                leadId: appointment.lead._id,
                to: appointment.lead.phone,
                channel: "whatsapp",
                type: "appointment_rescheduled",
                title: "Appointment rescheduled",
                body: `Your appointment has been rescheduled to ${when.toLocaleString()}.`,
                relatedTo: {
                    appointment: appointment._id,
                    vehicle: appointment.vehicle,
                },
            });
        }

        return ok(res, appointment, "Appointment rescheduled");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Submit feedback after completion
   PATCH /api/v1/appointments/:id/feedback
   ============================================================ */
export const submitFeedback = async (req, res, next) => {
    try {
        const { rating, comments, interestedInBuying } = req.body;

        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) return fail(res, "Appointment not found", 404);

        if (!["Completed", "Cancelled"].includes(appointment.status))
            return fail(res, "Feedback only allowed after completion", 400);

        appointment.feedback = {
            rating: rating ?? null,
            comments: comments || null,
            interestedInBuying: interestedInBuying ?? null,
            submittedAt: new Date(),
        };
        appointment.updatedBy = req.user._id;
        await appointment.save();

        return ok(res, appointment, "Feedback submitted");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Delete (soft preferred)
   ============================================================ */
export const deleteAppointment = async (req, res, next) => {
    try {
        const appointment = await Appointment.findByIdAndDelete(req.params.id);
        if (!appointment) return fail(res, "Appointment not found", 404);
        return ok(res, {}, "Appointment deleted");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Dashboard stats
   GET /api/v1/appointments/stats/summary
   ============================================================ */
export const getAppointmentStats = async (req, res, next) => {
    try {
        const scopeFilter =
            req.user.role === "sales_executive"
                ? { assignedTo: req.user._id }
                : {};

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const [
            total,
            todayCount,
            upcomingCount,
            completedCount,
            cancelledCount,
            byType,
            avgRating,
        ] = await Promise.all([
            Appointment.countDocuments(scopeFilter),
            Appointment.countDocuments({
                ...scopeFilter,
                scheduledAt: { $gte: startOfDay, $lte: endOfDay },
            }),
            Appointment.countDocuments({
                ...scopeFilter,
                scheduledAt: { $gte: new Date() },
                status: { $in: ["Requested", "Confirmed"] },
            }),
            Appointment.countDocuments({ ...scopeFilter, status: "Completed" }),
            Appointment.countDocuments({ ...scopeFilter, status: "Cancelled" }),
            Appointment.aggregate([
                { $match: scopeFilter },
                { $group: { _id: "$type", count: { $sum: 1 } } },
            ]),
            Appointment.aggregate([
                { $match: { ...scopeFilter, "feedback.rating": { $ne: null } } },
                { $group: { _id: null, avg: { $avg: "$feedback.rating" } } },
            ]),
        ]);

        return ok(res, {
            total,
            today: todayCount,
            upcoming: upcomingCount,
            completed: completedCount,
            cancelled: cancelledCount,
            byType,
            avgRating: avgRating[0]?.avg
                ? Number(avgRating[0].avg.toFixed(2))
                : null,
        });
    } catch (err) {
        next(err);
    }
};