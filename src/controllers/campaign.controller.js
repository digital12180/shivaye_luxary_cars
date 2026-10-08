import Campaign from "../models/Campaign.js";
import Lead from "../models/Lead.js";
import { ok, fail } from "../utils/response.js";

/* ================= PUBLIC ================= */

// GET /api/v1/campaigns/public/active  (festive landing page — BRD 28.1)
export const getActiveCampaigns = async (req, res, next) => {
    try {
        const now = new Date();
        const campaigns = await Campaign.find({
            isActive: true,
            status: "live",
            startDate: { $lte: now },
            endDate: { $gte: now },
        })
            .populate("selectedVehicles", "brand model year price images slug status")
            .sort("-startDate")
            .select("-metrics -spend -budget -createdBy -updatedBy");

        return ok(res, campaigns);
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/campaigns/public/:slug  (festive landing page detail)
export const getPublicCampaign = async (req, res, next) => {
    try {
        const campaign = await Campaign.findOne({
            slug: req.params.slug,
            isActive: true,
            status: "live",
        }).populate(
            "selectedVehicles",
            "brand model year price images slug status location kilometers"
        );

        if (!campaign) return fail(res, "Campaign not found or inactive", 404);
        return ok(res, campaign);
    } catch (err) {
        next(err);
    }
};

/* ================= CRM ================= */

// GET /api/v1/campaigns
export const listCampaigns = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { status, source, type, isActive, search } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (source) filter.source = source;
        if (type) filter.type = type;
        if (isActive !== undefined) filter.isActive = isActive === "true";

        if (search) {
            filter.$or = [
                { name: new RegExp(search, "i") },
                { title: new RegExp(search, "i") },
                { "utm.campaign": new RegExp(search, "i") },
            ];
        }

        const [data, total] = await Promise.all([
            Campaign.find(filter)
                .populate("createdBy", "name")
                .populate("updatedBy", "name")
                .sort("-createdAt")
                .skip((page - 1) * limit)
                .limit(limit),
            Campaign.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/campaigns/:id
export const getCampaign = async (req, res, next) => {
    try {
        const campaign = await Campaign.findById(req.params.id)
            .populate("selectedVehicles", "brand model year price images slug status")
            .populate("createdBy", "name")
            .populate("updatedBy", "name");

        if (!campaign) return fail(res, "Campaign not found", 404);
        return ok(res, campaign);
    } catch (err) {
        next(err);
    }
};

// POST /api/v1/campaigns
export const createCampaign = async (req, res, next) => {
    try {
        const campaign = await Campaign.create({
            ...req.body,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });
        return ok(res, campaign, "Campaign created", 201);
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/campaigns/:id
export const updateCampaign = async (req, res, next) => {
    try {
        const protectedFields = ["metrics", "spend", "slug", "createdBy", "deletedAt"];
        protectedFields.forEach((f) => delete req.body[f]);

        const campaign = await Campaign.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedBy: req.user._id },
            { new: true, runValidators: true }
        );
        if (!campaign) return fail(res, "Campaign not found", 404);

        return ok(res, campaign, "Campaign updated");
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/campaigns/:id/status  (BRD 28.2 activate/deactivate)
export const updateCampaignStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        const allowed = ["draft", "scheduled", "live", "paused", "ended"];
        if (!allowed.includes(status)) return fail(res, "Invalid status", 400);

        const campaign = await Campaign.findByIdAndUpdate(
            req.params.id,
            {
                status,
                isActive: status === "live" || status === "scheduled",
                updatedBy: req.user._id,
            },
            { new: true }
        );
        if (!campaign) return fail(res, "Campaign not found", 404);

        return ok(res, campaign, `Campaign marked as ${status}`);
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/campaigns/:id/vehicles  (BRD 28.2 select inventory for offer)
export const updateSelectedVehicles = async (req, res, next) => {
    try {
        const { vehicleIds } = req.body;
        if (!Array.isArray(vehicleIds))
            return fail(res, "vehicleIds must be an array", 400);

        const campaign = await Campaign.findByIdAndUpdate(
            req.params.id,
            { selectedVehicles: vehicleIds, updatedBy: req.user._id },
            { new: true }
        ).populate("selectedVehicles", "brand model year price images slug status");

        if (!campaign) return fail(res, "Campaign not found", 404);
        return ok(res, campaign, "Selected vehicles updated");
    } catch (err) {
        next(err);
    }
};

// DELETE /api/v1/campaigns/:id
export const deleteCampaign = async (req, res, next) => {
    try {
        const campaign = await Campaign.findByIdAndUpdate(
            req.params.id,
            { deletedAt: new Date(), isActive: false, updatedBy: req.user._id },
            { new: true }
        );
        if (!campaign) return fail(res, "Campaign not found", 404);
        return ok(res, {}, "Campaign deleted");
    } catch (err) {
        next(err);
    }
};

/* ================= ANALYTICS (BRD 15, 34.4) ================= */

// GET /api/v1/campaigns/stats/summary
export const getCampaignStats = async (req, res, next) => {
    try {
        const [total, live, scheduled, ended, totalSpend, totalRevenue] =
            await Promise.all([
                Campaign.countDocuments(),
                Campaign.countDocuments({ status: "live" }),
                Campaign.countDocuments({ status: "scheduled" }),
                Campaign.countDocuments({ status: "ended" }),
                Campaign.aggregate([
                    { $group: { _id: null, sum: { $sum: "$spend" } } },
                ]),
                Campaign.aggregate([
                    { $group: { _id: null, sum: { $sum: "$metrics.revenue" } } },
                ]),
            ]);

        const spend = totalSpend[0]?.sum || 0;
        const revenue = totalRevenue[0]?.sum || 0;

        return ok(res, {
            total,
            live,
            scheduled,
            ended,
            totalSpend: spend,
            totalRevenue: revenue,
            roas: spend ? Number((revenue / spend).toFixed(2)) : 0,
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/campaigns/:id/performance  (BRD 15 campaign report)
export const getCampaignPerformance = async (req, res, next) => {
    try {
        const campaign = await Campaign.findById(req.params.id);
        if (!campaign) return fail(res, "Campaign not found", 404);

        // Live aggregate from Lead collection
        const leadFilter = { campaign: campaign._id };
        const [totalLeads, qualifiedLeads, wonLeads, lostLeads, revenueAgg] =
            await Promise.all([
                Lead.countDocuments(leadFilter),
                Lead.countDocuments({
                    ...leadFilter,
                    status: {
                        $in: [
                            "qualified", "car_shared", "visit_scheduled",
                            "test_drive", "negotiation", "reserved", "booked", "won",
                        ],
                    },
                }),
                Lead.countDocuments({ ...leadFilter, status: "won" }),
                Lead.countDocuments({ ...leadFilter, status: "lost" }),
                Lead.aggregate([
                    { $match: { ...leadFilter, status: "won" } },
                    { $group: { _id: null, revenue: { $sum: "$dealValue" } } },
                ]),
            ]);

        const revenue = revenueAgg[0]?.revenue || 0;
        const conversionRate = totalLeads
            ? Number(((wonLeads / totalLeads) * 100).toFixed(2))
            : 0;
        const cpl = totalLeads ? Number((campaign.spend / totalLeads).toFixed(2)) : 0;
        const roas = campaign.spend ? Number((revenue / campaign.spend).toFixed(2)) : 0;

        // Optional: sync metrics back onto the campaign (denormalized cache)
        await Campaign.updateOne(
            { _id: campaign._id },
            {
                "metrics.totalLeads": totalLeads,
                "metrics.qualifiedLeads": qualifiedLeads,
                "metrics.wonLeads": wonLeads,
                "metrics.lostLeads": lostLeads,
                "metrics.revenue": revenue,
            }
        );

        return ok(res, {
            campaign: {
                _id: campaign._id,
                name: campaign.name,
                source: campaign.source,
                type: campaign.type,
                status: campaign.status,
                startDate: campaign.startDate,
                endDate: campaign.endDate,
                budget: campaign.budget,
                spend: campaign.spend,
            },
            performance: {
                totalLeads,
                qualifiedLeads,
                wonLeads,
                lostLeads,
                revenue,
                conversionRate,
                cpl,
                roas,
            },
        });
    } catch (err) {
        next(err);
    }
};