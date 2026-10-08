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

    role: {
      type: String,
      required: true,
      index: true,
    },
    permissions: [{ type: String, trim: true }],

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

userSchema.index({ email: 1, deletedAt: 1 });
userSchema.index({ role: 1, status: 1 });

userSchema.pre(/^find/, function () {
  this.where({ deletedAt: null });
  // next();
});

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
  // next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model("User", userSchema);