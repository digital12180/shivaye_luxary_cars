import mongoose from "mongoose";

const whatsAppMessageSchema = new mongoose.Schema(
    {
        direction: {
            type: String,
            enum: ["outbound", "inbound"],
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ["template", "text", "button", "interactive"],
            default: "text",
        },

        phone: { type: String, required: true, index: true },

        // Optional: link to your User / Lead / Vehicle enquiry
        relatedTo: {
            model: { type: String },   // "Lead" | "User" | "Vehicle"
            id: { type: mongoose.Schema.Types.ObjectId },
        },

        // Outbound specifics
        templateName: { type: String, default: null },
        language: { type: String, default: "en" },
        variables: { type: Object, default: {} },

        // Body text (for text messages or inbound)
        body: { type: String, default: null },

        // WABA message ID (from Meta) — used for status updates
        waMessageId: { type: String, index: true, default: null },

        // Delivery status (outbound)
        status: {
            type: String,
            enum: ["queued", "sent", "delivered", "read", "failed", "received"],
            default: "queued",
            index: true,
        },
        statusHistory: [
            {
                status: String,
                at: { type: Date, default: Date.now },
            },
        ],

        // Error info if send failed
        error: { type: Object, default: null },

        // Raw provider payload (for audit)
        providerResponse: { type: Object, default: null },

        // Inbound contact info
        contact: { type: Object, default: null },
    },
    { timestamps: true }
);

export default mongoose.model("WhatsAppMessage", whatsAppMessageSchema);