import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
    {
        /* ============ Recipient ============ */
        recipientType: {
            type: String,
            // ✅ FIXED: added "system" for cron/automated sends
            enum: ["customer", "staff", "admin", "system"],
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
            // ✅ FIXED: added "call" for click-to-call tracking
            enum: ["whatsapp", "sms", "email", "push", "in_app", "call"],
            required: true,
            index: true,
        },

        /* ============ Direction — BRD 13 (CRM activity logging) ============ */
        // "outbound" = system → user, "inbound" = user reply (logged via webhook)
        direction: {
            type: String,
            enum: ["outbound", "inbound"],
            default: "outbound",
            index: true,
        },

        /* ============ Type (BRD 13) ============ */
        type: {
            type: String,
            enum: [
                // Lead
                "lead_assigned",
                "lead_created",
                // Follow-up
                "follow_up_reminder",
                // Appointment / Test drive
                "appointment_scheduled",
                "appointment_reminder",
                "test_drive_reminder",
                // Reservation
                "reservation_initiated",
                "reservation_confirmed",
                "reservation_cancelled",
                "reservation_expiring",
                // Payment
                "payment_success",
                "payment_failed",
                "payment_refund",
                // Sale
                "sale_completed",
                // Marketing
                "festive_offer",
                // WhatsApp / Call CTAs (BRD 13)
                "whatsapp_click",
                "call_click",
                "whatsapp_inbound",
                // Generic
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

        /* ============ Template (WhatsApp Business API — BRD 13) ============ */
        template: {
            name: { type: String, trim: true },             // "reservation_confirmed_v1"
            language: { type: String, default: "en" },      // "en", "hi", "mr"
            // ✅ ADDED: track which provider's template format this is
            provider: {
                type: String,
                enum: ["meta_waba", "gupshup", "twilio", "custom", null],
                default: null,
            },
            variables: { type: mongoose.Schema.Types.Mixed, default: {} },
        },

        /* ============ Rendering ============ */
        data: { type: mongoose.Schema.Types.Mixed, default: {} },

        /* ============ Delivery Status ============ */
        status: {
            type: String,
            enum: ["queued", "sending", "sent", "delivered", "read", "failed", "cancelled"],
            default: "queued",
            index: true,
        },

        /* ============ Gateway / Provider Tracking ============ */
        provider: {
            type: String,
            // ✅ FIXED: matched template.provider enum
            enum: ["meta_waba", "gupshup", "twilio", "msg91", "sendgrid", "fcm", "internal", null],
            default: null,
            trim: true,
        },
        providerMessageId: { type: String, trim: true, index: true },
        providerResponse: { type: mongoose.Schema.Types.Mixed, default: {} },

        // ✅ ADDED: WABA metadata for CRM analytics
        payloadMeta: {
            campaignName: { type: String, trim: true, default: null },
            category: { type: String, trim: true, default: null },   // "utility", "marketing"
            templateId: { type: String, trim: true, default: null },
        },

        failureReason: { type: String, trim: true },
        retryCount: { type: Number, default: 0 },

        /* ============ Timestamps ============ */
        scheduledAt: { type: Date, default: Date.now, index: true },
        sentAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null },
        readAt: { type: Date, default: null },
        failedAt: { type: Date, default: null },
        seenAt: { type: Date, default: null },     // ✅ ADDED: in-app seen tracking

        /* ============ Read state (for CRM / Customer Panel inbox) ============ */
        isRead: { type: Boolean, default: false, index: true },

        /* ============ Related entities ============ */
        relatedTo: {
            lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
            vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },
            reservation: { type: mongoose.Schema.Types.ObjectId, ref: "Reservation", default: null },
            payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
            appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
            sale: { type: mongoose.Schema.Types.ObjectId, ref: "Sale", default: null },
            campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
            // ✅ ADDED: link to CRM Activity log
            activity: { type: mongoose.Schema.Types.ObjectId, ref: "Activity", default: null },
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
// ✅ ADDED: BRD 13 dedicated indexes for the 3 required flows
notificationSchema.index({ type: 1, "relatedTo.reservation": 1 });
notificationSchema.index({ type: 1, "relatedTo.lead": 1 });
notificationSchema.index({ type: 1, "relatedTo.payment": 1 });

/* Soft delete */
notificationSchema.pre(/^find/, function (next) {
    this.where({ deletedAt: null });
    next();
});

export default mongoose.model("Notification", notificationSchema);