import mongoose from "mongoose";

const brandSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },

        slug: {
            type: String,
            unique: true,
            trim: true,
            lowercase: true,
            index: true,
        },

        logo: {
            url: { type: String, default: null },
            publicId: { type: String, default: null },
        },

        description: {
            type: String,
            trim: true,
        },

        country: {
            type: String,
            trim: true,
            default: null,
        },

        foundedYear: {
            type: Number,
            default: null,
        },

        website: {
            type: String,
            trim: true,
            default: null,
        },

        // Brand tier — useful for "Luxury SUV" style filters
        tier: {
            type: String,
            enum: ["luxury", "premium", "mass_market", "budget", "other"],
            default: "luxury",
            index: true,
        },

        // Optional: display order in dropdowns
        displayOrder: {
            type: Number,
            default: 0,
        },

        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        isFeatured: {
            type: Boolean,
            default: false,
            index: true,
        },

        // SEO
        seo: {
            metaTitle: { type: String, trim: true },
            metaDescription: { type: String, trim: true },
            keywords: [{ type: String, trim: true }],
        },

        // Audit
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Text search
brandSchema.index({ name: "text", description: "text" });

// Soft delete filter
brandSchema.pre(/^find/, function () {
    this.where({ deletedAt: null });
});

// Auto-generate slug
brandSchema.pre("save", function () {
    if (!this.slug || this.isModified("name")) {
        this.slug = this.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }
});

export default mongoose.model("Brand", brandSchema);