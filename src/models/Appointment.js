import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema(
  {
    rating: { type: Number, min: 1, max: 5, default: null },
    comments: { type: String, trim: true },
    interestedInBuying: { type: Boolean, default: null },
    submittedAt: { type: Date, default: null },
  },
  { _id: false }
);

const appointmentSchema = new mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,        
      index: true,
    },
    customerName: { type: String, trim: true },
    customerPhone: { type: String, trim: true },

    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
      index: true,
    },

    // ✅ NEW: For manual text input (e.g., "BMW 5 Series")
    vehicleName: { type: String, trim: true },

    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },

    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    type: {
      type: String,
      enum: ["showroom_visit", "test_drive"],
      default: "showroom_visit",
      index: true,
    },

    // ✅ UPDATED: Status enum to match UI
    status: {
      type: String,
      enum: [
        "Requested",
        "Confirmed",
        "Completed",
        "Rescheduled",
        "Cancelled",
      ],
      default: "Requested",
      index: true,
    },

    scheduledAt: {
      type: Date,
      required: true,
      index: true,
    },
    time: { type: String, trim: true },

    durationMinutes: { type: Number, default: 30, min: 15 },
    location: { type: String, trim: true },
    showroomAddress: { type: String, trim: true },

    // ... (source and attribution remain same)
    source: {
      type: String,
      enum: [
        "google_ads", "facebook_ads", "instagram", "organic",
        "direct_website", "whatsapp", "phone", "walk_in",
        "referral", "manual", "other",
      ],
      default: "manual",
    },

    attribution: {
      utmSource: { type: String, default: null },
      utmMedium: { type: String, default: null },
      utmCampaign: { type: String, default: null },
      gclid: { type: String, default: null },
      fbclid: { type: String, default: null },
      landingPage: { type: String, default: null },
    },
    notes: { type: String, trim: true },

    cancelledAt: { type: Date, default: null },
    cancelledReason: { type: String, trim: true, default: null },
    cancelledReasonCategory: {
      type: String,
      enum: [
        "customer_rescheduled", "customer_not_interested",
        "vehicle_unavailable", "weather", "staff_unavailable",
        "other", null,
      ],
      default: null,
    },

    rescheduledFrom: { type: Date, default: null },
    rescheduledCount: { type: Number, default: 0 },

    completedAt: { type: Date, default: null },
    customerConfirmed: { type: Boolean, default: false },
    confirmedAt: { type: Date, default: null },

    feedback: feedbackSchema,

    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

appointmentSchema.index({ status: 1, scheduledAt: 1 });
appointmentSchema.index({ assignedTo: 1, scheduledAt: 1 });
appointmentSchema.index({ vehicle: 1, scheduledAt: 1 });

appointmentSchema.pre(/^find/, function () {
  this.where({ deletedAt: null });
});

export default mongoose.model("Appointment", appointmentSchema);