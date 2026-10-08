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
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
      index: true,
    },

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
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "scheduled",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      default: "scheduled",
      index: true,
    },

    scheduledAt: {
      type: Date,
      required: true,
      index: true,
    },

    durationMinutes: { type: Number, default: 30, min: 15 },

    // Showroom / test-drive location
    location: { type: String, trim: true },
    showroomAddress: { type: String, trim: true },

    // Source & attribution (BRD 11)
    source: {
      type: String,
      enum: [
        "google_ads",
        "facebook_ads",
        "instagram",
        "organic",
        "direct_website",
        "whatsapp",
        "phone",
        "walk_in",
        "referral",
        "manual",
        "other",
      ],
      default: "direct_website",
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

    // Cancellation
    cancelledAt: { type: Date, default: null },
    cancelledReason: { type: String, trim: true, default: null },
    cancelledReasonCategory: {
      type: String,
      enum: [
        "customer_rescheduled",
        "customer_not_interested",
        "vehicle_unavailable",
        "weather",
        "staff_unavailable",
        "other",
        null,
      ],
      default: null,
    },

    // Reschedule tracking
    rescheduledFrom: { type: Date, default: null },
    rescheduledCount: { type: Number, default: 0 },

    // Completion
    completedAt: { type: Date, default: null },
    customerConfirmed: { type: Boolean, default: false },
    confirmedAt: { type: Date, default: null },

    // Post-appointment feedback
    feedback: feedbackSchema,

    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Compound indexes
appointmentSchema.index({ status: 1, scheduledAt: 1 });
appointmentSchema.index({ assignedTo: 1, scheduledAt: 1 });
appointmentSchema.index({ customer: 1, status: 1 });
appointmentSchema.index({ vehicle: 1, scheduledAt: 1 });

// Soft delete
appointmentSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

export default mongoose.model("Appointment", appointmentSchema);