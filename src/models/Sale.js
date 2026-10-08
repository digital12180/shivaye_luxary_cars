import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },   // "RC Transfer", "NOC"
    url: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    /* ============ Core References ============ */
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
    },

    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      default: null,
    },

    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
      index: true,
    },

    salesExecutive: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    /* ============ Frozen Vehicle Snapshot (BRD 31.1) ============ */
    vehicleSnapshot: {
      stockId: { type: String, default: null },
      brand: { type: String, required: true, trim: true },
      model: { type: String, required: true, trim: true },
      variant: { type: String, default: null, trim: true },
      year: { type: Number, required: true },
      fuelType: { type: String, default: null },
      transmission: { type: String, default: null },
      color: { type: String, default: null },
      registrationNumber: { type: String, default: null },
      kilometersAtSale: { type: Number, required: true, min: 0 },
    },

    /* ============ Frozen Buyer Snapshot (BRD 31.2) ============ */
    buyerSnapshot: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, default: null, trim: true },
      city: { type: String, default: null, trim: true },
      state: { type: String, default: null, trim: true },
      address: { type: String, default: null, trim: true },
      pincode: { type: String, default: null, trim: true },
    },

    /* ============ Pricing Breakdown (BRD 31.1) ============ */
    pricing: {
      originalPrice: { type: Number, required: true, min: 0 },
      discount: { type: Number, default: 0, min: 0 },
      finalSalePrice: { type: Number, required: true, min: 0 },
      bookingAmount: { type: Number, default: 0, min: 0 },
      amountPaid: { type: Number, default: 0, min: 0 },
      amountDue: { type: Number, default: 0, min: 0 },
      paymentStatus: {
        type: String,
        enum: ["pending", "partial", "paid", "refunded"],
        default: "pending",
        index: true,
      },
      paymentMethod: {
        type: String,
        enum: ["cash", "bank_transfer", "cheque", "loan", "mixed", "other", null],
        default: null,
      },
    },

    saleType: {
      type: String,
      enum: ["full_payment", "finance", "exchange", "mixed", "other"],
      default: "full_payment",
      index: true,
    },

    /* ============ Sale Metadata ============ */
    invoiceNumber: { type: String, trim: true, index: true, unique: true, sparse: true },
    saleDate: { type: Date, required: true, default: Date.now, index: true },

    // Source & attribution (BRD 15)
    source: {
      type: String,
      enum: [
        "google_ads", "facebook_ads", "instagram", "organic",
        "direct_website", "whatsapp", "phone", "walk_in",
        "referral", "manual", "other",
      ],
      default: "direct_website",
      index: true,
    },

    /* ============ Delivery ============ */
    deliveryDate: { type: Date, default: null },
    deliveryStatus: {
      type: String,
      enum: ["pending", "scheduled", "delivered", "cancelled"],
      default: "pending",
      index: true,
    },
    deliveredAt: { type: Date, default: null },

    /* ============ Post-Sale ============ */
    warranty: {
      hasWarranty: { type: Boolean, default: false },
      validUntil: { type: Date, default: null },
      notes: { type: String, trim: true },
    },

    exchange: {
      hasExchange: { type: Boolean, default: false },
      vehicleDetails: { type: String, trim: true },
      exchangeValue: { type: Number, default: 0, min: 0 },
    },

    finance: {
      isFinanced: { type: Boolean, default: false },
      financierName: { type: String, trim: true },
      loanAmount: { type: Number, default: null, min: 0 },
      loanTenureMonths: { type: Number, default: null },
      emiAmount: { type: Number, default: null, min: 0 },
    },

    /* ============ Documents ============ */
    documents: [documentSchema],

    /* ============ Commission ============ */
    salesCommission: { type: Number, default: 0, min: 0 },

    notes: { type: String, default: null, trim: true },

    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/* ============ Indexes ============ */
saleSchema.index({ saleDate: -1 });
saleSchema.index({ salesExecutive: 1, saleDate: -1 });
saleSchema.index({ "vehicleSnapshot.brand": 1 });
saleSchema.index({ source: 1, saleDate: -1 });
saleSchema.index({ "pricing.paymentStatus": 1 });
saleSchema.index({ deliveryStatus: 1 });

/* Prevent double-sale: one active sale per vehicle */
saleSchema.index(
  { vehicle: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

/* Soft delete */
saleSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

/* Auto-compute amountDue */
saleSchema.pre("save", function (next) {
  if (this.pricing) {
    this.pricing.amountDue = Math.max(
      0,
      (this.pricing.finalSalePrice || 0) - (this.pricing.amountPaid || 0)
    );
  }
  next();
});

export default mongoose.model("Sale", saleSchema);