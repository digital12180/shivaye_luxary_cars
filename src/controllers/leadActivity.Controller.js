import LeadActivity from "../models/leadActivity.js";
import Lead from "../models/Lead.js";
import { ok, fail } from "../utils/response.js";

/* ============================================================
   GET /api/v1/lead-activities
   Query: leadId, type, performedBy, fromDate, toDate, page, limit
   ============================================================ */
export const listActivities = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { leadId, type, performedBy, fromDate, toDate, outcome } = req.query;

        const filter = {};
        if (leadId) filter.lead = leadId;
        if (type) filter.type = type;
        if (outcome) filter.outcome = outcome;

        // Sales exec can only view activities of their own leads
        if (req.user.role === "sales_executive") {
            filter.performedBy = req.user._id;
        } else if (performedBy) {
            filter.performedBy = performedBy;
        }

        if (fromDate || toDate) {
            filter.createdAt = {};
            if (fromDate) filter.createdAt.$gte = new Date(fromDate);
            if (toDate) filter.createdAt.$lte = new Date(toDate);
        }

        const [data, total] = await Promise.all([
            LeadActivity.find(filter)
                .populate("lead", "status source customer vehicle")
                .populate("performedBy", "name role")
                .sort("-createdAt")
                .skip((page - 1) * limit)
                .limit(limit),
            LeadActivity.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   GET /api/v1/lead-activities/:id
   ============================================================ */
export const getActivity = async (req, res, next) => {
    try {
        const activity = await LeadActivity.findById(req.params.id)
            .populate("lead", "status source customer")
            .populate("performedBy", "name role");

        if (!activity) return fail(res, "Activity not found", 404);
        return ok(res, activity);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   GET /api/v1/lead-activities/lead/:leadId/timeline
   Full timeline for a single lead (used in CRM lead detail page)
   ============================================================ */
export const getLeadTimeline = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.leadId);
        if (!lead) return fail(res, "Lead not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(lead.assignedTo) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        const activities = await LeadActivity.find({ lead: lead._id })
            .populate("performedBy", "name role")
            .sort("-createdAt")
            .limit(200);

        return ok(res, activities);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   POST /api/v1/lead-activities
   Body: { lead, type, title, description, outcome, durationSeconds,
           attachments, meta, direction, scheduledAt }
   ============================================================ */
export const createActivity = async (req, res, next) => {
    try {
        const { lead: leadId, type } = req.body;
        if (!leadId || !type) return fail(res, "lead and type are required", 400);

        const lead = await Lead.findById(leadId);
        if (!lead) return fail(res, "Lead not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(lead.assignedTo) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        const activity = await LeadActivity.create({
            ...req.body,
            lead: lead._id,
            customer: lead.customer,
            performedBy: req.user._id,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        // Update lead counters / touchpoints
        const update = {
            $inc: { totalActivities: 1 },
            $set: { lastContactedAt: new Date(), updatedBy: req.user._id },
        };

        // If activity is a call/whatsapp/email → set first contact timestamp
        if (
            ["call", "whatsapp", "email", "sms"].includes(type) &&
            !lead.firstContactedAt
        ) {
            update.$set.firstContactedAt = new Date();
        }

        await Lead.updateOne({ _id: lead._id }, update);

        return ok(res, activity, "Activity logged", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   PATCH /api/v1/lead-activities/:id
   Only allow edits by the creator (or super_admin / sales_manager)
   ============================================================ */
export const updateActivity = async (req, res, next) => {
    try {
        const activity = await LeadActivity.findById(req.params.id);
        if (!activity) return fail(res, "Activity not found", 404);

        const isOwner = String(activity.performedBy) === String(req.user._id);
        const isPrivileged = ["super_admin", "sales_manager"].includes(req.user.role);
        if (!isOwner && !isPrivileged)
            return fail(res, "Not authorized to edit this activity", 403);

        const protectedFields = ["lead", "customer", "performedBy", "deletedAt"];
        protectedFields.forEach((f) => delete req.body[f]);

        Object.assign(activity, req.body);
        activity.updatedBy = req.user._id;
        await activity.save();

        return ok(res, activity, "Activity updated");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   DELETE /api/v1/lead-activities/:id (soft delete)
   ============================================================ */
export const deleteActivity = async (req, res, next) => {
    try {
        const activity = await LeadActivity.findById(req.params.id);
        if (!activity) return fail(res, "Activity not found", 404);

        const isOwner = String(activity.performedBy) === String(req.user._id);
        const isPrivileged = ["super_admin", "sales_manager"].includes(req.user.role);
        if (!isOwner && !isPrivileged)
            return fail(res, "Not authorized", 403);

        activity.deletedAt = new Date();
        activity.isActive = false;
        activity.updatedBy = req.user._id;
        await activity.save();

        // Decrement counter on the lead
        await Lead.updateOne(
            { _id: activity.lead },
            { $inc: { totalActivities: -1 } }
        );

        return ok(res, {}, "Activity deleted");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   GET /api/v1/lead-activities/stats/summary
   Dashboard: count by type, today's calls, WhatsApp count etc.
   ============================================================ */
export const getActivityStats = async (req, res, next) => {
    try {
        const scopeFilter =
            req.user.role === "sales_executive" ? { performedBy: req.user._id } : {};

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const [byType, todayCount, upcoming, topPerformers] = await Promise.all([
            LeadActivity.aggregate([
                { $match: scopeFilter },
                { $group: { _id: "$type", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            LeadActivity.countDocuments({
                ...scopeFilter,
                createdAt: { $gte: startOfDay, $lte: endOfDay },
            }),
            LeadActivity.countDocuments({
                ...scopeFilter,
                scheduledAt: { $gte: new Date() },
                completedAt: null,
            }),
            LeadActivity.aggregate([
                { $match: { ...scopeFilter, performedBy: { $ne: null } } },
                { $group: { _id: "$performedBy", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 },
                {
                    $lookup: {
                        from: "users",
                        localField: "_id",
                        foreignField: "_id",
                        as: "user",
                    },
                },
                { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 0,
                        userId: "$_id",
                        name: "$user.name",
                        count: 1,
                    },
                },
            ]),
        ]);

        return ok(res, {
            totalToday: todayCount,
            upcoming,
            byType,
            topPerformers,
        });
    } catch (err) {
        next(err);
    }
};