import mongoose from "mongoose";

const leadActivitySchema = new mongoose.Schema(
    {
        lead: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Lead",
            required: true,
            index: true,
        },

        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            default: null,
            index: true,
        },

        performedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },

        // Type of activity (BRD 9.2 + 13)
        type: {
            type: String,
            enum: [
                "call",
                "whatsapp",
                "email",
                "sms",
                "note",
                "meeting",
                "test_drive",
                "showroom_visit",
                "status_change",
                "assignment",
                "follow_up_scheduled",
                "payment",
                "reservation",
                "system",
                "other",
            ],
            required: true,
            index: true,
        },

        // Optional subtype / direction (for calls)
        direction: {
            type: String,
            enum: ["inbound", "outbound", "internal", null],
            default: null,
        },

        // Short title (e.g. "Called customer", "Sent WhatsApp brochure")
        title: { type: String, trim: true },

        // Detailed note
        description: { type: String, trim: true },

        // Outcome for calls / WhatsApp
        outcome: {
            type: String,
            enum: [
                "connected",
                "not_connected",
                "busy",
                "no_answer",
                "wrong_number",
                "callback_requested",
                "interested",
                "not_interested",
                "completed",
                "other",
                null,
            ],
            default: null,
        },

        // Optional duration (seconds) — useful for calls
        durationSeconds: { type: Number, default: null, min: 0 },

        // Attachments (brochure, images, recordings)
        attachments: [
            {
                url: { type: String, required: true },
                name: { type: String, trim: true },
                type: { type: String, trim: true },
            },
        ],

        // Flexible metadata (e.g. WhatsApp template name, Twilio SID)
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },

        // Optional scheduling — for calls planned ahead
        scheduledAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },

        isActive: { type: Boolean, default: true },
        deletedAt: { type: Date, default: null },

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

leadActivitySchema.index({ lead: 1, createdAt: -1 });
leadActivitySchema.index({ performedBy: 1, createdAt: -1 });
leadActivitySchema.index({ type: 1, createdAt: -1 });
leadActivitySchema.index({ lead: 1, type: 1 });

// Text search across title + description
leadActivitySchema.index({ title: "text", description: "text" });

leadActivitySchema.pre(/^find/, function (next) {
    this.where({ deletedAt: null });
    next();
});

export default mongoose.model("LeadActivity", leadActivitySchema);