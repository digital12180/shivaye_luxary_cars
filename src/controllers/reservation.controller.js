import mongoose from "mongoose";
import cron from "node-cron";
import Reservation from "../models/Reservation.js";
import Vehicle from "../models/Vehicle.js";
import Customer from "../models/Customer.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/leadActivity.js";
import Payment from "../models/Payment.js";
import Campaign from "../models/Campaign.js";
import { ok, fail } from "../utils/response.js";
import { sendNotification } from "../services/notification.service.js";
import { extractAttribution } from "../services/attribution.service.js";


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
   Helper — generate reservation number
   ============================================================ */
const generateReservationNumber = async () => {
    const year = new Date().getFullYear();
    const count = await Reservation.countDocuments();
    return `RSV-${year}-${String(count + 1).padStart(5, "0")}`;
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

/* ============================================================
   CRM — List reservations
   GET /api/v1/reservations
   ============================================================ */
export const listReservations = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const {
            status, paymentStatus, assignedTo, customer, vehicle,
            fromDate, toDate, expiringSoon,
        } = req.query;

        const filter = {};

        if (req.user.role === "sales_executive") {
            filter.assignedTo = req.user._id;
        } else if (assignedTo) {
            filter.assignedTo = assignedTo;
        }

        if (status) filter.status = status;
        if (paymentStatus) filter.paymentStatus = paymentStatus;
        if (customer) filter.customer = customer;
        if (vehicle) filter.vehicle = vehicle;

        if (fromDate || toDate) {
            filter.createdAt = {};
            if (fromDate) filter.createdAt.$gte = new Date(fromDate);
            if (toDate) filter.createdAt.$lte = new Date(toDate);
        }

        if (expiringSoon === "true") {
            const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
            filter.expiresAt = { $lte: in24h, $gte: new Date() };
            filter.status = { $in: ["initiated", "pending"] };
        }

        const [data, total] = await Promise.all([
            Reservation.find(filter)
                .populate("customer", "name phone email city")
                .populate("vehicle", "stockId brand model year price images slug status")
                .populate("lead", "status source")
                .populate("assignedTo", "name email role")
                .populate("payment", "status gateway amount")
                .sort("-createdAt")
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

        // ✅ Sahi version
        const customer = await Customer.findById(reservation.customer);
        if (customer) {
            await sendNotification({
                recipientType: "customer",
                customerId: customer._id,
                to: customer.phone,
                channel: "whatsapp",
                type: "reservation_confirmed",
                title: "Reservation confirmed",
                body: `Your reservation ${reservation.reservationNumber} is confirmed. Thank you!`,
                template: {
                    name: "reservation_confirmed",
                    language: "en",
                    variables: { reservationNumber: reservation.reservationNumber },
                },
                relatedTo: { reservation: reservation._id, vehicle: reservation.vehicle },
                actionUrl: `/customer/reservations/${reservation._id}`,
            });
        }
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