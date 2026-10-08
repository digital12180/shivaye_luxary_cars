import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Customer from "../models/Customer.js";
import Vehicle from "../models/Vehicle.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/leadActivity.js";
import { ok, fail } from "../utils/response.js";
import { sendNotification } from "../services/notification.service.js";

/* ============================================================
   PUBLIC — Book a test drive / showroom visit 
   POST /api/v1/appointments/public
   ============================================================ */
export const publicCreateAppointment = async (req, res, next) => {
    try {
        const {
            name, phone, email, city,
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

        /* 1. Find or create customer */
        let customer = await Customer.findOne({ phone });
        if (!customer) {
            customer = await Customer.create({
                name, phone, email, city,
                source: source || "direct_website",
                attribution: attribution || {},
                ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
            });
        }

        /* 2. Validate vehicle */
        let vehicle = null;
        if (vehicleId && mongoose.isValidObjectId(vehicleId)) {
            vehicle = await Vehicle.findById(vehicleId);
        }

        /* 3. Find matching open lead (if any) */
        const lead = await Lead.findOne({
            customer: customer._id,
            status: { $nin: ["won", "lost"] },
            ...(vehicle ? { vehicle: vehicle._id } : {}),
        }).sort("-createdAt");

        /* 4. Conflict check — same customer, same vehicle, same 30-min slot */
        const slotStart = new Date(when.getTime() - 15 * 60 * 1000);
        const slotEnd = new Date(when.getTime() + 45 * 60 * 1000);
        const clash = await Appointment.findOne({
            customer: customer._id,
            scheduledAt: { $gte: slotStart, $lte: slotEnd },
            status: { $in: ["scheduled", "confirmed"] },
        });
        if (clash) return fail(res, "You already have an appointment around this time", 409);

        /* 5. Create appointment */
        const appointment = await Appointment.create({
            customer: customer._id,
            vehicle: vehicle?._id || null,
            lead: lead?._id || null,
            type,
            scheduledAt: when,
            notes,
            source: source || customer.source || "direct_website",
            attribution: attribution || {},
            location: req.body.location || customer.city,
        });

        /* 6. Log activity on the lead */
        if (lead) {
            await LeadActivity.create({
                lead: lead._id,
                customer: customer._id,
                type: type === "test_drive" ? "test_drive" : "showroom_visit",
                title: type === "test_drive" ? "Test drive requested" : "Showroom visit scheduled",
                description: `Scheduled for ${when.toISOString()}`,
                meta: { appointmentId: appointment._id, scheduledAt: when },
            });

            // Move lead status if currently earlier
            const earlyStages = ["new", "contacted", "qualified", "car_shared"];
            if (earlyStages.includes(lead.status)) {
                lead.status = type === "test_drive" ? "test_drive" : "visit_scheduled";
                lead.updatedBy = null;
                await lead.save();
            }
        }
        await sendNotification({
            recipientType: "customer",
            customerId: customer._id,
            to: customer.phone,
            channel: "whatsapp",
            type: "appointment_scheduled",
            title: type === "test_drive" ? "Test drive scheduled" : "Showroom visit scheduled",
            body: `Your appointment is scheduled for ${when.toLocaleString()}.`,
            relatedTo: { appointment: appointment._id, vehicle: appointment.vehicle },
        });
        return ok(res, appointment, "Appointment scheduled successfully", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — List appointments (with calendar filters)
   GET /api/v1/appointments
   ============================================================ */
export const listAppointments = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const {
            status, type, assignedTo, customer,
            fromDate, toDate, today, upcoming,
        } = req.query;

        const filter = {};

        // Sales exec sees own appointments only
        if (req.user.role === "sales_executive") {
            filter.assignedTo = req.user._id;
        } else if (assignedTo) {
            filter.assignedTo = assignedTo;
        }

        if (status) filter.status = status;
        if (type) filter.type = type;
        if (customer) filter.customer = customer;

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
            filter.status = { $in: ["scheduled", "confirmed"] };
        }

        const [data, total] = await Promise.all([
            Appointment.find(filter)
                .populate("customer", "name phone email city")
                .populate("vehicle", "brand model year price images slug")
                .populate("lead", "status source")
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
            .populate("customer", "name phone email city state source")
            .populate("vehicle", "brand model variant year price images slug status")
            .populate("lead", "status source assignedTo")
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
   CRM — Create appointment manually
   POST /api/v1/appointments
   ============================================================ */
export const createAppointment = async (req, res, next) => {
    try {
        const { customer: customerId, vehicle: vehicleId, type, scheduledAt } = req.body;

        if (!customerId || !type || !scheduledAt)
            return fail(res, "customer, type and scheduledAt are required", 400);

        const customer = await Customer.findById(customerId);
        if (!customer) return fail(res, "Customer not found", 404);

        let vehicle = null;
        if (vehicleId && mongoose.isValidObjectId(vehicleId)) {
            vehicle = await Vehicle.findById(vehicleId);
        }

        const appointment = await Appointment.create({
            ...req.body,
            customer: customer._id,
            vehicle: vehicle?._id || null,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });
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

        Object.assign(appointment, req.body);
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
   CRM — Update status (confirmed / completed / no_show / cancelled)
   PATCH /api/v1/appointments/:id/status
   ============================================================ */
export const updateAppointmentStatus = async (req, res, next) => {
    try {
        const { status, cancelledReason, cancelledReasonCategory } = req.body;
        const allowed = ["scheduled", "confirmed", "completed", "cancelled", "no_show"];
        if (!allowed.includes(status)) return fail(res, "Invalid status", 400);

        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) return fail(res, "Appointment not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(appointment.assignedTo) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        appointment.status = status;
        appointment.updatedBy = req.user._id;

        if (status === "confirmed") {
            appointment.confirmedAt = new Date();
            appointment.customerConfirmed = true;
        }
        if (status === "completed") appointment.completedAt = new Date();
        if (status === "cancelled") {
            appointment.cancelledAt = new Date();
            appointment.cancelledReason = cancelledReason || null;
            appointment.cancelledReasonCategory = cancelledReasonCategory || null;
        }
        if (status === "no_show") appointment.completedAt = new Date();

        await appointment.save();

        // Log on linked lead
        if (appointment.lead) {
            await LeadActivity.create({
                lead: appointment.lead,
                customer: appointment.customer,
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

        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) return fail(res, "Appointment not found", 404);

        appointment.rescheduledFrom = appointment.scheduledAt;
        appointment.scheduledAt = when;
        appointment.rescheduledCount += 1;
        appointment.status = "scheduled";
        appointment.notes = reason
            ? `${appointment.notes || ""}\nRescheduled: ${reason}`.trim()
            : appointment.notes;
        appointment.updatedBy = req.user._id;

        await appointment.save();

        if (appointment.lead) {
            await LeadActivity.create({
                lead: appointment.lead,
                customer: appointment.customer,
                type: "status_change",
                title: "Appointment rescheduled",
                description: `Rescheduled to ${when.toISOString()}${reason ? " — " + reason : ""}`,
                meta: { appointmentId: appointment._id },
            });
        }
        await sendNotification({
            recipientType: "customer",
            customerId: customer._id,
            to: customer.phone,
            channel: "whatsapp",
            type: "appointment_scheduled",
            title: type === "test_drive" ? "Test drive scheduled" : "Showroom visit scheduled",
            body: `Your appointment is scheduled for ${when.toLocaleString()}.`,
            relatedTo: { appointment: appointment._id, vehicle: appointment.vehicle },
        });
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
        if (appointment.status !== "completed" && appointment.status !== "no_show")
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
   CRM — Soft delete
   DELETE /api/v1/appointments/:id
   ============================================================ */
export const deleteAppointment = async (req, res, next) => {
    try {
        const appointment = await Appointment.findByIdAndUpdate(
            req.params.id,
            { deletedAt: new Date(), isActive: false, updatedBy: req.user._id },
            { new: true }
        );
        if (!appointment) return fail(res, "Appointment not found", 404);
        return ok(res, {}, "Appointment deleted");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Dashboard stats (BRD 9.1)
   GET /api/v1/appointments/stats/summary
   ============================================================ */
export const getAppointmentStats = async (req, res, next) => {
    try {
        const scopeFilter =
            req.user.role === "sales_executive" ? { assignedTo: req.user._id } : {};

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
            noShowCount,
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
                status: { $in: ["scheduled", "confirmed"] },
            }),
            Appointment.countDocuments({ ...scopeFilter, status: "completed" }),
            Appointment.countDocuments({ ...scopeFilter, status: "cancelled" }),
            Appointment.countDocuments({ ...scopeFilter, status: "no_show" }),
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
            noShow: noShowCount,
            byType,
            avgRating: avgRating[0]?.avg ? Number(avgRating[0].avg.toFixed(2)) : null,
        });
    } catch (err) {
        next(err);
    }
};