import Campaign from "../models/Campaign.js";
import Lead from "../models/Lead.js";
import { ok, fail } from "../utils/response.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";

// GET /api/v1/campaigns/public/active
// export const getActiveCampaigns = async (req, res, next) => {
//     try {
//         const now = new Date();

//         // Sirf Active campaigns fetch karne ke liye
//         const campaigns = await Campaign.find({
//             isActive: true,
//             status: "Active",
//             startDate: { $lte: now }, // Start date aaj ya usse pehle ki ho
//             endDate: { $gte: now },   // End date aaj ya uske baad ki ho
//         })
//             .sort("-startDate") // Latest start date wale pehle aayenge
//             .select("-metrics -spend -budget -createdBy -updatedBy"); // Unwanted fields hide kiye

//         return ok(res, campaigns);
//     } catch (err) {
//         next(err);
//     }
// };

export const getActiveCampaigns = async (req, res, next) => {
    try {
        const now = new Date();

        // 1️⃣ Saare valid campaigns fetch karo (current + upcoming)
        const campaigns = await Campaign.find({
            isActive: true,
            deletedAt: null,
            $or: [
                // Currently running
                {
                    startDate: { $lte: now },
                    $or: [
                        { endDate: { $gte: now } },
                        { endDate: null },
                        { endDate: { $exists: false } },
                    ],
                },
                // Upcoming (aane wala)
                { startDate: { $gt: now } },
            ],
        })
            .sort("-startDate")   // latest pehle
            .select("-metrics -spend -budget -createdBy -updatedBy");

        // 2️⃣ Rotation — har 10 min mein index badhe
        let selected = null;
        if (campaigns.length > 0) {
            const SLOT_MS = 10 * 60 * 1000;             // 10 minutes
            const slot = Math.floor(Date.now() / SLOT_MS);
            const index = slot % campaigns.length;      // rotate 0 → 1 → 2 → 0...
            selected = campaigns[index];
        }

        // 3️⃣ ALWAYS array return karo (single ho tab bhi)
        return ok(res, selected ? [selected] : []);
    } catch (err) {
        next(err);
    }
};

export const getPublicCampaign = async (req, res, next) => {
    try {
        const campaign = await Campaign.findOne({
            slug: req.params.slug,
            isActive: true,
            status: "Active",
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


export const listCampaigns = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { status, search } = req.query;

        const filter = {};

        // 🔥 FIX: Soft delete filter explicitly add karein
        // Taaki countDocuments aur find() dono exact same records par kaam karein
        filter.deletedAt = null;

        // Status Filter
        if (status && status !== "All statuses") {
            filter.status = status;
        }

        // Search Filter
        if (search) {
            filter.$or = [
                { name: new RegExp(search, "i") },
                { title: new RegExp(search, "i") },
            ];
        }

        // UPDATED: Sort by startDate (Ascending: 1)
        // Isse October wali campaign pehle aayegi, phir November wali
        let sortOption = { startDate: 1 };

        const [data, total] = await Promise.all([
            Campaign.find(filter)
                .populate("createdBy", "name")
                .populate("updatedBy", "name")
                .sort(sortOption)
                .skip((page - 1) * limit)
                .limit(limit),

            // Count ab exactly same filter par hoga
            Campaign.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            },
        });
    } catch (err) {
        next(err);
    }
};

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

/* ================= CRM ================= */

// POST /api/v1/campaigns
export const createCampaign = async (req, res, next) => {
    try {
        let bannerImageUrl = null;

        // 1. Check if a file was uploaded via multer
        if (req.file) {
            // Upload buffer to Cloudinary
            const uploadResult = await uploadToCloudinary(
                req.file.buffer,
                "image", // force image resource type
                `campaign-banner-${Date.now()}` // optional custom public_id
            );
            bannerImageUrl = uploadResult.url;
        }

        // 2. Prepare campaign data
        const campaignData = {
            ...req.body,
            // If a file was uploaded, override the bannerImage field from body
            ...(bannerImageUrl && { bannerImage: bannerImageUrl }),
            status: req.body.status || "Draft",
            createdBy: req.user._id, // Assuming req.user is set by auth middleware
            updatedBy: req.user._id,
        };

        // Note: If you are sending 'goodies' as a JSON string from FormData, you might need to parse it:
        // if (typeof campaignData.goodies === 'string') {
        //     campaignData.goodies = JSON.parse(campaignData.goodies);
        // }

        // Automatically set isActive based on status
        campaignData.isActive = campaignData.status === "Active";

        const campaign = await Campaign.create(campaignData);
        return ok(res, campaign, "Campaign created", 201);
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/campaigns/:id
export const updateCampaign = async (req, res, next) => {
    try {
        const campaign = await Campaign.findById(req.params.id);
        if (!campaign) return fail(res, "Campaign not found", 404);

        let updateData = { ...req.body, updatedBy: req.user._id };

        // Protect certain fields from being updated via req.body
        const protectedFields = ["metrics", "spend", "slug", "createdBy", "deletedAt", "status"];
        protectedFields.forEach((f) => delete updateData[f]);

        if (req.file) {
            // Upload new image
            const uploadResult = await uploadToCloudinary(
                req.file.buffer,
                "image",
                `campaign-banner-${Date.now()}`
            );
            updateData.bannerImage = uploadResult.url;

            // 2. Delete old image from Cloudinary
            if (campaign.bannerImage) {
                try {
                    // Extract public_id from the URL
                    // Splits the URL by '/upload/', takes the second part, removes the version (v123...), and removes the file extension
                    const urlParts = campaign.bannerImage.split('/upload/');
                    if (urlParts.length === 2) {
                        // Result: "v1234567890/nosecret/campaign-banner-12345.jpg"
                        const pathWithVersion = urlParts[1];
                        // Remove version and extension
                        const publicId = pathWithVersion
                            .replace(/^v\d+\//, '') // removes "v1234567890/"
                            .replace(/\.[^/.]+$/, ""); // removes ".jpg"

                        // publicId is now "nosecret/campaign-banner-12345"
                        await deleteFromCloudinary(publicId, "image");
                    }
                } catch (deleteError) {
                    // Log the error but don't stop the update process if deletion fails
                    console.error("Failed to delete old banner from Cloudinary:", deleteError);
                }
            }
        }

        // Note: Parse goodies if sent as string via FormData
        // if (updateData.goodies && typeof updateData.goodies === 'string') {
        //     updateData.goodies = JSON.parse(updateData.goodies);
        // }

        const updatedCampaign = await Campaign.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        return ok(res, updatedCampaign, "Campaign updated");
    } catch (err) {
        next(err);
    }
};


// PATCH /api/v1/campaigns/:id/status
export const updateCampaignStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        // Updated allowed statuses
        const allowed = ["Draft", "Active", "Paused", "Ended"];
        if (!allowed.includes(status)) return fail(res, "Invalid status", 400);

        const campaign = await Campaign.findByIdAndUpdate(
            req.params.id,
            {
                status,
                // isActive is true only if status is Active
                isActive: status === "Active",
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

// PATCH /api/v1/campaigns/:id/vehicles
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

/* ================= ANALYTICS ================= */

// GET /api/v1/campaigns/stats/summary
export const getCampaignStats = async (req, res, next) => {
    try {
        const [total, live, scheduled, ended, totalSpend, totalRevenue] =
            await Promise.all([
                Campaign.countDocuments(),
                // Updated counts based on new statuses
                Campaign.countDocuments({ status: "Active" }),
                Campaign.countDocuments({ status: "Draft" }), // Map "Scheduled" to Draft for now or add Scheduled status
                Campaign.countDocuments({ status: "Ended" }),
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
            scheduled, // Keeping key name same for frontend compatibility if needed
            ended,
            totalSpend: spend,
            totalRevenue: revenue,
            roas: spend ? Number((revenue / spend).toFixed(2)) : 0,
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/campaigns/:id/performance
export const getCampaignPerformance = async (req, res, next) => {
    try {
        const campaign = await Campaign.findById(req.params.id);
        if (!campaign) return fail(res, "Campaign not found", 404);

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