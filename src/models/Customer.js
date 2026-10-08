import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const customerSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },

        email: {
            type: String,
            lowercase: true,
            trim: true,
            index: true,
            sparse: true,
        },

        phone: { type: String, required: true, trim: true, index: true },
        alternatePhone: { type: String, trim: true },

        password: { type: String, select: false, minlength: 8 },

        isVerified: { type: Boolean, default: false },

        // OTP (for Customer Panel login via mobile)
        otp: { type: String, select: false },
        otpExpires: { type: Date, select: false },
        otpAttempts: { type: Number, default: 0, select: false },
        otpLastSentAt: { type: Date, default: null, select: false },
        refreshTokenHash: { type: String, select: false },

        // Location
        city: { type: String, trim: true, index: true },
        state: { type: String, trim: true },
        country: { type: String, default: "India", trim: true },
        address: { type: String, trim: true },
        pincode: { type: String, trim: true },

        // IP-based location (BRD 12)
        ipAddress: { type: String, default: null },
        ipLocation: {
            country: { type: String, default: null },
            state: { type: String, default: null },
            city: { type: String, default: null },
        },

        // Lead source (BRD 11.1)
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
            default: "direct_website",
            index: true,
        },

        // Attribution / UTM (BRD 11.2)
        attribution: {
            utmSource: { type: String, default: null },
            utmMedium: { type: String, default: null },
            utmCampaign: { type: String, default: null },
            utmTerm: { type: String, default: null },
            utmContent: { type: String, default: null },
            gclid: { type: String, default: null },     // Google Ads
            fbclid: { type: String, default: null },    // Meta
            landingPage: { type: String, default: null },
            firstTouchSource: { type: String, default: null },
            latestTouchSource: { type: String, default: null },
            referrer: { type: String, default: null },
        },

        // Customer Panel features (BRD 27.1)
        savedCars: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" }],

        // Intent (BRD 14.3 – Sell Your Car / Find My Car)
        interestedIn: {
            type: String,
            enum: ["buy", "sell", "find", "other"],
            default: "buy",
        },

        notes: { type: String, trim: true },

        lastContactedAt: { type: Date, default: null },

        isActive: { type: Boolean, default: true, index: true },

        // Audit
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Unique phone per active customer (duplicate handling – BRD 9.2)
customerSchema.index({ phone: 1, deletedAt: 1 }, { unique: true });
customerSchema.index({ email: 1, deletedAt: 1 });
customerSchema.index({ source: 1, createdAt: -1 });
customerSchema.index({ "ipLocation.city": 1 });
customerSchema.index({ name: "text", phone: "text", email: "text" });

// Soft delete filter
customerSchema.pre(/^find/, function (next) {
    this.where({ deletedAt: null });
    next();
});

// Hash password if present & modified
customerSchema.pre("save", async function (next) {
    if (!this.isModified("password") || !this.password) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

customerSchema.methods.comparePassword = function (candidate) {
    return bcrypt.compare(candidate, this.password);
};

export default mongoose.model("Customer", customerSchema);