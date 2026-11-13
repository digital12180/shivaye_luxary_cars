import mongoose from "mongoose";
import crypto  from "crypto"

const sellRequestSchema = new mongoose.Schema(
    {
        requestNumber: { type: String, unique: true, index: true },
        // Link to Customer (NEW)
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
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
            default: "Morning",
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
        registrationNumber: { type: String, trim: true, unique: true, sparse: true },
        vehicleLocation: { type: String, trim: true },
        conditionDescription: { type: String, trim: true },
        // FIX: chassis numbers contain letters -> String
        chasisNumber: { type: String, required: true, unique: true, trim: true },

        // Pricing & Media
        marketPrice: { type: Number, required: true },
        askingPrice: { type: Number, required: true },
        photos: [{ type: String }],

        // CRM & Status Tracking (Admin side)
        source: {
            type: String,
            enum: ["Website", "Admin", "Walk-in", "Referral"],
            default: "Website",
        },
        status: {
            type: String,
            enum: ["New", "Inspection Scheduled", "Offer Made", "Purchased", "Rejected"],
            default: "New",
        },
        additionalInfo: { type: String, trim: true },
        serviceHistory: { type: String, trim: true },
        insuranceValidity: { type: Date },
        accidentHistory: { type: String, trim: true },
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

        // Soft Delete
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);


sellRequestSchema.index({ requestNumber: 1 }, { unique: true });

sellRequestSchema.pre("save", async function () {
  if (this.requestNumber) return;

  const count = await mongoose
    .model("SellRequest")
    .countDocuments({ deletedAt: null });

  const hash = crypto.randomBytes(3).toString("hex").slice(0, 4).toUpperCase();

  this.requestNumber = `SR-${String(count + 1).padStart(4, "0")}-${hash}`;
});
// Exclude soft-deleted records from find queries (find, findOne, findById)
sellRequestSchema.pre(/^find/, function () {
    this.where({ deletedAt: null });
});

// FIX: also filter soft-deleted on findOneAndUpdate / findOneAndDelete
sellRequestSchema.pre(/^findOneAnd/, function () {
    this.where({ deletedAt: null });
});

export default mongoose.model("SellRequest", sellRequestSchema);