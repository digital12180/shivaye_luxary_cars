import mongoose from "mongoose";

const stageHistorySchema = new mongoose.Schema(
    {
        stage: { type: String, required: true },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        changedAt: { type: Date, default: Date.now },
        note: { type: String, trim: true },
    },
    { _id: false }
);

const leadSchema = new mongoose.Schema(
    {
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            required: true,
            index: true,
        },

        vehicle: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
            default: null,
            index: true,
        },

        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },

        // Frontend: "Customer name *" (stored in Customer model, but kept here for quick access)
        // Frontend: "Mobile *" (stored in Customer model, but kept here for quick access)
        // We will populate customer for these fields.

        // Frontend: "Email" (stored in Customer model)

        // Frontend: "Enquiry type"
        enquiryType: {
            type: String,
            enum: ["Purchase", "Exchange", "Finance"],
            default: "Purchase",
            index: true,
        },

        // Frontend: "Interested vehicle *"
        interestedVehicle: {
            type: String,
            trim: true,
            required: true,
        },

        // Frontend: "Brand"
        brand: {
            type: String,
            trim: true,
        },

        // Frontend: "Budget (INR)"
        budget: {
            type: Number,
            default: null,
        },

        // Frontend: "Source"
        source: {
            type: String,
            enum: [
                "Website",
                "Instagram",
                "Referral",
                "Walk-in",
                "Google Ads",
                "Facebook Ads",
                "WhatsApp",
                "Phone",
                "Other",
            ],
            required: true,
            index: true,
        },

        // Frontend: "Pipeline status"
        status: {
            type: String,
            enum: [
                "New",
                "Contacted",
                "Qualified",
                "Test Drive",
                "Visit Scheduled",
                "Negotiation",
                "Reserved",
                "Booked",
                "Won",
                "Lost",
            ],
            default: "New",
            index: true,
        },

        // Frontend: "Next follow-up"
        nextFollowUpAt: {
            type: Date,
            default: null,
            index: true,
        },

        // Frontend: "City"
        city: {
            type: String,
            trim: true,
            index: true,
        },

        // Frontend: "Notes"
        notes: {
            type: String,
            trim: true,
        },

        // Additional fields from your existing model
        priority: {
            type: String,
            enum: ["hot", "warm", "cold"],
            default: "warm",
            index: true,
        },

        campaign: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Campaign",
            default: null,
        },

        requirement: { type: String, trim: true },

        lostReason: { type: String, trim: true, default: null },
        lostReasonCategory: {
            type: String,
            enum: [
                "price",
                "not_interested",
                "bought_elsewhere",
                "no_response",
                "financing",
                "other",
                null,
            ],
            default: null,
        },

        dealValue: { type: Number, default: null, min: 0 },
        bookingAmount: { type: Number, default: null, min: 0 },

        lastContactedAt: { type: Date, default: null },
        firstContactedAt: { type: Date, default: null },

        stageHistory: [stageHistorySchema],

        duplicateOf: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Lead",
            default: null,
        },
        isDuplicate: { type: Boolean, default: false },

        closedAt: { type: Date, default: null },
        wonAt: { type: Date, default: null },
        lostAt: { type: Date, default: null },

        attribution: {
            utmSource: { type: String, default: null },
            utmMedium: { type: String, default: null },
            utmCampaign: { type: String, default: null },
            utmTerm: { type: String, default: null },
            utmContent: { type: String, default: null },
            gclid: { type: String, default: null },
            fbclid: { type: String, default: null },
            landingPage: { type: String, default: null },
            firstTouchAt: { type: Date, default: null },
            latestTouchAt: { type: Date, default: null },
        },

        location: {
            country: { type: String, default: null },
            state: { type: String, default: null },
            city: { type: String, default: null, index: true },
        },

        ipAddress: { type: String, default: null },

        totalActivities: { type: Number, default: 0 },

        isActive: { type: Boolean, default: true, index: true },

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Compound indexes
leadSchema.index({ status: 1, assignedTo: 1 });
leadSchema.index({ status: 1, nextFollowUpAt: 1 });
leadSchema.index({ source: 1, createdAt: -1 });
leadSchema.index({ enquiryType: 1, status: 1 });
leadSchema.index({ customer: 1, status: 1 });

leadSchema.index({
    requirement: "text",
    notes: "text",
    brand: "text",
    interestedVehicle: "text",
});

// Soft delete
leadSchema.pre(/^find/, function () {
    this.where({ deletedAt: null });
});

// Track stage changes + timestamps
leadSchema.pre("save", function () {
    if (this.isModified("status")) {
        const prev = this.$__.priorDoc?.status;
        if (prev !== this.status) {
            this.stageHistory.push({
                stage: this.status,
                changedBy: this.updatedBy || this.createdBy,
            });

            if (this.status === "Won") {
                this.wonAt = new Date();
                this.closedAt = new Date();
            }
            if (this.status === "Lost") {
                this.lostAt = new Date();
                this.closedAt = new Date();
            }
            if (this.status === "Contacted" && !this.firstContactedAt) {
                this.firstContactedAt = new Date();
            }
        }
    }
});

export default mongoose.model("Lead", leadSchema);