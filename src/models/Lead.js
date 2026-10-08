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

        leadType: {
            type: String,
            enum: ["buy", "sell", "find", "test_drive", "general"],
            default: "buy",
            index: true,
        },

        status: {
            type: String,
            enum: [
                "new",
                "contacted",
                "qualified",
                "car_shared",
                "visit_scheduled",
                "test_drive",
                "negotiation",
                "reserved",
                "booked",
                "won",
                "lost",
            ],
            default: "new",
            index: true,
        },

        priority: {
            type: String,
            enum: ["hot", "warm", "cold"],
            default: "warm",
            index: true,
        },

        source: {
            type: String,
            enum: [
                "google_ads",
                "facebook_ads",
                "instagram",
                "organic",
                "direct_website",
                "whatsapp",
                "phone",
                "walk_in",
                "referral",
                "manual",
                "other",
            ],
            required: true,
            index: true,
        },

        campaign: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Campaign",
            default: null,
        },

        requirement: { type: String, trim: true },

        interestedBrand: { type: String, trim: true },
        interestedModel: { type: String, trim: true },

        budget: {
            min: { type: Number, default: null },
            max: { type: Number, default: null },
        },

        notes: { type: String, trim: true },

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

        // Deal tracking (BRD 34.2)
        dealValue: { type: Number, default: null, min: 0 },
        bookingAmount: { type: Number, default: null, min: 0 },

        // Follow-up tracking (BRD 9.1)
        nextFollowUpAt: { type: Date, default: null, index: true },
        lastContactedAt: { type: Date, default: null },
        firstContactedAt: { type: Date, default: null },

        // Stage movement audit
        stageHistory: [stageHistorySchema],

        // Duplicate handling (BRD 9.2)
        duplicateOf: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Lead",
            default: null,
        },
        isDuplicate: { type: Boolean, default: false },

        // Closure
        closedAt: { type: Date, default: null },
        wonAt: { type: Date, default: null },
        lostAt: { type: Date, default: null },

        // Marketing attribution (BRD 11.2)
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

        // IP-based location (BRD 12)
        location: {
            country: { type: String, default: null },
            state: { type: String, default: null },
            city: { type: String, default: null, index: true },
        },

        ipAddress: { type: String, default: null },

        // Activity counter (dashboard perf)
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
leadSchema.index({ leadType: 1, status: 1 });
leadSchema.index({ customer: 1, status: 1 });

// Text search (BRD 9.2)
leadSchema.index({
    requirement: "text",
    notes: "text",
    interestedBrand: "text",
    interestedModel: "text",
});

// Soft delete
leadSchema.pre(/^find/, function (next) {
    this.where({ deletedAt: null });
    next();
});

// Track stage changes + timestamps
leadSchema.pre("save", function (next) {
    if (this.isModified("status")) {
        const prev = this.$__.priorDoc?.status;
        if (prev !== this.status) {
            this.stageHistory.push({
                stage: this.status,
                changedBy: this.updatedBy || this.createdBy,
            });

            if (this.status === "won") {
                this.wonAt = new Date();
                this.closedAt = new Date();
            }
            if (this.status === "lost") {
                this.lostAt = new Date();
                this.closedAt = new Date();
            }
            if (this.status === "contacted" && !this.firstContactedAt) {
                this.firstContactedAt = new Date();
            }
        }
    }
    next();
});

export default mongoose.model("Lead", leadSchema);