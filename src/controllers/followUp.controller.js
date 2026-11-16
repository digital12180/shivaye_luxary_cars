import mongoose from "mongoose";
import FollowUp from "../models/followUp.js";
import Lead from "../models/Lead.js";
import Vehicle from "../models/Vehicle.js"
import { ok, fail } from "../utils/response.js";

// export const listFollowUps = async (req, res, next) => {
//     try {
//         const page = Number(req.query.page) || 1;
//         const limit = Number(req.query.limit) || 20;
//         const { status, leadId, assignedTo, dueDate } = req.query;

//         const filter = {};
//         if (status) filter.status = status;
//         if (leadId) filter.lead = leadId;
//         if (assignedTo) filter.assignedTo = assignedTo;

//         if (dueDate) {
//             const start = new Date(dueDate);
//             start.setHours(0, 0, 0, 0);
//             const end = new Date(dueDate);
//             end.setHours(23, 59, 59, 999);
//             filter.dueDate = { $gte: start, $lte: end };
//         }

//         const [data, total] = await Promise.all([
//             FollowUp.find(filter)
//                 .populate({
//                     path: "lead",
//                     select: "leadNumber interestedVehicle status customer",
//                     populate: {
//                         path: "customer",
//                         select: "name email phone city",
//                     },
//                 })
//                 .populate("vehicle", "stockId brand model variant year price images slug")
//                 .populate("assignedTo", "name")
//                 .sort("dueDate")
//                 .skip((page - 1) * limit)
//                 .limit(limit),
//             FollowUp.countDocuments(filter),
//         ]);

//         return ok(res, {
//             data,
//             pagination: { total, page, limit, pages: Math.ceil(total / limit) },
//         });
//     } catch (err) {
//         next(err);
//     }
// };

export const listFollowUps = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { status, leadId, assignedTo, dueDate } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (leadId) filter.lead = leadId;
        if (assignedTo) filter.assignedTo = assignedTo;

        if (dueDate) {
            const start = new Date(dueDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(dueDate);
            end.setHours(23, 59, 59, 999);
            filter.dueDate = { $gte: start, $lte: end };
        }

        let [data, total] = await Promise.all([
            FollowUp.find(filter)
                .populate({
                    path: "lead",
                    select: "leadNumber interestedVehicle status customer",
                    populate: { path: "customer", select: "name email phone city" },
                })
                .populate("vehicle", "stockId brand model variant year price images slug")
                .populate("assignedTo", "name")
                .sort("dueDate")
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),               // <-- lean for plain objects
            FollowUp.countDocuments(filter),
        ]);

        // Defensive: overdue "Upcoming" ko "Missed" dikhao
        const now = new Date();
        data = data.map((fu) => {
            if (fu.status === "Upcoming" && fu.dueDate && new Date(fu.dueDate) < now) {
                return { ...fu, status: "Missed" };
            }
            return fu;
        });

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};


export const createFollowUp = async (req, res, next) => {
    try {
        const { lead: leadId, vehicle: vehicleId, dueDate, time, status, nextAction, assignedTo } = req.body;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        const lead = await Lead.findById(leadId);
        if (!lead) return fail(res, "Lead not found", 404);

        // Auto-missed agar dueDate past me hai
        const isOverdue = new Date(dueDate) < new Date();
        const finalStatus = status || (isOverdue ? "Missed" : "Upcoming");

        const followUp = await FollowUp.create({
            lead: lead._id,
            vehicle: vehicle._id,
            assignedTo: assignedTo || lead.assignedTo || req.user._id,
            dueDate: new Date(dueDate),
            time,
            status: finalStatus,
            nextAction,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        // Sync with Lead's nextFollowUpAt only if upcoming
        if (finalStatus === "Upcoming") {
            lead.nextFollowUpAt = new Date(dueDate);
            await lead.save();
        }

        return ok(res, followUp, "Follow-up scheduled", 201);
    } catch (err) {
        next(err);
    }
};

export const updateFollowUp = async (req, res, next) => {
    try {
        const { dueDate, time, status, nextAction, assignedTo } = req.body;

        const followUp = await FollowUp.findById(req.params.id);
        if (!followUp) return fail(res, "Follow-up not found", 404);

        if (dueDate) followUp.dueDate = new Date(dueDate);
        if (time) followUp.time = time;
        if (status) followUp.status = status;
        if (nextAction) followUp.nextAction = nextAction;
        if (assignedTo) followUp.assignedTo = assignedTo;

        // Re-evaluate: agar Upcoming hai par date past me chali gayi -> Missed
        if (
            followUp.status === "Upcoming" &&
            followUp.dueDate &&
            followUp.dueDate < new Date()
        ) {
            followUp.status = "Missed";
        }

        followUp.updatedBy = req.user._id;
        await followUp.save();

        // Sync with Lead's nextFollowUpAt
        const lead = await Lead.findById(followUp.lead);
        if (lead) {
            if (followUp.status === "Upcoming") {
                lead.nextFollowUpAt = followUp.dueDate;
            } else if (lead.nextFollowUpAt && lead.nextFollowUpAt.getTime() === followUp.dueDate.getTime()) {
                // Agar yahi follow-up lead ka next tha aur ab Missed ho gaya -> clear
                lead.nextFollowUpAt = null;
            }
            await lead.save();
        }

        return ok(res, followUp, "Follow-up updated");
    } catch (err) {
        next(err);
    }
};

export const deleteFollowUp = async (req, res, next) => {
    try {
        const followUp = await FollowUp.findById(req.params.id);
        if (!followUp) return fail(res, "Follow-up not found", 404);

        followUp.deletedAt = new Date();
        followUp.updatedBy = req.user._id;
        await followUp.save();

        return ok(res, {}, "Follow-up deleted");
    } catch (err) {
        next(err);
    }
};

export const GetSingleFollowUp = async (req, res, next) => {
    try {

        const followUp = await FollowUp.findById(req.params.id).populate({
            path: "lead",
            select: "leadNumber interestedVehicle status customer",
            populate: {
                path: "customer",
                select: "name email phone city",
            },
        })
            .populate("vehicle", "stockId brand model variant year price images slug")
            .populate("assignedTo", "name");

        if (!followUp) return fail(res, "Follow-up not found", 404);

        return ok(res, followUp, "Follow-up retrieved");
    } catch (err) {
        next(err);
    }
};