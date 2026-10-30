import mongoose from "mongoose";
import cron from "node-cron";
import Reservation from "../models/Reservation.js";
import Vehicle from "../models/Vehicle.js";
import Customer from "../models/Customer.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/leadActivity.js";
import Payment from "../models/Payment.js";
import { ok, fail } from "../utils/response.js";
import { sendNotification } from "../services/notification.service.js";
import { extractAttribution } from "../services/attribution.service.js";
import { notifyReservationConfirmed } from "../services/notification.service.js"

const generateReservationNumber = async () => {
    const count = await Reservation.countDocuments();
    return `RS-${String(count + 7600).padStart(4, "0")}`; // Starts from RS-7600
};

export const expireStaleReservations = async () => {
    const now = new Date();
    const batchSize = 50;

    // Find all reservations whose hold window has passed
    // while still unpaid/pending.
    const stale = await Reservation.find({
        status: { $in: ["initiated", "pending"] },
        paymentStatus: { $in: ["pending", "partial"] },
        expiresAt: { $ne: null, $lt: now },
        deletedAt: null,
    }).limit(batchSize);

    if (stale.length === 0) return { expired: 0 };

    let expiredCount = 0;

    for (const reservation of stale) {
        try {
            /* 1. Mark reservation as expired */
            reservation.status = "expired";
            reservation.cancelledAt = now;
            reservation.cancelledBy = "system";
            reservation.cancellationReason = "Hold period expired";
            reservation.cancellationCategory = "expired";
            await reservation.save();

            /* 2. Release the vehicle back to available */
            await Vehicle.findByIdAndUpdate(reservation.vehicle, {
                status: "available",
                reservedAt: null,
            });

            /* 3. Roll lead back to negotiation stage */
            if (reservation.lead) {
                const lead = await Lead.findById(reservation.lead);
                if (lead && lead.status === "reserved") {
                    lead.status = "negotiation";
                    await lead.save();
                }

                await LeadActivity.create({
                    lead: reservation.lead,
                    customer: reservation.customer,
                    type: "system",
                    title: "Reservation expired",
                    description: `Hold expired for reservation ${reservation.reservationNumber}`,
                    meta: { reservationId: reservation._id, expiresAt: reservation.expiresAt },
                });
            }

            /* 4. Notify customer via WhatsApp */
            const customer = await Customer.findById(reservation.customer);
            if (customer) {
                try {
                    await sendNotification({
                        recipientType: "customer",
                        customerId: customer._id,
                        to: customer.phone,
                        channel: "whatsapp",
                        type: "reservation_expiring",
                        title: "Reservation expired",
                        body: `Hi ${customer.name}, your reservation ${reservation.reservationNumber} has expired because payment was not completed. The vehicle is now available to other customers. You can reserve again anytime.`,
                        template: {
                            name: "reservation_expired",
                            language: "en",
                            variables: {
                                name: customer.name,
                                reservationNumber: reservation.reservationNumber,
                            },
                        },
                        relatedTo: {
                            reservation: reservation._id,
                            vehicle: reservation.vehicle,
                        },
                    });
                } catch (notifyErr) {
                    console.error(
                        `Notification failed for reservation ${reservation.reservationNumber}:`,
                        notifyErr.message
                    );
                }
            }

            expiredCount++;
        } catch (err) {
            console.error(
                `Failed to expire reservation ${reservation._id}:`,
                err.message
            );
        }
    }

    if (expiredCount > 0) {
        console.log(
            `[Cron] Expired ${expiredCount} stale reservation(s) at ${now.toISOString()}`
        );
    }

    return { expired: expiredCount };
};

export const startReservationExpiryJob = () => {
    const schedule = process.env.CRON_RESERVATION_EXPIRY || "*/15 * * * *";

    if (process.env.CRON_ENABLED === "false") {
        console.log("[Cron] Reservation expiry job disabled (CRON_ENABLED=false)");
        return;
    }

    cron.schedule(
        schedule,
        async () => {
            try {
                await expireStaleReservations();
            } catch (err) {
                console.error("[Cron] Reservation expiry job crashed:", err.message);
            }
        },
        {
            timezone: process.env.TZ || "Asia/Kolkata",
        }
    );

    console.log(`[Cron] Reservation expiry job scheduled: ${schedule}`);
};

/* ============================================================
   Helper — build snapshots from vehicle + customer
   ============================================================ */
const buildSnapshots = (vehicle, customer) => ({
    vehicleSnapshot: {
        stockId: vehicle.stockId,
        brand: vehicle.brand,
        model: vehicle.model,
        variant: vehicle.variant,
        year: vehicle.year,
        color: vehicle.color,
        kilometers: vehicle.kilometers,
        listedPrice: vehicle.price,
        image: vehicle.images?.[0] || null,
    },
    buyerSnapshot: {
        name: customer.name,
        phone: customer.phone,
        email: customer.email || null,
        city: customer.city || null,
    },
});

/* ============================================================
   PUBLIC — Initiate reservation (BRD 8.1)
   POST /api/v1/reservations/public
   Body: { name, phone, email?, city?, vehicle, lead?, source?,
           attribution?, reservationType?, termsAccepted }
   ============================================================ */
export const publicCreateReservation = async (req, res, next) => {
    try {
        const attribution = extractAttribution(req);
        const {
            name, phone, email, city,
            vehicle: vehicleId,
            lead: leadId,
            source,
            reservationType = "reservation",
            termsAccepted,
            notes,
        } = req.body;

        console.log("Public reservation request:", {
            name, phone, email, city,
            vehicleId, leadId, source,
            reservationType, termsAccepted, notes,
            attribution,
        });

        if (!name || !phone) return fail(res, "Name and phone are required", 400);
        if (!vehicleId) return fail(res, "Vehicle is required", 400);
        if (!termsAccepted) return fail(res, "Terms must be accepted", 400);

        /* 1. Vehicle check */
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return fail(res, "Vehicle not found", 404);
        if (vehicle.status !== "available")
            return fail(res, `Vehicle is currently ${vehicle.status} and cannot be reserved`, 409);

        /* 2. Existing active reservation on this vehicle? */
        const activeReservation = await Reservation.findOne({
            vehicle: vehicle._id,
            status: { $in: ["initiated", "pending", "confirmed"] },
        });
        if (activeReservation)
            return fail(res, "Vehicle already reserved by another customer", 409);

        /* 3. Find or create customer */
        let customer = await Customer.findOne({ phone });
        if (!customer) {
            customer = await Customer.create({
                name, phone, email, city,
                source: source || "direct_website",
                ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
            });
        }

        /* 4. Link to lead if provided */
        let lead = null;
        if (leadId && mongoose.isValidObjectId(leadId)) {
            lead = await Lead.findById(leadId);
        } else {
            // Try auto-match
            lead = await Lead.findOne({
                customer: customer._id,
                vehicle: vehicle._id,
                status: { $nin: ["won", "lost"] },
            }).sort("-createdAt");
        }

        /* 5. Auto-detect campaign */
        const campaignId = lead?.campaign || null;

        /* 6. Reservation amount — client should set this; default fallback */
        const reservationAmount =
            req.body.reservationAmount ?? Number(process.env.DEFAULT_RESERVATION_AMOUNT || 50000);

        /* 7. Create reservation */
        const { vehicleSnapshot, buyerSnapshot } = buildSnapshots(vehicle, customer);
        const holdHours = Number(process.env.RESERVATION_HOLD_HOURS) || 72;
        const expiresAt = new Date(Date.now() + holdHours * 60 * 60 * 1000);
        const reservation = await Reservation.create({
            reservationNumber: await generateReservationNumber(),
            customer: customer._id,
            vehicle: vehicle._id,
            lead: lead?._id || null,
            campaign: campaignId,
            reservationType,
            reservationAmount,
            amountPaid: 0,
            amountDue: reservationAmount,
            paymentStatus: "pending",
            status: "pending",
            expiresAt,
            source: source || customer.source || "direct_website",
            termsAccepted: true,
            termsAcceptedAt: new Date(),
            notes,
            vehicleSnapshot,
            buyerSnapshot,
            attribution
        });

        /* 8. Mark vehicle reserved */
        vehicle.status = "reserved";
        vehicle.reservedAt = new Date();
        vehicle.updatedBy = null;
        await vehicle.save();

        /* 9. Update lead */
        if (lead) {
            lead.status = "reserved";
            lead.updatedBy = null;
            await lead.save();

            await LeadActivity.create({
                lead: lead._id,
                customer: customer._id,
                type: "reservation",
                title: "Vehicle reserved",
                description: `Reservation ${reservation.reservationNumber} created`,
                meta: { reservationId: reservation._id, amount: reservationAmount },
            });
        }

        return ok(res, reservation, "Reservation initiated. Please complete payment.", 201);
    } catch (err) {
        if (err.code === 11000) return fail(res, "Vehicle already reserved", 409);
        next(err);
    }
};

export const createReservationManual = async (req, res, next) => {
    try {
        const {
            customer: customerId, customerName, customerPhone,
            vehicle: vehicleId, vehicleName,
            reservationDate, depositAmount, paymentCheck,
            status, transactionReference, cancellationRefund
        } = req.body;

        /* 1. Resolve Customer */
        let customer = null;
        if (customerId && mongoose.isValidObjectId(customerId)) {
            customer = await Customer.findById(customerId);
        } else if (customerName) {
            customer = await Customer.findOne({ phone: customerPhone || "temp" });
            if (!customer) {
                customer = await Customer.create({
                    name: customerName,
                    phone: customerPhone || `temp-${Date.now()}`,
                    source: "manual",
                });
            }
        }

        /* 2. Resolve Vehicle */
        let vehicle = null;
        if (vehicleId && mongoose.isValidObjectId(vehicleId)) {
            vehicle = await Vehicle.findById(vehicleId);
        }

        /* 3. Create Reservation */
        const reservation = await Reservation.create({
            reservationNumber: await generateReservationNumber(),
            customer: customer?._id || null,
            customerName: customerName || customer?.name,
            customerPhone: customerPhone || customer?.phone,

            vehicle: vehicle?._id || null,
            vehicleName: vehicleName || (vehicle ? `${vehicle.brand} ${vehicle.model}` : null),

            depositAmount: Number(depositAmount),
            reservationAmount: Number(depositAmount), // For backward compatibility

            paymentCheck: paymentCheck || "Pending",
            status: status || "Active",
            transactionReference,
            cancellationRefund,

            reservationDate: reservationDate ? new Date(reservationDate) : new Date(),

            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        // If vehicle is attached, mark it as reserved
        if (vehicle) {
            vehicle.status = "Reserved";
            vehicle.reservedAt = new Date();
            await vehicle.save();
        }

        return ok(res, reservation, "Reservation created successfully", 201);
    } catch (err) {
        next(err);
    }
};



/* ============================================================
   CRM — List reservations
   GET /api/v1/reservations
   ============================================================ */
export const listReservations = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const {
            status, paymentCheck, assignedTo, customer, vehicle,
            fromDate, toDate, expiringSoon, search, sort,
        } = req.query;

        const filter = {};

        if (req.user.role === "sales_executive") {
            filter.assignedTo = req.user._id;
        } else if (assignedTo) {
            filter.assignedTo = assignedTo;
        }

        // ✅ Filters
        if (status) filter.status = status;
        if (paymentCheck) filter.paymentCheck = paymentCheck;
        if (customer) filter.customer = customer;
        if (vehicle) filter.vehicle = vehicle;

        if (fromDate || toDate) {
            filter.reservationDate = {};
            if (fromDate) filter.reservationDate.$gte = new Date(fromDate);
            if (toDate) filter.reservationDate.$lte = new Date(toDate);
        }

        if (expiringSoon === "true") {
            const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
            filter.expiresAt = { $lte: in24h, $gte: new Date() };
            filter.status = "Active";
        }

        // ✅ Search
        if (search) {
            filter.$or = [
                { reservationNumber: new RegExp(search, "i") },
                { customerName: new RegExp(search, "i") },
                { vehicleName: new RegExp(search, "i") },
                { transactionReference: new RegExp(search, "i") },
            ];
        }

        // ✅ SORTING LOGIC
        let sortOptions = { createdAt: -1 }; // Default: Most recent
        if (sort === "recent") sortOptions = { createdAt: -1 };
        else if (sort === "deposit_low_high") sortOptions = { depositAmount: 1 };
        else if (sort === "deposit_high_low") sortOptions = { depositAmount: -1 };

        const [data, total] = await Promise.all([
            Reservation.find(filter)
                .populate("customer", "name phone email city")
                .populate("vehicle", "stockId brand model year askingPrice images slug status")
                .populate("assignedTo", "name email role")
                .sort(sortOptions)
                .skip((page - 1) * limit)
                .limit(limit),
            Reservation.countDocuments(filter),
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
   CRM — Get single reservation
   ============================================================ */
export const getReservation = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id)
            .populate("customer", "name phone email city state source")
            .populate("vehicle", "stockId brand model variant year price images slug status")
            .populate("lead", "status source assignedTo")
            .populate("assignedTo", "name email role")
            .populate("campaign", "name source type")
            .populate("payment")
            .populate("convertedToSale", "invoiceNumber pricing saleDate")
            .populate("createdBy", "name")
            .populate("updatedBy", "name");

        if (!reservation) return fail(res, "Reservation not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(reservation.assignedTo?._id) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        return ok(res, reservation);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Update reservation (notes, assignedTo, expiresAt)
   ============================================================ */
export const updateReservation = async (req, res, next) => {
    try {
        const protectedFields = [
            "reservationNumber", "customer", "vehicle", "vehicleSnapshot",
            "buyerSnapshot", "convertedToSale", "createdBy", "deletedAt",
        ];
        protectedFields.forEach((f) => delete req.body[f]);

        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(reservation.assignedTo) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        Object.assign(reservation, req.body);
        reservation.updatedBy = req.user._id;
        await reservation.save();

        return ok(res, reservation, "Reservation updated");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Assign to sales exec
   ============================================================ */
export const assignReservation = async (req, res, next) => {
    try {
        const { assignedTo } = req.body;
        if (!assignedTo) return fail(res, "assignedTo is required", 400);

        const reservation = await Reservation.findByIdAndUpdate(
            req.params.id,
            { assignedTo, updatedBy: req.user._id },
            { new: true }
        ).populate("assignedTo", "name email role");

        if (!reservation) return fail(res, "Reservation not found", 404);
        return ok(res, reservation, "Reservation assigned");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Confirm reservation manually
   PATCH /api/v1/reservations/:id/confirm
   ============================================================ */
export const confirmReservation = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);
        if (reservation.status === "confirmed")
            return fail(res, "Reservation already confirmed", 400);
        if (["cancelled", "expired", "refunded"].includes(reservation.status))
            return fail(res, `Cannot confirm a ${reservation.status} reservation`, 400);

        reservation.status = "confirmed";
        reservation.confirmedAt = new Date();
        reservation.paymentStatus =
            reservation.amountPaid >= reservation.reservationAmount ? "paid" : "partial";
        reservation.updatedBy = req.user._id;
        await reservation.save();

        notifyReservationConfirmed(reservation).catch((err) =>
            console.error("Reservation notify failed:", err.message)
        );
        return ok(res, reservation, "Reservation confirmed");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Extend reservation validity (default 3 more days)
   PATCH /api/v1/reservations/:id/extend
   Body: { expiresAt? }  // optional — if not given, extends by 3 days
   ============================================================ */
export const extendReservation = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);
        if (!["initiated", "pending", "confirmed"].includes(reservation.status))
            return fail(res, "Cannot extend this reservation", 400);

        let newExpiry;
        if (req.body.expiresAt) {
            newExpiry = new Date(req.body.expiresAt);
            if (isNaN(newExpiry.getTime()))
                return fail(res, "Invalid expiresAt", 400);
        } else {
            // Default: extend by RESERVATION_HOLD_HOURS from now
            const holdHours = Number(process.env.RESERVATION_HOLD_HOURS) || 72;
            newExpiry = new Date(Date.now() + holdHours * 60 * 60 * 1000);
        }

        reservation.expiresAt = newExpiry;
        reservation.extendedCount += 1;
        reservation.extendedAt = new Date();
        reservation.updatedBy = req.user._id;
        await reservation.save();

        return ok(res, reservation, `Reservation extended to ${newExpiry.toISOString()}`);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Cancel reservation
   PATCH /api/v1/reservations/:id/cancel
   ============================================================ */
export const cancelReservation = async (req, res, next) => {
    try {
        const { cancellationReason, cancellationCategory } = req.body;

        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);
        if (["completed", "cancelled", "refunded"].includes(reservation.status))
            return fail(res, `Cannot cancel a ${reservation.status} reservation`, 400);

        reservation.status = "cancelled";
        reservation.cancelledAt = new Date();
        reservation.cancelledBy = "staff";
        reservation.cancellationReason = cancellationReason || null;
        reservation.cancellationCategory = cancellationCategory || "other";
        reservation.updatedBy = req.user._id;
        await reservation.save();

        /* Free up the vehicle */
        await Vehicle.findByIdAndUpdate(reservation.vehicle, {
            status: "available",
            reservedAt: null,
            updatedBy: req.user._id,
        });

        /* Roll lead back to previous stage */
        if (reservation.lead) {
            const lead = await Lead.findById(reservation.lead);
            if (lead && lead.status === "reserved") {
                lead.status = "negotiation";
                lead.updatedBy = req.user._id;
                await lead.save();
            }

            await LeadActivity.create({
                lead: reservation.lead,
                customer: reservation.customer,
                type: "status_change",
                title: "Reservation cancelled",
                description: cancellationReason || "Reservation cancelled",
                meta: { reservationId: reservation._id },
            });
        }

        return ok(res, reservation, "Reservation cancelled");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Mark as completed (e.g., converted to sale or closed)
   PATCH /api/v1/reservations/:id/complete
   ============================================================ */
export const completeReservation = async (req, res, next) => {
    try {
        const { convertedToSale } = req.body;

        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);

        reservation.status = "completed";
        reservation.convertedAt = new Date();
        if (convertedToSale) reservation.convertedToSale = convertedToSale;
        reservation.updatedBy = req.user._id;
        await reservation.save();

        return ok(res, reservation, "Reservation completed");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Soft delete
   ============================================================ */
export const deleteReservation = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);

        // Free vehicle if active
        if (["initiated", "pending", "confirmed"].includes(reservation.status)) {
            await Vehicle.findByIdAndUpdate(reservation.vehicle, {
                status: "available",
                reservedAt: null,
                updatedBy: req.user._id,
            });
        }

        reservation.deletedAt = new Date();
        reservation.isActive = false;
        reservation.updatedBy = req.user._id;
        await reservation.save();

        return ok(res, {}, "Reservation deleted");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Dashboard stats (BRD 9.1)
   ============================================================ */
export const getReservationStats = async (req, res, next) => {
    try {
        const scopeFilter =
            req.user.role === "sales_executive" ? { assignedTo: req.user._id } : {};

        const [total, active, confirmed, cancelled, completed, expired, byStatus, byPayment] =
            await Promise.all([
                Reservation.countDocuments(scopeFilter),
                Reservation.countDocuments({
                    ...scopeFilter,
                    status: { $in: ["initiated", "pending"] },
                }),
                Reservation.countDocuments({ ...scopeFilter, status: "confirmed" }),
                Reservation.countDocuments({ ...scopeFilter, status: "cancelled" }),
                Reservation.countDocuments({ ...scopeFilter, status: "completed" }),
                Reservation.countDocuments({ ...scopeFilter, status: "expired" }),
                Reservation.aggregate([
                    { $match: scopeFilter },
                    { $group: { _id: "$status", count: { $sum: 1 } } },
                ]),
                Reservation.aggregate([
                    { $match: scopeFilter },
                    { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
                ]),
            ]);

        return ok(res, {
            total,
            active,
            confirmed,
            cancelled,
            completed,
            expired,
            byStatus,
            byPayment,
        });
    } catch (err) {
        next(err);
    }
};

import { detectRefundScenario, shouldAutoApprove, buildRefundMessage }
    from "../services/refundPolicy.service.js";

/* ============================================================
   PUBLIC — Customer requests refund
   POST /api/v1/reservations/:id/refund/request
   Body: { inspectionDone, reason, customerEmail?, customerMessage? }
   ============================================================ */
export const requestRefund = async (req, res, next) => {
    try {
        const { inspectionDone = false, reason, customerEmail, customerMessage } = req.body;

        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);

        // Only paid reservations can be refunded
        if (reservation.paymentStatus === "pending") {
            return fail(res, "No payment received on this reservation", 400);
        }
        if (["cancelled", "expired", "refunded"].includes(reservation.status)) {
            return fail(res, `Cannot request refund for a ${reservation.status} reservation`, 400);
        }
        if (reservation.refundRequest) {
            return fail(res, "A refund request already exists for this reservation", 409);
        }

        // Determine scenario
        const scenario = detectRefundScenario({ inspectionDone });
        const autoApprove = shouldAutoApprove(scenario);

        // For scenario B, email is mandatory
        if (scenario === "no_visit_email" && !customerEmail && !customerMessage) {
            return fail(
                res,
                "Please provide an email or message explaining your refund request",
                400
            );
        }

        // Refund amount = whatever was paid
        const refundAmount = reservation.amountPaid || 0;

        reservation.refundRequest = {
            requestedBy: "customer",
            requestedAt: new Date(),
            scenario,
            reason: reason || null,
            customerEmail: customerEmail || null,
            customerMessage: customerMessage || null,
            status: autoApprove ? "auto_approved" : "pending_review",
            refundAmount,
            refundMethod: "original_payment",
        };

        // If auto-approved (Scenario A), we still don't process immediately —
        // it goes to CRM where staff clicks "Process refund" (which calls Razorpay).
        // This matches client's "full refund" promise while keeping ops control.

        await reservation.save();

        // Notify CRM admin team
        await sendNotification({
            recipientType: "staff",        // use "admin" if you have that enum
            to: process.env.ADMIN_EMAIL || "admin@shivayeluxurycars.com",
            channel: "email",
            type: "custom",
            title: `Refund request — ${scenario === "physical_inspection" ? "AUTO" : "REVIEW"} — ${reservation.reservationNumber}`,
            body:
                scenario === "physical_inspection"
                    ? `Customer ${reservation.buyerSnapshot?.name} requested full refund after physical inspection. Amount: ₹${refundAmount}.`
                    : `Customer ${reservation.buyerSnapshot?.name} requested refund (no visit). Message: ${customerMessage || reason || "-"}. Amount: ₹${refundAmount}.`,
            relatedTo: { reservation: reservation._id },
        });

        return ok(
            res,
            {
                reservationId: reservation._id,
                reservationNumber: reservation.reservationNumber,
                scenario,
                status: reservation.refundRequest.status,
                refundAmount,
                message: buildRefundMessage(scenario),
            },
            "Refund request submitted",
            201
        );
    } catch (err) {
        next(err);
    }
};
/* ============================================================
   CRM — Review refund request (Scenario B only)
   PATCH /api/v1/reservations/:id/refund/review
   Body: { action: "approve" | "reject", reviewNotes? }
   ============================================================ */
export const reviewRefundRequest = async (req, res, next) => {
    try {
        const { action, reviewNotes } = req.body;

        if (!["approve", "reject"].includes(action)) {
            return fail(res, "action must be 'approve' or 'reject'", 400);
        }

        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);
        if (!reservation.refundRequest) {
            return fail(res, "No refund request found on this reservation", 404);
        }

        const rf = reservation.refundRequest;

        // Scenario A auto-approved — no review needed
        if (rf.scenario === "physical_inspection") {
            return fail(res, "This refund was auto-approved. Use /refund/process instead.", 400);
        }

        if (rf.status !== "pending_review") {
            return fail(res, `Refund request is already ${rf.status}`, 400);
        }

        rf.status = action === "approve" ? "approved" : "rejected";
        rf.reviewedBy = req.user._id;
        rf.reviewedAt = new Date();
        rf.reviewNotes = reviewNotes || null;

        await reservation.save();

        // If rejected → notify customer
        if (action === "reject") {
            const customer = await Customer.findById(reservation.customer);
            if (customer) {
                await sendNotification({
                    recipientType: "customer",
                    customerId: customer._id,
                    to: customer.phone,
                    channel: "whatsapp",
                    type: "custom",
                    title: "Refund request update",
                    body: `Hi ${customer.name}, after review, we are unable to process the refund for reservation ${reservation.reservationNumber}. Reason: ${reviewNotes || "As per policy"}. Please contact us for more details.`,
                    relatedTo: { reservation: reservation._id },
                });
            }
        }

        // If approved → notify customer that refund will be processed shortly
        if (action === "approve") {
            const customer = await Customer.findById(reservation.customer);
            if (customer) {
                await sendNotification({
                    recipientType: "customer",
                    customerId: customer._id,
                    to: customer.phone,
                    channel: "whatsapp",
                    type: "custom",
                    title: "Refund approved",
                    body: `Hi ${customer.name}, your refund of ₹${rf.refundAmount} for reservation ${reservation.reservationNumber} has been approved and will be processed shortly.`,
                    relatedTo: { reservation: reservation._id },
                });
            }
        }

        return ok(res, reservation, `Refund ${rf.status}`);
    } catch (err) {
        next(err);
    }
};

import Razorpay from "razorpay";  // top of file

let razorpayClient = null;
const getRazorpay = () => {
    if (!razorpayClient) {
        razorpayClient = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
    }
    return razorpayClient;
};

/* ============================================================
   CRM — Process refund via Razorpay
   PATCH /api/v1/reservations/:id/refund/process
   Body: { refundMethod?: "original_payment" | "bank_transfer" | "manual" }
   ============================================================ */
export const processRefundRequest = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);
        if (!reservation.refundRequest) {
            return fail(res, "No refund request found", 404);
        }

        const rf = reservation.refundRequest;

        // Can only process auto_approved (Scenario A) or approved (Scenario B)
        if (!["auto_approved", "approved"].includes(rf.status)) {
            return fail(res, `Cannot process refund with status: ${rf.status}`, 400);
        }

        // Get the original payment
        const payment = await Payment.findOne({
            reservation: reservation._id,
            status: "paid",
        }).sort("-paidAt");

        if (!payment) return fail(res, "No successful payment found for this reservation", 404);
        if (!payment.gatewayPaymentId) {
            return fail(res, "Payment has no Razorpay payment ID", 400);
        }

        // Call Razorpay refund
        const rzp = getRazorpay();
        let rzRefund;
        try {
            rzRefund = await rzp.payments.refund(payment.gatewayPaymentId, {
                amount: Math.round(rf.refundAmount * 100),   // paise
                notes: {
                    reservationId: String(reservation._id),
                    reservationNumber: reservation.reservationNumber,
                    scenario: rf.scenario,
                    reviewNotes: rf.reviewNotes || "",
                },
            });
        } catch (rzErr) {
            console.error("Razorpay refund error:", rzErr.message);
            return fail(res, `Payment gateway refund failed: ${rzErr.message}`, 400);
        }

        // Update refund request
        rf.status = "processed";
        rf.refundId = rzRefund.id;
        rf.refundMethod = req.body.refundMethod || "original_payment";
        rf.processedAt = new Date();
        rf.processedBy = req.user._id;

        // Update reservation
        reservation.status = "refunded";
        reservation.paymentStatus = "refunded";
        reservation.refundedAt = new Date();
        reservation.updatedBy = req.user._id;
        await reservation.save();

        // Update Payment record
        payment.refund = {
            refundId: rzRefund.id,
            amount: rf.refundAmount,
            reason: rf.reason || "Customer refund request",
            status: rzRefund.status === "processed" ? "processed" : "pending",
            initiatedAt: new Date(),
            processedAt: rzRefund.status === "processed" ? new Date() : null,
            initiatedBy: req.user._id,
        };
        if (rf.refundAmount === payment.amount) {
            payment.status = "refunded";
            payment.refundedAt = new Date();
        }
        await payment.save();

        // Free up the vehicle
        await Vehicle.findByIdAndUpdate(reservation.vehicle, {
            status: "available",
            reservedAt: null,
            updatedBy: req.user._id,
        });

        // Notify customer
        const customer = await Customer.findById(reservation.customer);
        if (customer) {
            await sendNotification({
                recipientType: "customer",
                customerId: customer._id,
                to: customer.phone,
                channel: "whatsapp",
                type: "payment_refund",
                title: "Refund processed",
                body: `Hi ${customer.name}, your refund of ₹${rf.refundAmount} for reservation ${reservation.reservationNumber} has been processed. It will reflect in 3-5 business days.`,
                relatedTo: {
                    reservation: reservation._id,
                    payment: payment._id,
                },
            });
        }

        return ok(
            res,
            {
                reservationId: reservation._id,
                reservationNumber: reservation.reservationNumber,
                refundAmount: rf.refundAmount,
                refundId: rzRefund.id,
                status: "processed",
            },
            "Refund processed successfully"
        );
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   Get refund request details
   GET /api/v1/reservations/:id/refund
   ============================================================ */
export const getRefundRequest = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id)
            .select("reservationNumber buyerSnapshot refundRequest status paymentStatus refundedAt")
            .populate("refundRequest.reviewedBy", "name role")
            .populate("refundRequest.processedBy", "name role");

        if (!reservation) return fail(res, "Reservation not found", 404);
        if (!reservation.refundRequest) {
            return ok(res, null, "No refund request found");
        }

        return ok(res, {
            reservationNumber: reservation.reservationNumber,
            buyer: reservation.buyerSnapshot,
            refund: reservation.refundRequest,
            reservationStatus: reservation.status,
            refundedAt: reservation.refundedAt,
        });
    } catch (err) {
        next(err);
    }
};