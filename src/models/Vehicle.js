import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema(
    {
        stockId: {
            type: String,
            unique: true,
            trim: true,
            index: true,
        },
        brandRef: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Brand",
            default: null,
            index: true,
        },
        brand: { type: String, required: true, trim: true, index: true },
        categoryRef: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            default: null,
            index: true,
        },

        // Kept as String for display / search (denormalized)
        category: {
            type: String,
            default: "Luxury SUV",
            index: true,
        },

        model: { type: String, required: true, trim: true, index: true },
        variant: { type: String, trim: true },

        year: { type: Number, required: true, index: true },
        registrationYear: { type: Number },

        fuelType: {
            type: String,
            enum: ["Petrol", "Diesel", "Electric", "Hybrid", "CNG", "Other"],
            required: true,
            index: true,
        },

        transmission: {
            type: String,
            enum: ["Automatic", "Manual", "AMT", "DCT", "CVT", "Other"],
            required: true,
            index: true,
        },

        bodyType: { type: String, trim: true },

        exteriorColour: { type: String, trim: true },

        ownership: {
            type: String,
            enum: ["First", "Second", "Third", "Fourth", "Other"],
            default: "First",
        },

        kilometers: { type: Number, required: true, min: 0, index: true },

        askingPrice: { type: Number, required: true, min: 0, index: true },
        price: { type: Number, min: 0 },
        soldPrice: { type: Number, min: 0, default: null },

        registrationNumber: { type: String, trim: true, uppercase: true },
        description: { type: String, trim: true },

        features: [{ type: String, trim: true }],
        images: [{ type: String }],
        imagePublicIds: [{ type: String }],
        video: { type: String, default: null },
        videoPublicId: { type: String, default: null },

        location: { type: String, trim: true, index: true },

        status: {
            type: String,
            enum: ["Available", "Reserved", "Booked", "Sold", "Inactive"],
            default: "Available",
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

        soldTo: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
        saleExecutive: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

vehicleSchema.index({ brand: 1, model: 1, year: 1 });
vehicleSchema.index({ status: 1, isPublished: 1 });
vehicleSchema.index({ askingPrice: 1, kilometers: 1 });
vehicleSchema.index({ location: 1, status: 1 });
vehicleSchema.index({ brandRef: 1, categoryRef: 1 });

vehicleSchema.index({
    brand: "text",
    model: "text",
    variant: "text",
    description: "text",
});

vehicleSchema.pre(/^find/, function () {
    this.where({ deletedAt: null });
});

vehicleSchema.pre("save", function () {
    if (!this.slug) {
        const base = `${this.brand}-${this.model}-${this.year}-${this._id}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        this.slug = base;
    }
});

export default mongoose.model("Vehicle", vehicleSchema);