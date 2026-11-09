import mongoose from "mongoose";

const sellRequestSchema = new mongoose.Schema(
    {
        requestNumber: {
            type: String,
            unique: true,
            index: true,
        },
        // Seller Details
        sellerName: { type: String, required: true, trim: true },
        phone: { type: String, required: true, trim: true, index: true },
        email: { type: String, lowercase: true, trim: true },
        city: { type: String, trim: true },
        preferredContactTime: { 
            type: String, 
            enum: ["Morning", "Afternoon", "Evening", "Anytime"],
            default: "Morning" 
        },

        // Vehicle Details
        brand: { type: String, required: true, trim: true },
        model: { type: String, required: true, trim: true },
        variant: { type: String, trim: true },
        bodyType: { type: String, trim: true },
        year: { type: Number, required: true },
        registrationYear: { type: Number, required: true },
        fuel: { type: String, required: true },
        transmission: { type: String, required: true },
        kilometres: { type: Number, required: true },
        ownership: { type: String, trim: true },
        exteriorColour: { type: String, trim: true },
        registrationNumber: { type: String, trim: true },
        vehicleLocation: { type: String, trim: true },
        conditionDescription: { type: String, trim: true },
        
        // Pricing & Media
        marketPrice: { type: Number, required: true },
        askingPrice: { type: Number, required: true },
        photos: [{ type: String }], // Array of image URLs

        // CRM & Status Tracking (Admin side)
        source: { 
            type: String, 
            enum: ["Website", "Admin", "Walk-in", "Referral"], 
            default: "Website" 
        },
        status: {
            type: String,
            enum: ["New", "Inspection Scheduled", "Offer Made", "Purchased", "Rejected"],
            default: "New",
        },
        adminNotes: { type: String, trim: true },
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Reference to CRM User/Admin
        
        // Soft Delete
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Auto-generate Request Number like SR-0001
sellRequestSchema.pre("save", async function (next) {
    if (!this.requestNumber) {
        const count = await mongoose.model("SellRequest").countDocuments();
        this.requestNumber = `SR-${String(count + 1).padStart(4, "0")}`;
    }
    next();
});

// Exclude soft-deleted records in queries
sellRequestSchema.pre(/^find/, function (next) {
    this.where({ deletedAt: null });
    next();
});

export default mongoose.model("SellRequest", sellRequestSchema);