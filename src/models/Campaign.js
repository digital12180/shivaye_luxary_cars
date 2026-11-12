import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    // Matches "Campaign name" input
    name: { type: String, required: true, trim: true },

    slug: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    // Not in form but required by existing logic, set defaults
    source: {
      type: String,
      enum: ["google_ads", "facebook_ads", "instagram", "organic", "other", "internal"],
      default: "internal",
      index: true,
    },

    type: {
      type: String,
      enum: ["marketing", "festive_offer"],
      default: "marketing",
      index: true,
    },

    // UPDATED: Matches screenshot dropdown ["Draft", "Active", "Paused", "Ended"]
    status: {
      type: String,
      enum: ["Draft", "Active", "Paused", "Ended"],
      default: "Draft",
      index: true,
    },

    // Matches "Headline" input
    title: { type: String, trim: true }, // Used as Headline

    // Matches "Message" textarea
    description: { type: String, trim: true },

    // Matches "Banner image" upload
    bannerImage: { type: String, default: null },

    landingPageUrl: { type: String, default: null, trim: true },

    // Matches "Discount amount"
    discountAmount: { type: Number, default: 0, min: 0 },

    // Matches "Call to action"
    ctaText: { type: String, default: "Book a test drive", trim: true },

    // Matches "Goodies" input (Free car cover, 1-year insurance)
    goodies: [{ type: String, trim: true }],


    // 👇 ADD THIS LINE 👇
    selectedVehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" }],
    // Matches "Start date" and "End date"
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },

    // Existing metrics
    budget: { type: Number, default: null, min: 0 },
    spend: { type: Number, default: 0, min: 0 },
    metrics: {
      totalLeads: { type: Number, default: 0 },
      qualifiedLeads: { type: Number, default: 0 },
      wonLeads: { type: Number, default: 0 },
      lostLeads: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 },
    },

    isActive: { type: Boolean, default: true, index: true },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Compound indexes
campaignSchema.index({ status: 1, startDate: 1, endDate: 1 });

// Soft delete
campaignSchema.pre(/^find/, function () {
  this.where({ deletedAt: null });
});

// Auto slug
campaignSchema.pre("save", function () {
  if (!this.slug && this.name) {
    this.slug = `${this.name}-${this._id || Date.now()}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
});

// Validate date range
campaignSchema.pre("validate", function () {
  if (this.startDate && this.endDate && this.startDate >= this.endDate) {
    throw new Error("endDate must be after startDate");
  }
});

export default mongoose.model("Campaign", campaignSchema);