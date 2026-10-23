import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const customerSchema = new mongoose.Schema(
    {
        customerNumber: {
            type: String,
            unique: true,
            index: true,
            trim: true,
        },

        name: { type: String, required: true, trim: true },
        email: { type: String, lowercase: true, trim: true, index: true, sparse: true },
        phone: { type: String, required: true, trim: true, index: true },
        alternatePhone: { type: String, trim: true },

        password: { type: String, select: false, minlength: 8 },
        isVerified: { type: Boolean, default: false },

        // ... (OTP fields same rahenge)
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

        // IP-based location
        ipAddress: { type: String, default: null },
        ipLocation: {
            country: { type: String, default: null },
            state: { type: String, default: null },
            city: { type: String, default: null },
        },

        // ✅ Lead source (Updated enum to match frontend: "Website", "Referral", "Walk-in", "Instagram", "Carwale", "Google Ads")
        source: {
            type: String,
            enum: [
                "Website", "Referral", "Walk-in", "Instagram", 
                "Carwale", "Google Ads", "Facebook Ads", 
                "WhatsApp", "Phone", "Organic", "Manual", "Other"
            ],
            default: "Website",
            index: true,
        },

        attribution: {
            utmSource: { type: String, default: null },
            utmMedium: { type: String, default: null },
            utmCampaign: { type: String, default: null },
            utmTerm: { type: String, default: null },
            utmContent: { type: String, default: null },
            gclid: { type: String, default: null },
            fbclid: { type: String, default: null },
            landingPage: { type: String, default: null },
            firstTouchSource: { type: String, default: null },
            latestTouchSource: { type: String, default: null },
            referrer: { type: String, default: null },
        },

        savedCars: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" }],

        interestedIn: {
            type: String,
            enum: ["buy", "sell", "find", "other"],
            default: "buy",
        },

        notes: { type: String, trim: true },
        lastContactedAt: { type: Date, default: null },
        isActive: { type: Boolean, default: true, index: true },

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

customerSchema.index({ phone: 1, deletedAt: 1 }, { unique: true });
customerSchema.index({ email: 1, deletedAt: 1 });
customerSchema.index({ source: 1, createdAt: -1 });
customerSchema.index({ name: "text", phone: "text", email: "text" });

customerSchema.pre(/^find/, function () {
    this.where({ deletedAt: null });
});

// ✅ Auto-generate customerNumber
customerSchema.pre("save", async function () {
    if (!this.customerNumber) {
        const count = await mongoose.model("Customer").countDocuments();
        this.customerNumber = `CU-${String(count + 3700).padStart(5, "0")}`;
    }
    
    // Password hashing
    if (this.isModified("password") && this.password) {
        this.password = await bcrypt.hash(this.password, 12);
    }
});

customerSchema.methods.comparePassword = function (candidate) {
    return bcrypt.compare(candidate, this.password);
};

export default mongoose.model("Customer", customerSchema);