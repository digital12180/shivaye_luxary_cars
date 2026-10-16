import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
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

        description: {
            type: String,
            trim: true,
        },

        // Optional icon/image for frontend display
        image: {
            url: { type: String, default: null },
            publicId: { type: String, default: null },
        },

        // Category type — helps group in UI
        type: {
            type: String,
            enum: ["body_type", "segment", "fuel_type", "other"],
            default: "body_type",
            index: true,
        },

        // Example: SUV, Sedan, Hatchback, Coupe, Convertible, MPV
        bodyType: {
            type: String,
            trim: true,
            default: null,
        },

        // Display order
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

        seo: {
            metaTitle: { type: String, trim: true },
            metaDescription: { type: String, trim: true },
            keywords: [{ type: String, trim: true }],
        },

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

categorySchema.index({ name: "text", description: "text" });

categorySchema.pre(/^find/, function () {
    this.where({ deletedAt: null });
});

categorySchema.pre("save", function () {
    if (!this.slug || this.isModified("name")) {
        this.slug = this.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }
});

export default mongoose.model("Category", categorySchema);