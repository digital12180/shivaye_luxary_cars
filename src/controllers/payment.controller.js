import mongoose from "mongoose";
import crypto from "crypto";
import Payment from "../models/Payment.js";
import Reservation from "../models/Reservation.js";
import Customer from "../models/Customer.js";
import Vehicle from "../models/Vehicle.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/leadActivity.js";
import { ok, fail } from "../utils/response.js";
import { sendNotification } from "../services/notification.service.js";

/* ============================================================
   Helpers
   ============================================================ */
const generatePaymentId = () => {
    const year = new Date().getFullYear();
    const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
    return `PAY-${year}-${Date.now().toString().slice(-6)}-${rand}`;
};

const generateInvoiceNumber = async () => {
    const year = new Date().getFullYear();
    const count = await Payment.countDocuments({ status: "paid" });
    return `SLC-REC-${year}-${String(count + 1).padStart(5, "0")}`;
};

/* ============================================================
   PUBLIC — Create payment order (BRD 8.1)
   POST /api/v1/payments/public/create-order
   Body: { reservationId, gateway, idempotencyKey? }
   ============================================================ */
export const createPaymentOrder = async (req, res, next) => {
    try {
        const { reservationId, gateway = "razorpay", idempotencyKey } = req.body;

        if (!reservationId) return fail(res, "reservationId is required", 400);
        if (!["razorpay", "cashfree", "payu", "stripe", "other"].includes(gateway))
            return fail(res, "Unsupported gateway", 400);

        const reservation = await Reservation.findById(reservationId);
        if (!reservation) return fail(res, "Reservation not found", 404);
        if (["cancelled", "expired", "refunded"].includes(reservation.status))
            return fail(res, `Cannot pay for ${reservation.status} reservation`, 400);
        if (reservation.paymentStatus === "paid")
            return fail(res, "Reservation already paid", 409);

        /* Idempotency — return existing payment if same key */
        if (idempotencyKey) {
            const existing = await Payment.findOne({ idempotencyKey });
            if (existing) return ok(res, existing, "Existing payment returned (idempotent)");
        }

        /* Create payment record — gatewayOrderId filled after gateway call */
        const payment = await Payment.create({
            paymentId: generatePaymentId(),
            customer: reservation.customer,
            reservation: reservation._id,
            vehicle: reservation.vehicle,
            paymentType: "reservation",
            amount: reservation.reservationAmount - reservation.amountPaid,
            currency: reservation.currency || "INR",
            gateway,
            status: "initiated",
            idempotencyKey: idempotencyKey || undefined,
            notes: `Reservation ${reservation.reservationNumber}`,
        });

        /* TODO: Call actual gateway SDK here to create order.
           Example (Razorpay):
             const rzOrder = await razorpay.orders.create({...});
             payment.gatewayOrderId = rzOrder.id;
             await payment.save();
        */

        return ok(res, {
            paymentId: payment.paymentId,
            _id: payment._id,
            amount: payment.amount,
            currency: payment.currency,
            gateway,
            gatewayOrderId: payment.gatewayOrderId,
            reservationId: reservation._id,
            reservationNumber: reservation.reservationNumber,
        }, "Payment order created", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
//    PUBLIC — Verify payment (client-side callback)
//    POST /api/v1/payments/public/verify
//    Body: { paymentId, gatewayOrderId, gatewayPaymentId, gatewaySignature }
//    ============================================================ */
// export const verifyPayment = async (req, res, next) => {
//     try {
//         const { paymentId, gatewayOrderId, gatewayPaymentId, gatewaySignature } = req.body;

//         if (!paymentId || !gatewayPaymentId)
//             return fail(res, "paymentId and gatewayPaymentId are required", 400);

//         const payment = await Payment.findOne({ paymentId });
//         if (!payment) return fail(res, "Payment not found", 404);
//         if (payment.status === "paid")
//             return ok(res, payment, "Payment already verified");

//         /* TODO: Verify signature using gateway secret.
//            Example (Razorpay):
//              const body = `${gatewayOrderId}|${gatewayPaymentId}`;
//              const expected = crypto
//                .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
//                .update(body)
//                .digest("hex");
//              if (expected !== gatewaySignature)
//                return fail(res, "Invalid signature", 400);
//         */

//         payment.gatewayOrderId = gatewayOrderId || payment.gatewayOrderId;
//         payment.gatewayPaymentId = gatewayPaymentId;
//         payment.gatewaySignature = gatewaySignature;
//         payment.status = "paid";
//         payment.paidAt = new Date();
//         payment.signatureVerified = true;
//         payment.invoiceNumber = await generateInvoiceNumber();
//         await payment.save();

//         /* --- Side effects --- */
//         await handleSuccessfulPayment(payment);
//         if (payment.customer) {
//             const customer = await Customer.findById(payment.customer);
//             if (customer) {
//                 await sendNotification({
//                     recipientType: "customer",
//                     customerId: payment.customer,
//                     to: customer.phone,
//                     channel: "sms",
//                     type: "payment_failed",
//                     title: "Payment failed",
//                     body: `Your payment failed. Reason: ${payment.failureReason || "Unknown"}. Please retry.`,
//                     relatedTo: { payment: payment._id },
//                     priority: "high",
//                 });

//                 await sendNotification({
//                     recipientType: "customer",
//                     customerId: payment.customer,
//                     to: customer.phone,
//                     channel: "whatsapp",
//                     type: "payment_success",
//                     title: "Payment received",
//                     body: `Payment of ₹${payment.amount} received. Invoice: ${payment.invoiceNumber}`,
//                     relatedTo: { payment: payment._id, reservation: payment.reservation },
//                 });

//                 return ok(res, payment, "Payment verified");
//             } catch (err) {
//                 next(err);
//             }
//         };

        /* ============================================================
           WEBHOOK — Gateway server-to-server
           POST /api/v1/payments/webhook/:gateway
           NOTE: Mount with express.raw() so signature verification works
           ============================================================ */
        export const webhookHandler = async (req, res, next) => {
            try {
                const { gateway } = req.params;

                /* TODO: Verify webhook signature using gateway secret (BRD 19)
                   Example (Razorpay):
                     const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
                     const expected = crypto
                       .createHmac("sha256", secret)
                       .update(req.body) // raw body
                       .digest("hex");
                     if (expected !== req.headers["x-razorpay-signature"])
                       return res.status(400).send("Invalid signature");
                */

                const event = JSON.parse(req.body.toString());
                const eventType = event.event;
                const payload = event.payload?.payment?.entity;

                if (!payload?.order_id) return res.status(200).send("No order id");

                const payment = await Payment.findOne({
                    gatewayOrderId: payload.order_id,
                    gateway,
                });
                if (!payment) return res.status(200).send("Payment not found");

                payment.webhookReceivedAt = new Date();

                if (eventType === "payment.captured") {
                    payment.gatewayPaymentId = payload.id;
                    payment.paymentMethod = payload.method || payment.paymentMethod;
                    payment.methodDetails = {
                        type: payload.method,
                        bank: payload.bank || null,
                        wallet: payload.wallet || null,
                        cardLast4: payload.card?.last4 || null,
                        vpa: payload.vpa || null,
                        network: payload.card?.network || null,
                    };
                    payment.gatewayFee = (payload.fee || 0) / 100;
                    payment.status = "paid";
                    payment.paidAt = new Date();
                    payment.signatureVerified = true;
                    if (!payment.invoiceNumber)
                        payment.invoiceNumber = await generateInvoiceNumber();
                    await payment.save();

                    await handleSuccessfulPayment(payment);
                } else if (eventType === "payment.failed") {
                    payment.status = "failed";
                    payment.failedAt = new Date();
                    payment.failureReason = payload.error_description || "Payment failed";
                    payment.failureCode = payload.error_code || null;
                    await payment.save();

                    await handleFailedPayment(payment);
                }

                // Always ACK webhook
                return res.status(200).json({ received: true });
            } catch (err) {
                // Still ACK to avoid retries (log error separately)
                console.error("Webhook error:", err.message);
                return res.status(200).json({ received: true, error: err.message });
            }
        };

        /* ============================================================
           INTERNAL — side effects on successful payment
           ============================================================ */
        const handleSuccessfulPayment = async (payment) => {
            /* Reservation update */
            if (payment.reservation) {
                const reservation = await Reservation.findById(payment.reservation);
                if (reservation) {
                    reservation.amountPaid = (reservation.amountPaid || 0) + payment.amount;
                    reservation.amountDue = Math.max(
                        0,
                        reservation.reservationAmount - reservation.amountPaid
                    );
                    reservation.paymentStatus =
                        reservation.amountDue === 0 ? "paid" : "partial";
                    reservation.status = "confirmed";
                    reservation.confirmedAt = new Date();
                    reservation.payment = payment._id;
                    await reservation.save();

                    /* Vehicle stays reserved */
                    await Vehicle.findByIdAndUpdate(reservation.vehicle, {
                        status: "reserved",
                    });

                    /* Lead activity */
                    if (reservation.lead) {
                        await LeadActivity.create({
                            lead: reservation.lead,
                            customer: reservation.customer,
                            type: "payment",
                            title: "Reservation payment received",
                            description: `Amount: ₹${payment.amount} (${payment.paymentId})`,
                            meta: { paymentId: payment._id, amount: payment.amount },
                        });

                        await Lead.findByIdAndUpdate(reservation.lead, {
                            status: "booked",
                        });
                    }
                }
            }

            /* Sale update (if linked) */
            if (payment.sale) {
                // Sale model's payment tracking is done via PATCH /sales/:id/payment.
                // Auto-sync here if you want: update amountPaid on the sale.
            }
        };

        /* ============================================================
           INTERNAL — side effects on failed payment
           ============================================================ */
        const handleFailedPayment = async (payment) => {
            if (payment.reservation) {
                await LeadActivity.create({
                    lead: null,
                    customer: payment.customer,
                    type: "payment",
                    title: "Payment failed",
                    description: payment.failureReason || "Payment failed",
                    meta: { paymentId: payment._id },
                }).catch(() => { });
            }
        };

        /* ============================================================
           CRM — List payments
           ============================================================ */
        export const listPayments = async (req, res, next) => {
            try {
                const page = Number(req.query.page) || 1;
                const limit = Number(req.query.limit) || 20;
                const {
                    status, gateway, paymentType, customer, reservation,
                    fromDate, toDate, search,
                } = req.query;

                const filter = {};
                if (status) filter.status = status;
                if (gateway) filter.gateway = gateway;
                if (paymentType) filter.paymentType = paymentType;
                if (customer) filter.customer = customer;
                if (reservation) filter.reservation = reservation;

                if (fromDate || toDate) {
                    filter.createdAt = {};
                    if (fromDate) filter.createdAt.$gte = new Date(fromDate);
                    if (toDate) filter.createdAt.$lte = new Date(toDate);
                }

                if (search) {
                    filter.$or = [
                        { paymentId: new RegExp(search, "i") },
                        { invoiceNumber: new RegExp(search, "i") },
                        { gatewayOrderId: new RegExp(search, "i") },
                        { gatewayPaymentId: new RegExp(search, "i") },
                    ];
                }

                const [data, total] = await Promise.all([
                    Payment.find(filter)
                        .populate("customer", "name phone email city")
                        .populate("reservation", "reservationNumber status")
                        .populate("vehicle", "stockId brand model year")
                        .sort("-createdAt")
                        .skip((page - 1) * limit)
                        .limit(limit),
                    Payment.countDocuments(filter),
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
           CRM — Get single payment
           ============================================================ */
        export const getPayment = async (req, res, next) => {
            try {
                const payment = await Payment.findById(req.params.id)
                    .populate("customer", "name phone email city")
                    .populate("reservation", "reservationNumber status paymentStatus")
                    .populate("vehicle", "stockId brand model year")
                    .populate("sale", "invoiceNumber pricing saleDate")
                    .populate("createdBy", "name")
                    .populate("updatedBy", "name");

                if (!payment) return fail(res, "Payment not found", 404);
                return ok(res, payment);
            } catch (err) {
                next(err);
            }
        };

        /* ============================================================
           CRM — Refund
           PATCH /api/v1/payments/:id/refund
           Body: { amount, reason }
           ============================================================ */
        export const refundPayment = async (req, res, next) => {
            try {
                const { amount, reason } = req.body;
                if (!amount || amount <= 0)
                    return fail(res, "Valid refund amount is required", 400);

                const payment = await Payment.findById(req.params.id);
                if (!payment) return fail(res, "Payment not found", 404);
                if (payment.status !== "paid")
                    return fail(res, "Only paid payments can be refunded", 400);
                if (amount > payment.amount)
                    return fail(res, "Refund amount cannot exceed paid amount", 400);

                /* TODO: Call gateway refund API here
                   Example (Razorpay):
                     const refund = await razorpay.payments.refund(payment.gatewayPaymentId, {
                       amount: amount * 100,
                       notes: { reason },
                     });
                */

                payment.refund = {
                    refundId: `REF-${Date.now()}`,
                    amount,
                    reason: reason || "Refund requested",
                    status: "processed",
                    initiatedAt: new Date(),
                    processedAt: new Date(),
                    initiatedBy: req.user._id,
                };
                payment.status = amount === payment.amount ? "refunded" : "paid";
                payment.refundedAt = new Date();
                payment.updatedBy = req.user._id;
                await payment.save();

                /* Cascade to reservation */
                if (payment.reservation && amount === payment.amount) {
                    const reservation = await Reservation.findById(payment.reservation);
                    if (reservation) {
                        reservation.status = "refunded";
                        reservation.paymentStatus = "refunded";
                        reservation.refundedAt = new Date();
                        await reservation.save();

                        await Vehicle.findByIdAndUpdate(reservation.vehicle, {
                            status: "available",
                            reservedAt: null,
                        });
                    }
                }

                return ok(res, payment, "Refund processed");
            } catch (err) {
                next(err);
            }
        };

        /* ============================================================
           CRM — Dashboard stats
           ============================================================ */
        export const getPaymentStats = async (req, res, next) => {
            try {
                const [total, paid, pending, failed, refunded, revenueAgg, byGateway, byType] =
                    await Promise.all([
                        Payment.countDocuments(),
                        Payment.countDocuments({ status: "paid" }),
                        Payment.countDocuments({ status: { $in: ["initiated", "pending"] } }),
                        Payment.countDocuments({ status: "failed" }),
                        Payment.countDocuments({ status: "refunded" }),
                        Payment.aggregate([
                            { $match: { status: "paid" } },
                            { $group: { _id: null, sum: { $sum: "$amount" }, net: { $sum: "$netAmount" } } },
                        ]),
                        Payment.aggregate([
                            { $match: { status: "paid" } },
                            { $group: { _id: "$gateway", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
                        ]),
                        Payment.aggregate([
                            { $match: { status: "paid" } },
                            { $group: { _id: "$paymentType", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
                        ]),
                    ]);

                return ok(res, {
                    total,
                    paid,
                    pending,
                    failed,
                    refunded,
                    totalCollected: revenueAgg[0]?.sum || 0,
                    totalNet: revenueAgg[0]?.net || 0,
                    byGateway,
                    byType,
                });
            } catch (err) {
                next(err);
            }
        }