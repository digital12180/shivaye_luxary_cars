import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    slug: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    source: {
      type: String,
      enum: ["google_ads", "facebook_ads", "instagram", "organic", "other"],
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["marketing", "festive_offer"],
      default: "marketing",
      index: true,
    },

    status: {
      type: String,
      enum: ["draft", "scheduled", "live", "paused", "ended"],
      default: "draft",
      index: true,
    },

    // Platform-side identifiers (BRD 11.2)
    platformCampaignId: { type: String, default: null, trim: true },

    // UTM block (BRD 11.2)
    utm: {
      source: { type: String, default: null, trim: true },
      medium: { type: String, default: null, trim: true },
      campaign: { type: String, default: null, trim: true },
      term: { type: String, default: null, trim: true },
      content: { type: String, default: null, trim: true },
    },

    // Content
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    bannerImage: { type: String, default: null },
    landingPageUrl: { type: String, default: null, trim: true },

    // Festive template (BRD 28.1, 36)
    festive: {
      offerTitle: { type: String, trim: true },
      offerMessage: { type: String, trim: true },
      validityText: { type: String, trim: true },
      ctaText: { type: String, default: "View Cars", trim: true },
      benefit: { type: String, trim: true },
      badgeText: { type: String, trim: true },
    },

    // Selected vehicles for this campaign (BRD 28.2)
    selectedVehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" }],

    // Offer (optional — used by festive campaigns)
    offerPrice: { type: Number, default: null, min: 0 },
    benefit: { type: String, default: null, trim: true },
    ctaText: { type: String, default: "View Cars", trim: true },

    // Schedule
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },

    // Budget / spend (for ROI reporting — BRD 15)
    budget: { type: Number, default: null, min: 0 },
    spend: { type: Number, default: 0, min: 0 },

    // Denormalized metrics (updated by triggers/aggregations)
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
campaignSchema.index({ source: 1, type: 1 });
campaignSchema.index({ "utm.campaign": 1 });

// Text search
campaignSchema.index({ name: "text", title: "text", description: "text" });

// Soft delete
campaignSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

// Auto slug
campaignSchema.pre("save", function (next) {
  if (!this.slug && this.name) {
    this.slug = `${this.name}-${this._id || Date.now()}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  next();
});

// Validate date range
campaignSchema.pre("validate", function (next) {
  if (this.startDate && this.endDate && this.startDate >= this.endDate) {
    return next(new Error("endDate must be after startDate"));
  }
  next();
});

export default mongoose.model("Campaign", campaignSchema);