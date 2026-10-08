import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
    {
        /* ============ Recipient ============ */
        recipientType: {
            type: String,
            enum: ["customer", "staff", "admin"],
            required: true,
            index: true,
        },

        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            default: null,
            index: true,
        },

        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },

        /* Delivery target (snapshot at time of send) */
        to: {
            type: String,
            trim: true,
            required: true,
        },

        /* ============ Channel (BRD 13, 16.4) ============ */
        channel: {
            type: String,
            enum: ["whatsapp", "sms", "email", "push", "in_app"],
            required: true,
            index: true,
        },

        /* ============ Type (BRD 13) ============ */
        type: {
            type: String,
            enum: [
                "lead_assigned",
                "lead_created",
                "follow_up_reminder",
                "appointment_scheduled",
                "appointment_reminder",
                "test_drive_reminder",
                "reservation_initiated",
                "reservation_confirmed",
                "reservation_cancelled",
                "reservation_expiring",
                "payment_success",
                "payment_failed",
                "payment_refund",
                "sale_completed",
                "festive_offer",
                "custom",
            ],
            required: true,
            index: true,
        },

        /* ============ Priority ============ */
        priority: {
            type: String,
            enum: ["low", "normal", "high", "urgent"],
            default: "normal",
            index: true,
        },

        /* ============ Content ============ */
        title: { type: String, trim: true, required: true },
        body: { type: String, trim: true, required: true },

        /* ============ Template (for WhatsApp Business API) ============ */
        template: {
            name: { type: String, trim: true },             // e.g. "reservation_confirmed"
            language: { type: String, default: "en" },
            variables: { type: mongoose.Schema.Types.Mixed, default: {} },
        },

        /* ============ Rendering ============ */
        data: { type: mongoose.Schema.Types.Mixed, default: {} },   // for in-app UI

        /* ============ Delivery Status ============ */
        status: {
            type: String,
            enum: ["queued", "sending", "sent", "delivered", "read", "failed", "cancelled"],
            default: "queued",
            index: true,
        },

        /* ============ Gateway / Provider Tracking ============ */
        provider: { type: String, trim: true },          // "msg91", "twilio", "meta", "sendgrid"
        providerMessageId: { type: String, trim: true, index: true },
        providerResponse: { type: mongoose.Schema.Types.Mixed, default: {} },

        failureReason: { type: String, trim: true },
        retryCount: { type: Number, default: 0 },

        /* ============ Timestamps ============ */
        scheduledAt: { type: Date, default: Date.now, index: true },
        sentAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null },
        readAt: { type: Date, default: null },
        failedAt: { type: Date, default: null },

        /* ============ Read state (for CRM / Customer Panel inbox) ============ */
        isRead: { type: Boolean, default: false, index: true },
        readAt: { type: Date, default: null },

        /* ============ Related entities ============ */
        relatedTo: {
            lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
            vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },
            reservation: { type: mongoose.Schema.Types.ObjectId, ref: "Reservation", default: null },
            payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
            appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
            sale: { type: mongoose.Schema.Types.ObjectId, ref: "Sale", default: null },
            campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
        },

        /* ============ Action link ============ */
        actionUrl: { type: String, trim: true, default: null },
        actionLabel: { type: String, trim: true, default: null },

        /* ============ Audit ============ */
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

/* ============ Indexes ============ */
notificationSchema.index({ customer: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ status: 1, scheduledAt: 1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ channel: 1, status: 1 });

/* Soft delete */
notificationSchema.pre(/^find/, function (next) {
    this.where({ deletedAt: null });
    next();
});

export default mongoose.model("Notification", notificationSchema);