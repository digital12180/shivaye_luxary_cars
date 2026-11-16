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

        const filter = {
            deletedAt: null,
        };
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

        // ✅ Counts filter — status hata do, taaki har status ka count mile
        const countsFilter = { ...filter };
        delete countsFilter.status;

        const STATUSES = ["Upcoming", "Completed", "Missed", "Cancelled"];

        const [rawData, total, statusAgg] = await Promise.all([
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
                .lean(),
            FollowUp.countDocuments(filter),
            FollowUp.aggregate([
                { $match: countsFilter },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
        ]);

        // ── Defensive: overdue "Upcoming" → "Missed" (list ke liye) ──
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const data = rawData.map((fu) => {
            if (
                fu.status === "Upcoming" &&
                fu.dueDate &&
                new Date(fu.dueDate) < startOfToday
            ) {
                return { ...fu, status: "Missed" };
            }
            return fu;
        });

        // ── Counts build karo (same defensive shift apply) ──
        const counts = STATUSES.reduce((acc, s) => {
            acc[s] = 0;
            return acc;
        }, {});

        statusAgg.forEach(({ _id, count }) => {
            if (!_id) return;
            counts[_id] = count;
        });

        // ✅ Defensive shift counts me bhi: overdue Upcoming ko Missed me move karo
        const overdueUpcomingCount = await FollowUp.countDocuments({
            ...countsFilter,
            status: "Upcoming",
            dueDate: { $lt: startOfToday },
        });

        if (overdueUpcomingCount > 0) {
            counts.Upcoming = Math.max(0, counts.Upcoming - overdueUpcomingCount);
            counts.Missed = counts.Missed + overdueUpcomingCount;
        }

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
            counts,
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
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        // Agar dueDate past me hai (kal se pehle) aur status Upcoming hai -> reject
        if (status === "Upcoming" && new Date(dueDate) < startOfToday) {
            return fail(res, "Upcoming follow-up ki due date aaj ya future me honi chahiye", 400);
        }

        // Auto-missed agar dueDate kal se pehle ki hai
        const isPast = new Date(dueDate) < startOfToday;
        const finalStatus = status || (isPast ? "Missed" : "Upcoming");

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

        // ── 1. Validation PEHLE (save se pehle) ──────────────────
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const effectiveDueDate = dueDate ? new Date(dueDate) : followUp.dueDate;
        const effectiveStatus = status || followUp.status;

        if (
            effectiveStatus === "Upcoming" &&
            effectiveDueDate < startOfToday
        ) {
            return fail(
                res,
                "Upcoming follow-up ki due date aaj ya future me honi chahiye",
                400
            );
        }

        // ── 2. Fields update karo ────────────────────────────────
        if (dueDate) followUp.dueDate = new Date(dueDate);
        if (time) followUp.time = time;
        if (status) followUp.status = status;
        if (nextAction) followUp.nextAction = nextAction;
        if (assignedTo) followUp.assignedTo = assignedTo;

        followUp.updatedBy = req.user._id;
        await followUp.save();

        // ── 3. Lead ka nextFollowUpAt sync karo ─────────────────
        const lead = await Lead.findById(followUp.lead);
        if (lead) {
            if (followUp.status === "Upcoming") {
                lead.nextFollowUpAt = followUp.dueDate;
            } else if (
                lead.nextFollowUpAt &&
                followUp.dueDate &&
                lead.nextFollowUpAt.getTime() === followUp.dueDate.getTime()
            ) {
                // Yeh hi follow-up lead ka "next" tha, ab Missed/Completed ho gaya -> clear
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