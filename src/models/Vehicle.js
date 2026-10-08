import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema(
    {
        stockId: {
            type: String,
            unique: true,
            trim: true,
            index: true,
        },

        brand: { type: String, required: true, trim: true, index: true },
        model: { type: String, required: true, trim: true, index: true },
        variant: { type: String, trim: true },

        category: {
            type: String,
            enum: ["new", "used", "certified", "other"],
            default: "used",
        },

        year: { type: Number, required: true, index: true },
        registrationYear: { type: Number },

        fuelType: {
            type: String,
            enum: ["petrol", "diesel", "electric", "hybrid", "cng", "other"],
            required: true,
            index: true,
        },

        transmission: {
            type: String,
            enum: ["automatic", "manual", "amt", "dct", "cvt", "other"],
            required: true,
            index: true,
        },

        bodyType: {
            type: String,
            enum: ["sedan", "suv", "hatchback", "coupe", "convertible", "mpv", "other"],
            trim: true,
        },

        color: { type: String, trim: true },

        ownership: {
            type: String,
            enum: ["first", "second", "third", "fourth", "other"],
            default: "first",
        },

        kilometers: { type: Number, required: true, min: 0, index: true },

        price: { type: Number, required: true, min: 0, index: true },
        soldPrice: { type: Number, min: 0, default: null },

        registrationNumber: { type: String, trim: true, uppercase: true },
        description: { type: String, trim: true },

        features: [{ type: String, trim: true }],
        images: [{ type: String }],
        video: { type: String, default: null },

        location: {
            city: { type: String, trim: true, index: true },
            state: { type: String, trim: true },
            country: { type: String, default: "India" },
        },

        status: {
            type: String,
            enum: ["available", "reserved", "booked", "sold", "inactive"],
            default: "available",
            index: true,
        },

        featured: { type: Boolean, default: false, index: true },
        isPublished: { type: Boolean, default: true, index: true },

        views: { type: Number, default: 0 },

        slug: { type: String, unique: true, trim: true, lowercase: true, index: true },

        seo: {
            metaTitle: { type: String, trim: true },
            metaDescription: { type: String, trim: true },
            keywords: [{ type: String, trim: true }],
        },

        listedAt: { type: Date, default: Date.now },
        reservedAt: { type: Date, default: null },
        soldAt: { type: Date, default: null },

        // Sale & Buyer (BRD 31)
        soldTo: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
        saleExecutive: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Compound indexes for common filters (BRD 6.2)
vehicleSchema.index({ brand: 1, model: 1, year: 1 });
vehicleSchema.index({ status: 1, isPublished: 1 });
vehicleSchema.index({ price: 1, kilometers: 1 });
vehicleSchema.index({ "location.city": 1, status: 1 });

// Full-text search
vehicleSchema.index({
    brand: "text",
    model: "text",
    variant: "text",
    description: "text",
});

// Soft delete filter
vehicleSchema.pre(/^find/, function (next) {
    this.where({ deletedAt: null });
    next();
});

// Auto-generate slug if not provided
vehicleSchema.pre("save", function (next) {
    if (!this.slug) {
        const base = `${this.brand}-${this.model}-${this.year}-${this._id}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        this.slug = base;
    }
    next();
});

export default mongoose.model("Vehicle", vehicleSchema);