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

const generateReservationNumber = () => {
    const date = new Date();
    const dateStr = `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const randomStr = Math.floor(1000 + Math.random() * 9000);
    return `RS-${dateStr}-${randomStr}`;
};

export const expireStaleReservations = async () => {
    const now = new Date();

    const stale = await Reservation.find({
        status: "Active",                             // ✅ FIX
        paymentStatus: { $in: ["pending", "partial"] },
        expiresAt: { $lt: now },
    }).limit(50);

    let count = 0;
    for (const res of stale) {
        res.status = "Expired";                       // ✅ FIX
        res.cancelledAt = now;
        res.cancelledBy = "system";
        res.cancellationReason = "Hold period expired";
        res.cancellationCategory = "expired";
        await res.save();

        await Vehicle.findByIdAndUpdate(res.vehicle, {
            status: "Available",                        // ✅ FIX
            reservedAt: null,
        });

        if (res.lead) {
            await Lead.findByIdAndUpdate(res.lead, { status: "Negotiation" });  // ✅ FIX
            await LeadActivity.create({
                lead: res.lead,
                customer: res.customer,
                type: "system",
                title: "Reservation expired",
                description: `Hold expired for reservation ${res.reservationNumber}`,
                meta: { reservationId: res._id },
            });
        }
        count++;
    }

    return { expired: count };
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
        { timezone: process.env.TZ || "Asia/Kolkata" }
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

const ALLOWED_SOURCES = [
    "google_ads", "facebook_ads", "instagram", "organic",
    "direct_website", "whatsapp", "phone", "walk_in",
    "referral", "manual", "other",
];

/* ============================================================
   PUBLIC — Initiate reservation
   Vehicle stays "Available" until payment succeeds.
   ============================================================ */
export const publicCreateReservation = async (req, res, next) => {
    try {
        const attribution = extractAttribution(req);
        const { ip, location } = captureLocation(req);
        const {
            name, phone, email, city,
            vehicle: vehicleId,
            lead: leadId,
            source,
            reservationType = "reservation",
            termsAccepted,
            notes,
        } = req.body;

        // Validation
        if (!name || !phone) return fail(res, "Name and phone are required", 400);
        if (!vehicleId) return fail(res, "Vehicle is required", 400);
        const termsOk = termsAccepted === true || termsAccepted === "true";
        if (!termsOk) return fail(res, "Terms must be accepted", 400);
        if (!mongoose.isValidObjectId(vehicleId)) return fail(res, "Invalid vehicle ID", 400);

        const safeSource = ALLOWED_SOURCES.includes(source) ? source : "direct_website";

        /* 1. Vehicle check — must be Available */
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        if (vehicle.status !== "Available") {
            return fail(res, `Vehicle is currently ${vehicle.status} and cannot be reserved`, 409);
        }

        /* 3. Customer — name-aware lookup (senior's rule)
              Same phone + different name = NEW customer, don't reuse old record */
        let customer = await Customer.findOne({
            phone,
            name: new RegExp(`^${name.trim()}$`, "i"),
        });
        if (!customer) {
            customer = await Customer.create({
                name,
                phone,
                email,
                city,
                source: safeSource,
                ipAddress: ip,         
                ipLocation: location,
            });
        }

        /* 4. Lead linkage */
        let lead = null;
        if (leadId && mongoose.isValidObjectId(leadId)) {
            lead = await Lead.findOne({ _id: leadId, customer: customer._id });
        }
        if (!lead) {
            lead = await Lead.findOne({
                customer: customer._id,
                vehicle: vehicle._id,
                status: { $nin: ["Won", "Lost"] },      // ✅ FIX: capital W/L
            }).sort("-createdAt");
        }
        const campaignId = lead?.campaign || null;

        /* 5. Reservation amount */
        const vehiclePrice = Number(vehicle.askingPrice) || 0;
        let reservationAmount = 25000;
        if (vehiclePrice > 2500000) {
            reservationAmount = 50000;
        }

        /* 6. Create reservation — vehicle stays "Available" */
        const { vehicleSnapshot, buyerSnapshot } = buildSnapshots(vehicle, customer);
        const holdHours = Number(process.env.RESERVATION_HOLD_HOURS) || 72;
        const expiresAt = new Date(Date.now() + holdHours * 3600 * 1000);

        const reservation = await Reservation.create({
            reservationNumber: await generateReservationNumber(),
            customer: customer._id,
            vehicle: vehicle._id,
            lead: lead?._id || null,
            campaign: campaignId,
            reservationType,
            reservationAmount: reservationAmount,
            amountPaid: 0,
            amountDue: reservationAmount,
            paymentStatus: "pending",
            status: "Active",
            expiresAt,
            source: safeSource,
            termsAccepted: true,
            termsAcceptedAt: new Date(),
            notes,
            vehicleSnapshot,
            buyerSnapshot,
            attribution,
        });

        /* 7. Lead pipeline → "Reserved" (forward-only) */
        if (lead) {
            // ✅ FIX P6/P7: forward-only guard + correct enum
            const STAGE_RANK = { New: 0, Contacted: 1, Qualified: 2, "Test Drive": 3, "Visit Scheduled": 4, Negotiation: 5, Reserved: 6, Booked: 7, Won: 8 };
            const currentRank = STAGE_RANK[lead.status] ?? -1;
            if (STAGE_RANK["Reserved"] > currentRank) {
                lead.status = "Reserved";
                lead.stageHistory = lead.stageHistory || [];
                lead.stageHistory.push({ stage: "Reserved", changedBy: null, note: "Public reservation (pending payment)" });
                await lead.save();
            }

            await LeadActivity.create({
                lead: lead._id,
                customer: customer._id,
                type: "reservation",
                title: "Vehicle reserved (Pending Payment)",
                description: `Reservation ${reservation.reservationNumber} created`,
                meta: { reservationId: reservation._id, amount: reservationAmount },
            }).catch((e) => console.error("LeadActivity failed", e));
        }

        return ok(res, reservation, "Reservation initiated. Please complete payment.", 201);
    } catch (err) {
        if (err.code === 11000) {
            return fail(res, "Please retry — temporary conflict", 409);
        }
        next(err);
    }
};

export const createReservationManual = async (req, res, next) => {
    try {
        const {
            customer: customerId, customerName, customerPhone,
            vehicle: vehicleId, vehicleName,
            reservationDate, transactionReference, cancellationRefund
        } = req.body;

        /* 1. Resolve Customer — name-aware */
        let customer = null;
        if (customerId && mongoose.isValidObjectId(customerId)) {
            customer = await Customer.findById(customerId);
        } else if (customerName) {
            // ✅ FIX P5: name-aware lookup
            customer = await Customer.findOne({
                phone: customerPhone || "temp",
                name: new RegExp(`^${customerName.trim()}$`, "i"),
            });
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

        /* 3. Calculate Reservation Amount */
        let finalDepositAmount = 25000;
        if (vehicle) {
            const vehiclePrice = Number(vehicle.price) || 0;
            finalDepositAmount = 25000;
            if (vehiclePrice > 2500000) {
                finalDepositAmount = vehiclePrice * 0.10;
            }
        }

        /* 4. Create Reservation — do NOT touch vehicle status */
        const reservation = await Reservation.create({
            reservationNumber: await generateReservationNumber(),
            customer: customer?._id || null,
            customerName: customerName || customer?.name,
            customerPhone: customerPhone || customer?.phone,
            vehicle: vehicle?._id || null,
            vehicleName: vehicleName || (vehicle ? `${vehicle.brand} ${vehicle.model}` : null),
            reservationAmount: finalDepositAmount,
            amountPaid: 0,
            amountDue: finalDepositAmount,
            paymentCheck: "Pending",
            paymentStatus: "pending",           // ✅ FIX: keep in sync
            status: "Active",
            transactionReference,
            cancellationRefund,
            reservationDate: reservationDate ? new Date(reservationDate) : new Date(),
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        // ✅ FIX P1: Removed — vehicle should NOT be marked "Reserved" here.
        // Vehicle is claimed only after successful payment (verifyPayment / webhook).

        return ok(res, reservation, "Reservation created successfully", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — List reservations
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

        if (search) {
            filter.$or = [
                { reservationNumber: new RegExp(search, "i") },
                { customerName: new RegExp(search, "i") },
                { vehicleName: new RegExp(search, "i") },
                { transactionReference: new RegExp(search, "i") },
            ];
        }

        let sortOptions = { createdAt: -1 };
        if (sort === "recent") sortOptions = { createdAt: -1 };
        else if (sort === "deposit_low_high") sortOptions = { reservationAmount: 1 }; // ✅ FIX: schema has reservationAmount, not depositAmount
        else if (sort === "deposit_high_low") sortOptions = { reservationAmount: -1 };

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
   CRM — Get single reservation (unchanged)
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
   CRM — Update reservation (unchanged)
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
   CRM — Assign to sales exec (unchanged)
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
   ============================================================ */
export const confirmReservation = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);

        // ✅ FIX P10: capitalized statuses matching schema enum
        if (reservation.status === "Confirmed")
            return fail(res, "Reservation already confirmed", 400);
        if (["Cancelled", "Expired", "Refunded", "Completed"].includes(reservation.status))
            return fail(res, `Cannot confirm a ${reservation.status} reservation`, 400);

        const paidPayment = await Payment.findOne({
            reservation: reservation._id,
            status: "paid",
        });
        if (!paidPayment) {
            return fail(res, "Cannot confirm — no successful payment found on this reservation", 400);
        }

        if ((reservation.amountPaid || 0) <= 0) {
            return fail(res, "Cannot confirm — no amount paid yet", 400);
        }

        reservation.status = "Confirmed";       // ✅ FIX: capital C
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
   CRM — Extend reservation (unchanged)
   ============================================================ */
export const extendReservation = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);

        const extendableStatuses = ["Active", "Confirmed"];
        if (!extendableStatuses.includes(reservation.status)) {
            return fail(res, `Cannot extend a reservation with status: ${reservation.status}`, 400);
        }

        if (reservation.paymentStatus === "paid") {
            return fail(res, "Reservation is already fully paid and cannot be extended", 400);
        }

        let newExpiry;
        if (req.body.expiresAt) {
            newExpiry = new Date(req.body.expiresAt);
            if (isNaN(newExpiry.getTime())) {
                return fail(res, "Invalid expiresAt date format", 400);
            }
            if (newExpiry <= new Date()) {
                return fail(res, "New expiry date must be in the future", 400);
            }
        } else {
            const holdHours = Number(process.env.RESERVATION_HOLD_HOURS) || 72;
            newExpiry = new Date(Date.now() + holdHours * 60 * 60 * 1000);
        }

        reservation.expiresAt = newExpiry;
        reservation.extendedCount = (reservation.extendedCount || 0) + 1;
        reservation.extendedAt = new Date();
        reservation.updatedBy = req.user._id;

        await reservation.save();
        return ok(res, reservation, `Reservation extended successfully to ${newExpiry.toISOString()}`);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Cancel reservation
   ============================================================ */
export const cancelReservation = async (req, res, next) => {
    try {
        const { cancellationReason, cancellationCategory } = req.body;

        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);

        // ✅ FIX P9: capitalized statuses
        if (["Completed", "Cancelled", "Refunded"].includes(reservation.status))
            return fail(res, `Cannot cancel a ${reservation.status} reservation`, 400);

        reservation.status = "Cancelled";
        reservation.cancelledAt = new Date();
        reservation.cancelledBy = "staff";
        reservation.cancellationReason = cancellationReason || null;
        reservation.cancellationCategory = cancellationCategory || "other";
        reservation.updatedBy = req.user._id;
        await reservation.save();

        /* Free up the vehicle — only if it was actually claimed */
        if (reservation.paymentStatus === "paid" || reservation.paymentStatus === "partial") {
            await Vehicle.findByIdAndUpdate(reservation.vehicle, {
                status: "Available",                // ✅ FIX: capital A
                reservedAt: null,
                updatedBy: req.user._id,
            });
        }

        /* Roll lead back */
        if (reservation.lead) {
            const lead = await Lead.findById(reservation.lead);
            if (lead && lead.status === "Reserved") {   // ✅ FIX: capital R
                lead.status = "Negotiation";            // ✅ FIX: capital N
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
   CRM — Mark as completed (unchanged)
   ============================================================ */
export const completeReservation = async (req, res, next) => {
    try {
        const { convertedToSale } = req.body;

        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);

        reservation.status = "Completed";
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

        // ✅ FIX: capitalized statuses + only free vehicle if it was claimed
        if (["Active", "Confirmed"].includes(reservation.status)) {
            await Vehicle.findByIdAndUpdate(reservation.vehicle, {
                status: "Available",                // ✅ FIX: capital A
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
   CRM — Dashboard stats
   ============================================================ */
export const getReservationStats = async (req, res, next) => {
    try {
        const scopeFilter =
            req.user.role === "sales_executive" ? { assignedTo: req.user._id } : {};

        const [total, active, confirmed, cancelled, completed, expired, byStatus, byPayment] =
            await Promise.all([
                Reservation.countDocuments(scopeFilter),
                // ✅ FIX: "Active" is the schema enum for pending holds
                Reservation.countDocuments({ ...scopeFilter, status: "Active" }),
                Reservation.countDocuments({ ...scopeFilter, status: "Confirmed" }),
                Reservation.countDocuments({ ...scopeFilter, status: "Cancelled" }),
                Reservation.countDocuments({ ...scopeFilter, status: "Completed" }),
                Reservation.countDocuments({ ...scopeFilter, status: "Expired" }),
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
   ============================================================ */
export const requestRefund = async (req, res, next) => {
    try {
        const { inspectionDone = false, reason, customerEmail, customerMessage } = req.body;

        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);

        if (reservation.paymentStatus === "pending") {
            return fail(res, "No payment received on this reservation", 400);
        }
        // ✅ FIX: capitalized statuses
        if (["Cancelled", "Expired", "Refunded"].includes(reservation.status)) {
            return fail(res, `Cannot request refund for a ${reservation.status} reservation`, 400);
        }
        if (reservation.refundRequest) {
            return fail(res, "A refund request already exists for this reservation", 409);
        }

        const scenario = detectRefundScenario({ inspectionDone });
        const autoApprove = shouldAutoApprove(scenario);

        if (scenario === "no_visit_email" && !customerEmail && !customerMessage) {
            return fail(res, "Please provide an email or message explaining your refund request", 400);
        }

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

        await reservation.save();

        await sendNotification({
            recipientType: "staff",
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
   CRM — Review refund request
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

import Razorpay from "razorpay";

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
   ============================================================ */
export const processRefundRequest = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return fail(res, "Reservation not found", 404);
        if (!reservation.refundRequest) {
            return fail(res, "No refund request found", 404);
        }

        const rf = reservation.refundRequest;

        if (!["auto_approved", "approved"].includes(rf.status)) {
            return fail(res, `Cannot process refund with status: ${rf.status}`, 400);
        }

        const payment = await Payment.findOne({
            reservation: reservation._id,
            status: "paid",
        }).sort("-paidAt");

        if (!payment) return fail(res, "No successful payment found for this reservation", 404);
        if (!payment.gatewayPaymentId) {
            return fail(res, "Payment has no Razorpay payment ID", 400);
        }

        const rzp = getRazorpay();
        let rzRefund;
        try {
            rzRefund = await rzp.payments.refund(payment.gatewayPaymentId, {
                amount: Math.round(rf.refundAmount * 100),
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

        rf.status = "processed";
        rf.refundId = rzRefund.id;
        rf.refundMethod = req.body.refundMethod || "original_payment";
        rf.processedAt = new Date();
        rf.processedBy = req.user._id;

        reservation.status = "Refunded";        // ✅ FIX: capital R
        reservation.paymentStatus = "refunded";
        reservation.refundedAt = new Date();
        reservation.updatedBy = req.user._id;
        await reservation.save();

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

        await Vehicle.findByIdAndUpdate(reservation.vehicle, {
            status: "Available",                // ✅ FIX: capital A
            reservedAt: null,
            updatedBy: req.user._id,
        });

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
   Get refund request details (unchanged)
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