import mongoose from "mongoose";
import crypto from "crypto";
import Razorpay from "razorpay";
import Payment from "../models/Payment.js";
import Reservation from "../models/Reservation.js";
import Vehicle from "../models/Vehicle.js";
import Customer from "../models/Customer.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/leadActivity.js";
import { ok, fail } from "../utils/response.js";
import { sendNotification } from "../services/notification.service.js"
/* ============================================================
   Razorpay client (lazy init)
   ============================================================ */
let razorpayClient = null;
const getRazorpay = () => {
  if (!razorpayClient) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error("Razorpay keys not configured");
    }
    razorpayClient = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayClient;
};

/* ============================================================
   Helpers
   ============================================================ */
const generatePaymentId = () => {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `PAY-${year}-${Date.now().toString().slice(-6)}-${rand}`;
};

const generateReceiptNumber = async () => {
  const year = new Date().getFullYear();
  const count = await Payment.countDocuments({ status: "paid" });
  return `SLC-REC-${year}-${String(count + 1).padStart(5, "0")}`;
};

/* ============================================================
   Side effects — on successful payment
   BRD 8.2 + Section 13 (Notifications)
   ============================================================ */
const handleSuccessfulPayment = async (payment) => {
  if (!payment.reservation) return;

  const reservation = await Reservation.findById(payment.reservation);
  if (!reservation) return;

  // Update reservation money state
  reservation.amountPaid = (reservation.amountPaid || 0) + payment.amount;
  reservation.amountDue = Math.max(
    0,
    reservation.reservationAmount - reservation.amountPaid
  );
  reservation.paymentStatus = reservation.amountDue === 0 ? "paid" : "partial";
  reservation.status = "confirmed";
  reservation.confirmedAt = new Date();
  reservation.payment = payment._id;
  await reservation.save();

  // Vehicle stays reserved
  await Vehicle.findByIdAndUpdate(reservation.vehicle, {
    status: "reserved",
  });

  // Lead → booked + activity log
  if (reservation.lead) {
    await LeadActivity.create({
      lead: reservation.lead,
      customer: reservation.customer,
      type: "payment",
      title: "Reservation payment received",
      description: `Amount: ₹${payment.amount} (${payment.paymentId})`,
      meta: { paymentId: payment._id, amount: payment.amount },
    });

    await Lead.findByIdAndUpdate(reservation.lead, { status: "booked" });
  }

  // WhatsApp + SMS notification to customer (BRD 13)
  try {
    const customer = await Customer.findById(payment.customer);
    if (customer) {
      await sendNotification({
        recipientType: "customer",
        customerId: customer._id,
        to: customer.phone,
        channel: "whatsapp",
        type: "payment_success",
        title: "Payment received",
        body: `Thank you ${customer.name}. We have received ₹${payment.amount} for reservation ${reservation.reservationNumber}. Invoice: ${payment.invoiceNumber || "-"}`,
        template: {
          name: "payment_received",
          language: "en",
          variables: {
            name: customer.name,
            amount: payment.amount,
            reservationNumber: reservation.reservationNumber,
          },
        },
        relatedTo: {
          payment: payment._id,
          reservation: reservation._id,
          vehicle: reservation.vehicle,
        },
      });
    }
  } catch (err) {
    console.error("Notification failed:", err.message);
  }
};

/* ============================================================
   Side effects — on failed payment
   ============================================================ */
const handleFailedPayment = async (payment) => {
  if (!payment.reservation) return;

  const reservation = await Reservation.findById(payment.reservation);
  if (!reservation) return;

  // Do NOT cancel the reservation on first failure.
  // Reservation auto-expires via cron if unpaid (BRD 8.1).
  try {
    const customer = await Customer.findById(payment.customer);
    if (customer) {
      await sendNotification({
        recipientType: "customer",
        customerId: customer._id,
        to: customer.phone,
        channel: "sms",
        type: "payment_failed",
        title: "Payment failed",
        body: `Your payment of ₹${payment.amount} could not be processed. Please retry to confirm reservation ${reservation.reservationNumber}.`,
        relatedTo: { payment: payment._id, reservation: reservation._id },
      });
    }
  } catch (err) {
    console.error("Notification failed:", err.message);
  }
};

/* ============================================================
   PUBLIC — Create Razorpay order for a reservation
   POST /api/v1/payments/public/create-order
   Body: { reservationId, idempotencyKey? }
   ============================================================ */
export const createPaymentOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  let transactionCommitted = false;

  try {
    const { reservationId, idempotencyKey } = req.body;

    if (!reservationId) {
      await session.abortTransaction();
      return fail(res, "reservationId is required", 400);
    }

    // Idempotency — if same key exists, return existing payment
    if (idempotencyKey) {
      const existing = await Payment.findOne({ idempotencyKey }).session(session);
      if (existing) {
        await session.commitTransaction();
        transactionCommitted = true;
        return ok(res, {
          paymentId: existing.paymentId,
          orderId: existing.gatewayOrderId,
          amount: existing.amount,
          currency: existing.currency,
          gateway: existing.gateway,
          key: process.env.RAZORPAY_KEY_ID,
          reservationId,
        }, "Existing payment order returned");
      }
    }

    // Fetch reservation
    const reservation = await Reservation.findById(reservationId).session(session);
    if (!reservation) throw new Error("Reservation not found");

    if (["cancelled", "expired", "refunded", "completed"].includes(reservation.status)) {
      throw new Error(`Cannot pay for a ${reservation.status} reservation`);
    }

    if (reservation.paymentStatus === "paid") {
      throw new Error("Reservation already paid");
    }

    if (reservation.expiresAt && reservation.expiresAt < new Date()) {
      throw new Error("Reservation hold expired. Please reserve again.");
    }

    const payableAmount = Math.max(0, reservation.reservationAmount - (reservation.amountPaid || 0));
    if (payableAmount <= 0) {
      throw new Error("Nothing due on this reservation");
    }

    // Create Razorpay order
    const rzp = getRazorpay();
    const receipt = `rcpt_${Date.now()}_${reservation.reservationNumber}`;

    const rzOrder = await rzp.orders.create({
      amount: Math.round(payableAmount * 100), // paise
      currency: reservation.currency || "INR",
      receipt,
      notes: {
        reservationId: String(reservation._id),
        reservationNumber: reservation.reservationNumber,
        customerId: String(reservation.customer),
        vehicleId: String(reservation.vehicle),
      },
    });

    // Save payment record
    const [payment] = await Payment.create([{
      paymentId: generatePaymentId(),
      customer: reservation.customer,
      reservation: reservation._id,
      vehicle: reservation.vehicle,
      paymentType: "reservation",
      amount: payableAmount,
      currency: reservation.currency || "INR",
      gateway: "razorpay",
      gatewayOrderId: rzOrder.id,
      status: "initiated",
      idempotencyKey: idempotencyKey || undefined,
      providerResponse: rzOrder,
      notes: `Reservation ${reservation.reservationNumber}`,
    }], { session });

    // Link payment on reservation (first attempt)
    if (!reservation.payment) {
      reservation.payment = payment._id;
      await reservation.save({ session });
    }

    await session.commitTransaction();
    transactionCommitted = true;

    return ok(res, {
      paymentId: payment.paymentId,
      _id: payment._id,
      orderId: rzOrder.id,          // ← frontend passes this to Razorpay checkout
      amount: payment.amount,
      currency: payment.currency,
      gateway: "razorpay",
      key: process.env.RAZORPAY_KEY_ID,
      reservationId: reservation._id,
      reservationNumber: reservation.reservationNumber,
    }, "Payment order created", 201);

  } catch (err) {
    if (!transactionCommitted && session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Create payment order error:", err.message);
    return fail(res, err.message || "Failed to create payment order", 400);
  } finally {
    await session.endSession();
  }
};

/* ============================================================
   PUBLIC — Verify payment (client callback)
   POST /api/v1/payments/public/verify
   Body: { paymentId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
   ============================================================ */
export const verifyPayment = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  let transactionCommitted = false;

  try {
    const {
      paymentId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!paymentId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error("All payment fields are required");
    }

    const payment = await Payment.findOne({ paymentId }).session(session);
    if (!payment) throw new Error("Payment record not found");

    // Idempotent — if already verified, return
    if (payment.status === "paid") {
      await session.commitTransaction();
      transactionCommitted = true;
      return ok(res, {
        paymentId: payment.paymentId,
        reservationId: payment.reservation,
        status: payment.status,
        invoiceNumber: payment.invoiceNumber,
      }, "Payment already verified");
    }

    if (payment.gatewayOrderId !== razorpay_order_id) {
      throw new Error("Order ID mismatch");
    }

    // Verify signature
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      payment.status = "failed";
      payment.failedAt = new Date();
      payment.failureReason = "Invalid payment signature";
      await payment.save({ session });
      throw new Error("Invalid payment signature");
    }

    // Fetch payment from Razorpay to validate amount
    const rzp = getRazorpay();
    const rzPayment = await rzp.payments.fetch(razorpay_payment_id);

    if (Number(rzPayment.amount) !== Math.round(payment.amount * 100)) {
      throw new Error(
        `Amount mismatch. Expected ₹${payment.amount}, received ₹${rzPayment.amount / 100}`
      );
    }

    // Update payment record
    payment.gatewayPaymentId = razorpay_payment_id;
    payment.gatewaySignature = razorpay_signature;
    payment.status = "paid";
    payment.paidAt = new Date();
    payment.signatureVerified = true;
    payment.paymentMethod = rzPayment.method || null;
    payment.methodDetails = {
      type: rzPayment.method,
      bank: rzPayment.bank || null,
      wallet: rzPayment.wallet || null,
      cardLast4: rzPayment.card?.last4 || null,
      vpa: rzPayment.vpa || null,
      network: rzPayment.card?.network || null,
    };
    payment.gatewayFee = (rzPayment.fee || 0) / 100;
    payment.invoiceNumber = await generateReceiptNumber();
    payment.providerResponse = rzPayment;
    await payment.save({ session });

    // Side effects
    await handleSuccessfulPayment(payment);

    await session.commitTransaction();
    transactionCommitted = true;

    return ok(res, {
      paymentId: payment.paymentId,
      reservationId: payment.reservation,
      amount: payment.amount,
      status: payment.status,
      invoiceNumber: payment.invoiceNumber,
    }, "Payment verified successfully");

  } catch (err) {
    if (!transactionCommitted && session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Verify payment error:", err.message);
    return fail(res, err.message || "Payment verification failed", 400);
  } finally {
    await session.endSession();
  }
};

/* ============================================================
   PUBLIC — Report payment failure (client-side cancel)
   POST /api/v1/payments/public/failed
   Body: { paymentId, reason? }
   ============================================================ */
export const reportPaymentFailure = async (req, res, next) => {
  try {
    const { paymentId, reason } = req.body;
    if (!paymentId) return fail(res, "paymentId is required", 400);

    const payment = await Payment.findOne({ paymentId });
    if (!payment) return fail(res, "Payment not found", 404);

    if (payment.status === "paid") {
      return ok(res, { status: payment.status }, "Payment already completed");
    }

    payment.status = "failed";
    payment.failedAt = new Date();
    payment.failureReason = reason || "Payment failed or cancelled by user";
    await payment.save();

    await handleFailedPayment(payment);

    return ok(res, { paymentId: payment.paymentId, status: payment.status }, "Payment marked as failed");
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   WEBHOOK — Razorpay server-to-server
   POST /api/v1/payments/webhook/razorpay
   NOTE: mount with express.raw() BEFORE express.json()
   ============================================================ */
export const razorpayWebhook = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (!webhookSecret || !signature) {
      return res.status(400).json({ success: false, error: "Missing signature" });
    }

    // Verify signature against RAW body
    const rawBody = req.body.toString();
    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (expected !== signature) {
      console.error("Invalid webhook signature");
      return res.status(401).json({ success: false, error: "Invalid signature" });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.event;
    const payload = event.payload?.payment?.entity;

    if (!payload?.order_id) {
      return res.status(200).json({ received: true, reason: "no order id" });
    }

    session.startTransaction();

    const payment = await Payment.findOne({
      gatewayOrderId: payload.order_id,
      gateway: "razorpay",
    }).session(session);

    if (!payment) {
      await session.abortTransaction();
      await session.endSession();
      return res.status(200).json({ received: true, reason: "payment not found" });
    }

    payment.webhookReceivedAt = new Date();

    if (eventType === "payment.captured" || eventType === "payment.authorized") {
      if (payment.status !== "paid") {
        payment.gatewayPaymentId = payload.id;
        payment.paymentMethod = payload.method || null;
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
        if (!payment.invoiceNumber) {
          payment.invoiceNumber = await generateReceiptNumber();
        }
        payment.providerResponse = payload;
        await payment.save({ session });

        await handleSuccessfulPayment(payment);
      }
    } else if (eventType === "payment.failed") {
      if (payment.status !== "paid") {
        payment.status = "failed";
        payment.failedAt = new Date();
        payment.failureReason = payload.error_description || "Payment failed";
        payment.failureCode = payload.error_code || null;
        payment.providerResponse = payload;
        await payment.save({ session });

        await handleFailedPayment(payment);
      }
    } else if (eventType === "refund.processed") {
      // Only update if this payment already has a refund object
      if (payment.refund) {
        payment.refund.status = "processed";
        payment.refund.processedAt = new Date();
        payment.status = "refunded";
        payment.refundedAt = new Date();
        await payment.save({ session });
      }
    }

    await session.commitTransaction();
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("Webhook error:", err.message);
    if (session.inTransaction()) await session.abortTransaction();
    // Always ACK so Razorpay doesn't retry infinitely
    return res.status(200).json({ received: true, error: err.message });
  } finally {
    await session.endSession();
  }
};

/* ============================================================
   CRM — List payments
   GET /api/v1/payments
   ============================================================ */
export const listPayments = async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const { status, gateway, paymentType, customer, reservation, fromDate, toDate, search } = req.query;

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
   CRM — Refund a payment (BRD 8.2)
   PATCH /api/v1/payments/:id/refund
   Body: { amount, reason }
   ============================================================ */
export const refundPayment = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  let transactionCommitted = false;

  try {
    const { amount, reason } = req.body;
    if (!amount || amount <= 0) throw new Error("Valid refund amount is required");

    const payment = await Payment.findById(req.params.id).session(session);
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "paid") throw new Error("Only paid payments can be refunded");
    if (amount > payment.amount) throw new Error("Refund cannot exceed paid amount");

    // Idempotent — block double refunds
    if (payment.refund && payment.refund.status === "processed") {
      throw new Error("Refund already processed for this payment");
    }

    // Call Razorpay refund API
    const rzp = getRazorpay();
    const rzRefund = await rzp.payments.refund(payment.gatewayPaymentId, {
      amount: Math.round(amount * 100),
      notes: {
        reason: reason || "Refund requested",
        paymentId: payment.paymentId,
      },
    });

    payment.refund = {
      refundId: rzRefund.id,
      amount,
      reason: reason || "Refund requested",
      status: rzRefund.status === "processed" ? "processed" : "pending",
      initiatedAt: new Date(),
      processedAt: rzRefund.status === "processed" ? new Date() : null,
      initiatedBy: req.user._id,
    };

    if (amount === payment.amount) {
      payment.status = "refunded";
      payment.refundedAt = new Date();
    }
    payment.updatedBy = req.user._id;
    await payment.save({ session });

    // Cascade to reservation
    if (payment.reservation && amount === payment.amount) {
      const reservation = await Reservation.findById(payment.reservation).session(session);
      if (reservation) {
        reservation.status = "refunded";
        reservation.paymentStatus = "refunded";
        reservation.refundedAt = new Date();
        reservation.updatedBy = req.user._id;
        await reservation.save({ session });

        await Vehicle.findByIdAndUpdate(reservation.vehicle, {
          status: "available",
          reservedAt: null,
          updatedBy: req.user._id,
        }, { session });
      }
    }

    await session.commitTransaction();
    transactionCommitted = true;

    // Notify customer
    try {
      const customer = await Customer.findById(payment.customer);
      if (customer) {
        await sendNotification({
          recipientType: "customer",
          customerId: customer._id,
          to: customer.phone,
          channel: "whatsapp",
          type: "payment_refund",
          title: "Refund processed",
          body: `Your refund of ₹${amount} has been initiated. It will reflect in 3-5 business days.`,
          relatedTo: { payment: payment._id },
        });
      }
    } catch (err) {
      console.error("Refund notification failed:", err.message);
    }

    return ok(res, payment, "Refund processed");

  } catch (err) {
    if (!transactionCommitted && session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Refund error:", err.message);
    return fail(res, err.message || "Refund failed", 400);
  } finally {
    await session.endSession();
  }
};

/* ============================================================
   CRM — Retry a failed payment (creates new Razorpay order)
   POST /api/v1/payments/:id/retry
   ============================================================ */
export const retryPayment = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return fail(res, "Payment not found", 404);
    if (payment.status !== "failed") return fail(res, "Only failed payments can be retried", 400);

    const retryCount = (payment.retryCount || 0) + 1;
    const maxRetries = Number(process.env.MAX_PAYMENT_RETRIES) || 3;
    if (retryCount > maxRetries) return fail(res, `Maximum retry attempts (${maxRetries}) reached`, 400);

    // Fetch reservation
    const reservation = await Reservation.findById(payment.reservation);
    if (!reservation) return fail(res, "Reservation not found", 404);
    if (["cancelled", "expired", "refunded"].includes(reservation.status)) {
      return fail(res, `Reservation is ${reservation.status}`, 400);
    }

    const payableAmount = Math.max(0, reservation.reservationAmount - (reservation.amountPaid || 0));
    if (payableAmount <= 0) return fail(res, "Nothing due on this reservation", 400);

    // New Razorpay order
    const rzp = getRazorpay();
    const rzOrder = await rzp.orders.create({
      amount: Math.round(payableAmount * 100),
      currency: reservation.currency || "INR",
      receipt: `retry_${Date.now()}_${reservation.reservationNumber}`,
      notes: {
        reservationId: String(reservation._id),
        reservationNumber: reservation.reservationNumber,
        isRetry: "true",
        retryCount,
      },
    });

    // Create new payment record (don't reuse failed one — keeps audit trail clean)
    const newPayment = await Payment.create({
      paymentId: generatePaymentId(),
      customer: payment.customer,
      reservation: payment.reservation,
      vehicle: payment.vehicle,
      paymentType: payment.paymentType,
      amount: payableAmount,
      currency: reservation.currency || "INR",
      gateway: "razorpay",
      gatewayOrderId: rzOrder.id,
      status: "initiated",
      retryCount,
      notes: `Retry #${retryCount} for reservation ${reservation.reservationNumber}`,
    });

    return ok(res, {
      paymentId: newPayment.paymentId,
      orderId: rzOrder.id,
      amount: payableAmount,
      currency: reservation.currency,
      gateway: "razorpay",
      key: process.env.RAZORPAY_KEY_ID,
      retryCount,
    }, "Retry payment order created", 201);

  } catch (err) {
    console.error("Retry error:", err.message);
    return fail(res, err.message || "Retry failed", 400);
  }
};

/* ============================================================
   CRM — Payment dashboard stats (BRD 15 / 34.1)
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
};

/* ============================================================
   CRON HELPER — Expire reservations past hold window
   Called by a cron job (not HTTP)
   ============================================================ */
export const expireStaleReservations = async () => {
  const now = new Date();

  const stale = await Reservation.find({
    status: { $in: ["initiated", "pending"] },
    paymentStatus: { $in: ["pending", "partial"] },
    expiresAt: { $lt: now },
  }).limit(50);

  let count = 0;
  for (const res of stale) {
    res.status = "expired";
    res.cancelledAt = now;
    res.cancelledBy = "system";
    res.cancellationReason = "Hold period expired";
    res.cancellationCategory = "expired";
    await res.save();

    await Vehicle.findByIdAndUpdate(res.vehicle, {
      status: "available",
      reservedAt: null,
    });

    if (res.lead) {
      await Lead.findByIdAndUpdate(res.lead, { status: "negotiation" });
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