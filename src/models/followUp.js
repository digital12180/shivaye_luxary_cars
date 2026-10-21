import mongoose from "mongoose";

const followUpSchema = new mongoose.Schema(
    {
        lead: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Lead",
            required: true,
            index: true,
        },
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            required: true,
        },
        vehicle: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
            default: null,
        },
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        
        // From Modal
        dueDate: {
            type: Date,
            required: true,
            index: true,
        },
        time: {
            type: String, // e.g., "14:30" or "02:30 PM"
            trim: true,
        },
        status: {
            type: String,
            enum: ["Upcoming", "Completed", "Missed", "Cancelled"],
            default: "Upcoming",
            index: true,
        },
        nextAction: {
            type: String,
            trim: true,
        },

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

followUpSchema.pre(/^find/, function () {
    this.where({ deletedAt: null });
});

export default mongoose.model("FollowUp", followUpSchema);