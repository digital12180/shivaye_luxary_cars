import mongoose from "mongoose";

const refundRequestSchema = new mongoose.Schema(
    {
        requestedBy: { type: String, enum: ["customer", "staff", "system"], required: true },
        requestedAt: { type: Date, default: Date.now },
        scenario: { type: String, enum: ["physical_inspection", "no_visit_email"], required: true },
        reason: { type: String, trim: true },
        customerEmail: { type: String, trim: true },
        customerMessage: { type: String, trim: true },
        status: {
            type: String,
            enum: ["auto_approved", "pending_review", "approved", "rejected", "processed"],
            default: "pending_review",
            index: true,
        },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reviewedAt: { type: Date, default: null },
        reviewNotes: { type: String, trim: true },
        refundAmount: { type: Number, default: 0, min: 0 },
        refundId: { type: String, default: null },
        refundMethod: { type: String, enum: ["original_payment", "bank_transfer", "manual", null], default: null },
        processedAt: { type: Date, default: null },
        processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { _id: false }
);

const reservationSchema = new mongoose.Schema(
    {
        /* ============ Identifiers ============ */
        reservationNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },

        /* ============ References (Optional now, for manual inputs) ============ */
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            default: null, // ✅ Not always required if manual
            index: true,
        },

        vehicle: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
            default: null, // ✅ Not always required if manual
            index: true,
        },

        // ✅ NEW: Manual Text Inputs (Screenshot ke liye)
        customerName: { type: String, trim: true },
        customerPhone: { type: String, trim: true },
        vehicleName: { type: String, trim: true },

        lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
        campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

        /* ============ Frozen Snapshots (Optional now) ============ */
        vehicleSnapshot: {
            stockId: { type: String, default: null },
            brand: { type: String, trim: true },
            model: { type: String, trim: true },
            variant: { type: String, trim: true },
            year: { type: Number },
            color: { type: String, trim: true },
            kilometers: { type: Number },
            listedPrice: { type: Number },
            image: { type: String, default: null },
        },

        buyerSnapshot: {
            name: { type: String, trim: true },
            phone: { type: String, trim: true },
            email: { type: String, trim: true },
            city: { type: String, trim: true },
        },

        /* ============ Reservation Type ============ */
        reservationType: {
            type: String,
            enum: ["reservation", "booking"],
            default: "reservation",
            index: true,
        },

        /* ============ Money ============ */
        // ✅ UPDATED: "Deposit (INR)" from Screenshot
        depositAmount: { type: Number, required: true, min: 0 },
        reservationAmount: { type: Number, min: 0 }, // Kept for backward compatibility
        amountPaid: { type: Number, default: 0, min: 0 },
        amountDue: { type: Number, default: 0, min: 0 },

        paymentCheck: {
            type: String,
            enum: ["Pending", "Received - simulated", "Failed"],
            default: "Pending",
            index: true,
        },

        paymentStatus: { // Kept for backward compatibility
            type: String,
            enum: ["pending", "partial", "paid", "refunded", "failed"],
            default: "pending",
            index: true,
        },

        // ✅ NEW: "Transaction reference"
        transactionReference: { type: String, trim: true, default: null },

        // ✅ NEW: "Cancellation / refund"
        cancellationRefund: { type: String, trim: true, default: null },

        payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
        currency: { type: String, default: "INR" },
        status: {
            type: String,
            enum: [
                "Active",
                "Converted",
                "Cancelled",
                "Expired",
                "Completed",
                "Refunded",
            ],
            default: "Active",
            index: true,
        },

        /* ============ Validity ============ */
        expiresAt: { type: Date, default: null, index: true },
        extendedCount: { type: Number, default: 0 },
        extendedAt: { type: Date, default: null },

        /* ============ Timestamps ============ */
        // ✅ NEW: Reservation Date from Screenshot
        reservationDate: { type: Date, default: Date.now, index: true },
        confirmedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        convertedAt: { type: Date, default: null },
        refundedAt: { type: Date, default: null },
        refundRequest: { type: refundRequestSchema, default: null },

        /* ============ Cancellation ============ */
        cancellationReason: { type: String, trim: true, default: null },
        cancellationCategory: {
            type: String,
            enum: ["customer_request", "payment_failed", "vehicle_unavailable", "expired", "price_negotiation_failed", "other", null],
            default: null,
        },
        cancelledBy: { type: String, enum: ["customer", "staff", "system", null], default: null },

        /* ============ Conversion ============ */
        convertedToSale: { type: mongoose.Schema.Types.ObjectId, ref: "Sale", default: null },

        /* ============ Source & Consent ============ */
        source: {
            type: String,
            enum: ["google_ads", "facebook_ads", "instagram", "organic", "direct_website", "whatsapp", "phone", "walk_in", "referral", "manual", "other"],
            default: "manual",
        },

        termsAccepted: { type: Boolean, default: false },
        termsAcceptedAt: { type: Date, default: null },
        notes: { type: String, trim: true },
        isActive: { type: Boolean, default: true, index: true },

        /* ============ Audit ============ */
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

/* ============ Indexes ============ */
reservationSchema.index({ status: 1, paymentCheck: 1 });
reservationSchema.index({ customer: 1, status: 1 });
reservationSchema.index({ vehicle: 1, status: 1 });
reservationSchema.index({ createdAt: -1 });

/* Soft delete */
reservationSchema.pre(/^find/, function () {
    this.where({ deletedAt: null });
});

/* Auto amountDue */
reservationSchema.pre("save", function () {
    const total = this.depositAmount || this.reservationAmount || 0;
    this.amountDue = Math.max(0, total - (this.amountPaid || 0));
});

export default mongoose.model("Reservation", reservationSchema);