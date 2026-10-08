import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import Customer from "../models/Customer.js";
import Vehicle from "../models/Vehicle.js";
import { ok, fail } from "../utils/response.js";
import LeadActivity from "../models/leadActivity.js";
import Campaign from "../models/Campaign.js";
import { sendNotification } from "../services/notification.service.js";
import extractAttribution from "../services/attribution.service.js";
import captureIpLocation from "../services/geolocation.service.js";

/* ================= PUBLIC ================= */

// POST /api/v1/leads/public  (website enquiry form — BRD 13)
// POST /api/v1/leads/public
// POST /api/v1/leads/public
export const publicCreateLead = async (req, res, next) => {
    try {
        const attribution = extractAttribution(req);
        const { ip, location } = await captureLocation(req);

        const {
            name, phone, email, city, state,
            vehicle: vehicleId,
            vehicleBrand, vehicleModel,
            source, leadType, requirement,
            budgetMin, budgetMax, notes
        } = req.body;

        if (!name || !phone) return fail(res, "Name and phone are required", 400);

        /* ============================================================
           1. Resolve customer (find or create)
           ============================================================ */
        let customer = await Customer.findOne({ phone });
        if (!customer) {
            customer = await Customer.create({
                name, phone, email, city, state,
                source: source || "direct_website",
                attribution: attribution || {},
                ipAddress: ip || req.ip || req.headers["x-forwarded-for"] || null,
                attribution: attribution,
                ipLocation: location || null,
            });
        }

        /* ============================================================
           2. Resolve campaign (auto-detect by UTM)
           Priority order:
             a) Explicit attribution.utmCampaign (best signal)
             b) attribution.landingPage URL match against campaign.landingPageUrl
             c) Explicit campaignId in body (for manual back-office use)
           ============================================================ */
        let campaign = null;

        if (attribution?.utmCampaign) {
            campaign = await Campaign.findOne({
                "utm.campaign": attribution.utmCampaign,
            }).select("_id source type status");
        }

        if (!campaign && attribution?.landingPage) {
            campaign = await Campaign.findOne({
                landingPageUrl: attribution.landingPage,
            }).select("_id source type status");
        }

        if (!campaign && req.body.campaignId && mongoose.isValidObjectId(req.body.campaignId)) {
            campaign = await Campaign.findOne({ _id: req.body.campaignId })
                .select("_id source type status");
        }

        /* ============================================================
           3. Duplicate lead detection
           Rule: same customer + same vehicle + open status
           within last 30 days → merge into existing lead.
           ============================================================ */
        const DUPLICATE_WINDOW_DAYS = 30;
        const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

        const duplicateFilter = {
            customer: customer._id,
            createdAt: { $gte: since },
            status: { $nin: ["won", "lost"] },
        };
        if (vehicleId) duplicateFilter.vehicle = vehicleId;

        const existingLead = await Lead.findOne(duplicateFilter).sort("-createdAt");

        if (existingLead) {
            // Merge latest attribution
            if (attribution) {
                existingLead.attribution = {
                    ...existingLead.attribution,
                    ...attribution,
                    latestTouchAt: new Date(),
                };
            }

            // Refresh campaign if a new one is detected and none was set
            if (campaign && !existingLead.campaign) {
                existingLead.campaign = campaign._id;
            }

            if (requirement) existingLead.requirement = requirement;
            if (notes) {
                existingLead.notes = [existingLead.notes, notes]
                    .filter(Boolean)
                    .join("\n");
            }
            if (budgetMin || budgetMax) {
                existingLead.budget = {
                    min: budgetMin ?? existingLead.budget?.min ?? null,
                    max: budgetMax ?? existingLead.budget?.max ?? null,
                };
            }

            await existingLead.save();

            // Log re-enquiry activity so CRM timeline sees it
            await LeadActivity.create({
                lead: existingLead._id,
                customer: customer._id,
                type: "system",
                title: "Customer re-enquired",
                description: "Duplicate enquiry captured and merged",
                meta: {
                    attribution: attribution || {},
                    vehicle: vehicleId || null,
                    campaign: campaign?._id || null,
                },

            });

            return ok(
                res,
                { lead: existingLead, isDuplicate: true },
                "Enquiry linked to existing lead",
                200
            );
        }

        /* ============================================================
           4. Validate vehicle (if provided)
           ============================================================ */
        let vehicle = null;
        if (vehicleId && mongoose.isValidObjectId(vehicleId)) {
            vehicle = await Vehicle.findById(vehicleId);
        }

        /* ============================================================
           5. Create new lead
           ============================================================ */
        const lead = await Lead.create({
            customer: customer._id,
            vehicle: vehicle?._id || null,
            campaign: campaign?._id || null,     // ← auto-linked campaign
            leadType: leadType || "buy",
            source: source || customer.source || "direct_website",
            requirement,
            interestedBrand: vehicleBrand || vehicle?.brand,
            interestedModel: vehicleModel || vehicle?.model,
            budget: { min: budgetMin || null, max: budgetMax || null },
            notes,
            attribution: {
                ...(attribution || {}),
                firstTouchAt: new Date(),
                latestTouchAt: new Date(),
            },
            location: {
                country: location.country || customer.ipLocation?.country || null,
                state: location.state || customer.ipLocation?.state || null,
                city: location.city || customer.ipLocation?.city || null,
            },

            ipAddress: ip || req.ip || req.headers["x-forwarded-for"] || null,
            attribution: attribution,
        });

        /* ============================================================
           6. Log initial system activity
           ============================================================ */
        await LeadActivity.create({
            lead: lead._id,
            customer: customer._id,
            type: "system",
            title: "Lead created",
            description: campaign
                ? `Lead created from ${lead.source} (campaign: ${campaign._id})`
                : `Lead created from ${lead.source}`,
            meta: {
                source: lead.source,
                campaign: campaign?._id || null,
                utmCampaign: attribution?.utmCampaign || null,
            },
        });

        return ok(
            res,
            { lead, isDuplicate: false, campaignMatched: !!campaign },
            "Enquiry submitted successfully",
            201
        );
    } catch (err) {
        next(err);
    }
};
/* ============================================================
   Internal helper — safely bumps campaign counters
   ============================================================ */
const bumpCampaignMetric = async (campaignId, field, delta = 1) => {
    if (!campaignId) return;
    try {
        await Campaign.updateOne(
            { _id: campaignId },
            { $inc: { [`metrics.${field}`]: delta } }
        );
    } catch (err) {
        // Non-fatal — log and continue
        console.error("Campaign metric bump failed:", err.message);
    }
};
/* ================= CRM ================= */                                                                                                                                                                  

// GET /api/v1/leads
export const listLeads = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const {
            status, source, assignedTo, leadType, priority,
            city, search, fromDate, toDate,
            followUpToday, overdue,
        } = req.query;

        const filter = {};

        // Sales executives only see their assigned leads
        if (req.user.role === "sales_executive") {
            filter.assignedTo = req.user._id;
        } else if (assignedTo) {
            filter.assignedTo = assignedTo;
        }

        if (status) filter.status = status;
        if (source) filter.source = source;
        if (leadType) filter.leadType = leadType;
        if (priority) filter.priority = priority;
        if (city) filter["location.city"] = new RegExp(city, "i");

        if (fromDate || toDate) {
            filter.createdAt = {};
            if (fromDate) filter.createdAt.$gte = new Date(fromDate);
            if (toDate) filter.createdAt.$lte = new Date(toDate);
        }

        if (followUpToday === "true") {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const end = new Date();
            end.setHours(23, 59, 59, 999);
            filter.nextFollowUpAt = { $gte: start, $lte: end };
        }

        if (overdue === "true") {
            filter.nextFollowUpAt = { $lt: new Date() };
            filter.status = { $nin: ["won", "lost"] };
        }

        if (search) {
            filter.$or = [
                { requirement: new RegExp(search, "i") },
                { notes: new RegExp(search, "i") },
                { interestedBrand: new RegExp(search, "i") },
                { interestedModel: new RegExp(search, "i") },
            ];
        }

        const [data, total] = await Promise.all([
            Lead.find(filter)
                .populate("customer", "name phone email city source")
                .populate("vehicle", "brand model year price images slug status")
                .populate("assignedTo", "name email role")
                .sort("-createdAt")
                .skip((page - 1) * limit)
                .limit(limit),
            Lead.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/leads/:id
export const getLead = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id)
            .populate("customer", "name phone email city state source attribution")
            .populate("vehicle", "brand model variant year price images slug status")
            .populate("assignedTo", "name email role")
            .populate("campaign", "name")
            .populate("stageHistory.changedBy", "name")
            .populate("createdBy", "name")
            .populate("updatedBy", "name");

        if (!lead) return fail(res, "Lead not found", 404);

        // Sales executives can only view own leads
        if (
            req.user.role === "sales_executive" &&
            String(lead.assignedTo?._id) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized to view this lead", 403);
        }

        return ok(res, lead);
    } catch (err) {
        next(err);
    }
};

// POST /api/v1/leads  (manual entry / walk-in — BRD 11.1)
export const createLead = async (req, res, next) => {
    try {
        const { customer: customerId, ...rest } = req.body;

        if (!customerId) return fail(res, "Customer is required", 400);
        const customer = await Customer.findById(customerId);
        if (!customer) return fail(res, "Customer not found", 404);

        const lead = await Lead.create({
            ...rest,
            customer: customer._id,
            createdBy: req.user._id,
            updatedBy: req.user._id,
            attribution: {
                ...(rest.attribution || {}),
                firstTouchAt: new Date(),
                latestTouchAt: new Date(),
            },
        });
        await bumpCampaignMetric(campaign?._id, "totalLeads", 1);
        return ok(res, lead, "Lead created", 201);
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/leads/:id
export const updateLead = async (req, res, next) => {
    try {
        const protectedFields = [
            "stageHistory", "wonAt", "lostAt", "closedAt",
            "createdBy", "deletedAt", "isDuplicate", "duplicateOf",
        ];
        protectedFields.forEach((f) => delete req.body[f]);

        const lead = await Lead.findById(req.params.id);
        if (!lead) return fail(res, "Lead not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(lead.assignedTo) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        Object.assign(lead, req.body);
        lead.updatedBy = req.user._id;
        await lead.save();
        // Sync campaign metrics when a lead moves to a milestone stage
        if (lead.campaign) {
            if (status === "won") {
                await bumpCampaignMetric(lead.campaign, "wonLeads", 1);
                if (lead.dealValue) {
                    await Campaign.updateOne(
                        { _id: lead.campaign },
                        { $inc: { "metrics.revenue": lead.dealValue } }
                    );
                }
            } else if (status === "lost") {
                await bumpCampaignMetric(lead.campaign, "lostLeads", 1);
            } else if (
                ["qualified", "car_shared", "visit_scheduled", "test_drive", "negotiation", "reserved", "booked"]
                    .includes(status)
            ) {
                await bumpCampaignMetric(lead.campaign, "qualifiedLeads", 1);
            }
        }

        return ok(res, lead, "Lead updated");
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/leads/:id/status  (BRD 9.3 pipeline)
export const updateLeadStatus = async (req, res, next) => {
    try {
        const { status, note, lostReason, lostReasonCategory } = req.body;

        const allowed = [
            "new", "contacted", "qualified", "car_shared", "visit_scheduled",
            "test_drive", "negotiation", "reserved", "booked", "won", "lost",
        ];
        if (!allowed.includes(status))
            return fail(res, "Invalid status", 400);

        const lead = await Lead.findById(req.params.id);
        if (!lead) return fail(res, "Lead not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(lead.assignedTo) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        lead.status = status;
        lead.updatedBy = req.user._id;
        if (note) lead.stageHistory.push({ stage: status, changedBy: req.user._id, note });

        if (status === "lost") {
            lead.lostReason = lostReason || lead.lostReason;
            lead.lostReasonCategory = lostReasonCategory || lead.lostReasonCategory;
        }

        await lead.save();
        return ok(res, lead, `Lead marked as ${status}`);
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/leads/:id/assign  (BRD 9.2)
export const assignLead = async (req, res, next) => {
    try {
        const { assignedTo } = req.body;
        if (!assignedTo) return fail(res, "assignedTo is required", 400);

        const lead = await Lead.findByIdAndUpdate(
            req.params.id,
            { assignedTo, updatedBy: req.user._id },
            { new: true }
        ).populate("assignedTo", "name email role");

        if (!lead) return fail(res, "Lead not found", 404);
        const assignedToUser = lead.assignedTo;

        await sendNotification({
            recipientType: "staff",
            userId: assignedToUser._id,
            to: assignedToUser.email,
            channel: "in_app",
            type: "lead_assigned",
            title: "New lead assigned",
            body: `Lead assigned to you. Customer: ${lead.customer?.name || "N/A"}`,
            priority: "high",
            relatedTo: { lead: lead._id },
            actionUrl: `/crm/leads/${lead._id}`,
            actionLabel: "View lead",
            createdBy: req.user._id,
        });

        return ok(res, lead, "Lead assigned");
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/leads/:id/follow-up  (BRD 9.2)
export const scheduleFollowUp = async (req, res, next) => {
    try {
        const { nextFollowUpAt, note } = req.body;
        if (!nextFollowUpAt) return fail(res, "nextFollowUpAt is required", 400);

        const lead = await Lead.findByIdAndUpdate(
            req.params.id,
            {
                nextFollowUpAt: new Date(nextFollowUpAt),
                lastContactedAt: new Date(),
                updatedBy: req.user._id,
            },
            { new: true }
        );

        if (!lead) return fail(res, "Lead not found", 404);
        return ok(res, lead, "Follow-up scheduled");
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/leads/:id/priority
export const updatePriority = async (req, res, next) => {
    try {
        const { priority } = req.body;
        if (!["hot", "warm", "cold"].includes(priority))
            return fail(res, "Invalid priority", 400);

        const lead = await Lead.findByIdAndUpdate(
            req.params.id,
            { priority, updatedBy: req.user._id },
            { new: true }
        );
        if (!lead) return fail(res, "Lead not found", 404);
        return ok(res, lead, "Priority updated");
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/leads/:id/won
export const markWon = async (req, res, next) => {
    try {
        const { dealValue, bookingAmount } = req.body;

        const lead = await Lead.findById(req.params.id);
        if (!lead) return fail(res, "Lead not found", 404);

        lead.status = "won";
        if (dealValue) lead.dealValue = dealValue;
        if (bookingAmount) lead.bookingAmount = bookingAmount;
        lead.updatedBy = req.user._id;
        await lead.save();
        if (lead.campaign) {
            await bumpCampaignMetric(lead.campaign, "wonLeads", 1);
            if (lead.dealValue) {
                await Campaign.updateOne(
                    { _id: lead.campaign },
                    { $inc: { "metrics.revenue": lead.dealValue } }
                );
            }
        }
        return ok(res, lead, "Lead marked as won");
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/leads/:id/lost
export const markLost = async (req, res, next) => {
    try {
        const { lostReason, lostReasonCategory } = req.body;

        const lead = await Lead.findById(req.params.id);
        if (!lead) return fail(res, "Lead not found", 404);

        lead.status = "lost";
        lead.lostReason = lostReason || null;
        lead.lostReasonCategory = lostReasonCategory || "other";
        lead.updatedBy = req.user._id;
        await lead.save();
        if (lead.campaign) {
            await bumpCampaignMetric(lead.campaign, "lostLeads", 1);
        }
        return ok(res, lead, "Lead marked as lost");
    } catch (err) {
        next(err);
    }
};

// DELETE /api/v1/leads/:id
export const deleteLead = async (req, res, next) => {
    try {
        const lead = await Lead.findByIdAndUpdate(
            req.params.id,
            { deletedAt: new Date(), isActive: false, updatedBy: req.user._id },
            { new: true }
        );
        if (!lead) return fail(res, "Lead not found", 404);
        return ok(res, {}, "Lead deleted");
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/leads/stats/dashboard  (BRD 9.1)
export const getLeadDashboard = async (req, res, next) => {
    try {
        const scopeFilter =
            req.user.role === "sales_executive" ? { assignedTo: req.user._id } : {};

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const [
            totalLeads,
            newLeads,
            hotLeads,
            todayFollowUps,
            overdueFollowUps,
            byStatus,
            bySource,
            byCity,
            wonLeads,
            lostLeads,
        ] = await Promise.all([
            Lead.countDocuments(scopeFilter),
            Lead.countDocuments({ ...scopeFilter, status: "new" }),
            Lead.countDocuments({ ...scopeFilter, priority: "hot" }),
            Lead.countDocuments({
                ...scopeFilter,
                nextFollowUpAt: { $gte: startOfDay, $lte: endOfDay },
            }),
            Lead.countDocuments({
                ...scopeFilter,
                nextFollowUpAt: { $lt: new Date() },
                status: { $nin: ["won", "lost"] },
            }),
            Lead.aggregate([
                { $match: scopeFilter },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            Lead.aggregate([
                { $match: scopeFilter },
                { $group: { _id: "$source", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            Lead.aggregate([
                { $match: { ...scopeFilter, "location.city": { $ne: null } } },
                { $group: { _id: "$location.city", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            Lead.countDocuments({ ...scopeFilter, status: "won" }),
            Lead.countDocuments({ ...scopeFilter, status: "lost" }),
        ]);

        const conversionRate = totalLeads
            ? Number(((wonLeads / totalLeads) * 100).toFixed(2))
            : 0;

        return ok(res, {
            totalLeads,
            newLeads,
            hotLeads,
            todayFollowUps,
            overdueFollowUps,
            wonLeads,
            lostLeads,
            conversionRate,
            byStatus,
            bySource,
            byCity,
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/leads/stats/source-performance  (BRD 15)
export const getSourcePerformance = async (req, res, next) => {
    try {
        const data = await Lead.aggregate([
            {
                $group: {
                    _id: "$source",
                    totalLeads: { $sum: 1 },
                    qualifiedLeads: {
                        $sum: {
                            $cond: [
                                { $in: ["$status", ["qualified", "car_shared", "visit_scheduled", "test_drive", "negotiation", "reserved", "booked", "won"]] },
                                1,
                                0,
                            ],
                        },
                    },
                    wonLeads: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
                    lostLeads: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] } },
                    totalRevenue: { $sum: { $ifNull: ["$dealValue", 0] } },
                },
            },
            {
                $addFields: {
                    conversionRate: {
                        $cond: [
                            { $gt: ["$totalLeads", 0] },
                            { $multiply: [{ $divide: ["$wonLeads", "$totalLeads"] }, 100] },
                            0,
                        ],
                    },
                },
            },
            { $sort: { totalLeads: -1 } },
        ]);

        return ok(res, data);
    } catch (err) {
        next(err);
    }
};