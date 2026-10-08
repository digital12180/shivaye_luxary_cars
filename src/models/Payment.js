import mongoose from "mongoose";

const methodDetailsSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true },              // upi, card, netbanking, wallet
    bank: { type: String, trim: true },
    wallet: { type: String, trim: true },
    cardLast4: { type: String, trim: true },
    upiId: { type: String, trim: true },
    vpa: { type: String, trim: true },
    network: { type: String, trim: true },           // visa, mastercard, rupay
  },
  { _id: false }
);

const refundSchema = new mongoose.Schema(
  {
    refundId: { type: String, trim: true },
    amount: { type: Number, min: 0, default: 0 },
    reason: { type: String, trim: true },
    status: {
      type: String,
      enum: ["pending", "processed", "failed", null],
      default: null,
    },
    initiatedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    /* ============ Identifiers ============ */
    paymentId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    invoiceNumber: { type: String, trim: true, index: true, sparse: true },

    idempotencyKey: { type: String, unique: true, sparse: true, index: true },

    /* ============ References ============ */
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      default: null,
      index: true,
    },

    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },

    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sale",
      default: null,
      index: true,
    },

    /* ============ Payment Type (BRD 8.2) ============ */
    paymentType: {
      type: String,
      enum: ["reservation", "booking", "full_payment", "refund", "other"],
      default: "reservation",
      index: true,
    },

    /* ============ Amount ============ */
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },

    gatewayFee: { type: Number, default: 0, min: 0 },
    netAmount: { type: Number, default: 0, min: 0 },

    /* ============ Gateway ============ */
    gateway: {
      type: String,
      enum: ["razorpay", "cashfree", "payu", "stripe", "other"],
      required: true,
      index: true,
    },

    gatewayOrderId: { type: String, default: null, trim: true, index: true },
    gatewayPaymentId: { type: String, default: null, trim: true },
    gatewaySignature: { type: String, default: null },

    /* ============ Status (BRD 8.2) ============ */
    status: {
      type: String,
      enum: ["initiated", "pending", "paid", "failed", "cancelled", "refunded"],
      default: "initiated",
      index: true,
    },

    /* ============ Method ============ */
    paymentMethod: { type: String, default: null, trim: true },
    methodDetails: { type: methodDetailsSchema, default: null },

    /* ============ Failure ============ */
    failureReason: { type: String, default: null, trim: true },
    failureCode: { type: String, default: null, trim: true },

    /* ============ Timestamps ============ */
    paidAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    webhookReceivedAt: { type: Date, default: null },

    /* ============ Refund ============ */
    refund: { type: refundSchema, default: null },

    /* ============ Security & Receipts ============ */
    signatureVerified: { type: Boolean, default: false },
    receiptUrl: { type: String, default: null },

    /* ============ Notes ============ */
    notes: { type: String, trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    /* ============ Audit ============ */
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/* ============ Indexes ============ */
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ customer: 1, status: 1 });
paymentSchema.index({ reservation: 1, status: 1 });
paymentSchema.index({ gatewayOrderId: 1, gateway: 1 });

/* Soft delete */
paymentSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

/* Auto net amount */
paymentSchema.pre("save", function (next) {
  this.netAmount = Math.max(0, (this.amount || 0) - (this.gatewayFee || 0));
  next();
});

export default mongoose.model("Payment", paymentSchema);