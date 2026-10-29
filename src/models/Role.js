import mongoose from "mongoose";


const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    description: { type: String, trim: true },
    
    isSystemRole: { type: Boolean, default: false }, 
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Soft delete middleware
roleSchema.pre(/^find/, function () {
  this.where({ deletedAt: null });
});

export default mongoose.model("Role", roleSchema);