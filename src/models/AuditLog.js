import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    action: {
      type: String,
      required: true,
      trim: true,
    },

    module: {
      type: String,
      required: true,
      trim: true,
    },

    recordId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    description: {
      type: String,
      trim: true,
    },

    ipAddress: {
      type: String,
      default: null,
    },

    userAgent: {
      type: String,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("AuditLog", auditLogSchema);