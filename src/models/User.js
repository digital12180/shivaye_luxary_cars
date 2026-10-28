import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: { type: String, trim: true },
    password: {
      type: String,
      required: true,
      select: false,
      minlength: 8,
    },

    // 🔴 Ab role string hi rahega (jaise: "admin", "sales_manager")
    role: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    // 🔴 Dynamic permissions (jaise: "Category_read", "Leads_create")
    permissions: {
      type: [String],
      default: [],
    },

    profileImage: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
      index: true,
    },
    isActive: { type: Boolean, default: true },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    refreshTokenHash: { type: String, select: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.pre(/^find/, function () {
  this.where({ deletedAt: null });
});

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model("User", userSchema);