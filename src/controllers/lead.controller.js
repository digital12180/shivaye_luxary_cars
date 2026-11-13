import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import Customer from "../models/Customer.js";
import Vehicle from "../models/Vehicle.js";
import { ok, fail } from "../utils/response.js";
import LeadActivity from "../models/leadActivity.js";
import Campaign from "../models/Campaign.js";
import { notifyLeadAssigned } from "../services/notification.service.js";
import { extractAttribution } from "../services/attribution.service.js";
import { captureLocation } from "../services/geolocation.service.js";
import Brand from "../models/Brand.js"

const STAGE_RANK = {
    "New": 1,
    "Contacted": 2,
    "Qualified": 3,
    "Car Shared": 4,
    "Visit Scheduled": 5,
    "Test Drive": 6,
    "Negotiation": 7,
    "Reserved": 8,
    "Booked": 9,
    "Won": 10
};


export const publicCreateLead = async (req, res, next) => {
    try {
        // 1. Extract Attribution & Location using Services
        const attribution = extractAttribution(req);
        const { ip, location } = captureLocation(req);  // getClientIp + resolveLocation combined

        const {
            name, phone, email, city,
            vehicle: vehicleId,
            vehicleBrand, vehicleModel, source, leadType,
            requirement, budgetMin, budgetMax, notes, campaignId,
        } = req.body;

        // 2. Validate required fields
        if (!name || !phone) return fail(res, "Name and phone are required", 400);
        if (!vehicleId) return fail(res, "Vehicle ID is required", 400);
        if (!mongoose.isValidObjectId(vehicleId)) return fail(res, "Invalid vehicle ID format", 400);

        // 3. Validate Vehicle
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return fail(res, `Vehicle not found (id: ${vehicleId})`, 404);

        // 4. Resolve / create customer — name-aware
        let customer = await Customer.findOne({
            phone,
            name: new RegExp(`^${name.trim()}$`, "i"),
        });

        if (!customer) {
            customer = await Customer.create({
                name, phone, email, city,
                source: source || "direct_website",
                attribution: attribution || {},
                ipAddress: ip, // ✅ From service
                ipLocation: location, // ✅ From service
            });
        } else {
            // ✅ Update customer's location/attribution if missing on re-enquiry
            let customerUpdated = false;
            if (!customer.ipLocation?.city && location?.city) {
                customer.ipLocation = location;
                customerUpdated = true;
            }
            if (ip && customer.ipAddress !== ip) {
                customer.ipAddress = ip;
                customerUpdated = true;
            }
            if (customerUpdated) await customer.save();
        }

        // 5. Resolve campaign
        let campaign = null;
        if (attribution?.utmCampaign) {
            campaign = await Campaign.findOne({ "utm.campaign": attribution.utmCampaign }).select("_id");
        }
        if (!campaign && campaignId && mongoose.isValidObjectId(campaignId)) {
            campaign = await Campaign.findById(campaignId).select("_id");
        }

        // 6. Resolve brand
        let brandId = null;
        if (vehicle.brand && mongoose.isValidObjectId(vehicle.brand)) {
            brandId = vehicle.brand;
        } else if (vehicle.brand || vehicleBrand) {
            const brandName = vehicle.brand || vehicleBrand;
            const brandDoc = await Brand.findOne({ name: new RegExp(`^${brandName.trim()}$`, "i") }).select("_id");
            brandId = brandDoc?._id || null;
        }

        // 7. Handle Source Enum 
        const allowedLeadSources = [
            "google_ads", "facebook_ads", "instagram", "organic",
            "direct_website", "whatsapp", "phone", "walk_in",
            "referral", "manual", "other",
        ];
        let leadSource = "direct_website";
        if (source && allowedLeadSources.includes(source)) {
            leadSource = source;
        } else if (attribution?.latestTouchSource) {
            // ✅ Fallback to attribution-derived source if not sent explicitly
            leadSource = attribution.latestTouchSource;
        }

        // 8. Handle Budget
        const finalBudget = budgetMax || budgetMin || null;

        // 9. Duplicate lead detection (within 30 days)
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const existingLead = await Lead.findOne({
            customer: customer._id,
            vehicle: vehicle._id,
            createdAt: { $gte: since },
            status: { $nin: ["Won", "Lost"] },
        }).sort({ createdAt: -1 });

        if (existingLead) {
            // Update existing lead
            if (attribution) {
                existingLead.attribution = {
                    ...existingLead.attribution,
                    ...attribution,
                    latestTouchAt: new Date()
                };
            }
            if (campaign && !existingLead.campaign) existingLead.campaign = campaign._id;
            if (requirement) existingLead.requirement = requirement;
            if (notes) existingLead.notes = [existingLead.notes, notes].filter(Boolean).join("\n");
            if (finalBudget) existingLead.budget = finalBudget;

            // ✅ Update location on existing lead
            if (location?.city || city) {
                existingLead.location = {
                    country: location?.country || existingLead.location?.country || null,
                    state: location?.state || existingLead.location?.state || null,
                    city: city || location?.city || existingLead.location?.city || null,
                };
                existingLead.ipAddress = ip || existingLead.ipAddress;
            }

            await existingLead.save();

            await LeadActivity.create({
                lead: existingLead._id, customer: customer._id,
                type: "system", title: "Customer re-enquired",
                description: "Duplicate enquiry captured and merged",
                meta: { attribution: attribution || {}, vehicle: vehicle._id, campaign: campaign?._id || null },
            });

            await existingLead.populate([
                { path: "customer", select: "name phone email city" },
                { path: "vehicle", select: "brand model year price stockId" },
                { path: "brand", select: "name" },
                { path: "campaign", select: "name" }
            ]);

            return ok(res, { lead: existingLead, isDuplicate: true }, "Enquiry linked to existing lead", 200);
        }

        // 10. Create new lead
        const lead = await Lead.create({
            customer: customer._id,
            vehicle: vehicle._id,
            campaign: campaign?._id || null,
            enquiryType: leadType || "Purchase",
            source: leadSource,
            requirement,
            interestedVehicle: vehicleModel || vehicle.model || "Unknown",
            brand: brandId,
            budget: finalBudget,
            notes,
            attribution: {
                ...(attribution || {}),
                firstTouchAt: new Date(),
                latestTouchAt: new Date(),
            },
            // ✅ Location Priority: Form City > IP Location > Customer's saved location
            location: {
                country: location?.country || customer.ipLocation?.country || null,
                state: location?.state || customer.ipLocation?.state || null,
                city: city || location?.city || customer.ipLocation?.city || customer.city || null,
            },
            ipAddress: ip,
            createdBy: null, updatedBy: null,
        });

        // 11. Populate response
        await lead.populate([
            { path: "customer", select: "name phone email city" },
            { path: "vehicle", select: "brand model year price stockId" },
            { path: "brand", select: "name" },
            { path: "campaign", select: "name" }
        ]);

        // 12. Log activity
        await LeadActivity.create({
            lead: lead._id, customer: customer._id,
            type: "system", title: "Lead created",
            description: `Lead created from ${lead.source}`,
            meta: { source: lead.source, campaign: campaign?._id || null, utmCampaign: attribution?.utmCampaign || null },
        });

        // 13. Success response
        return ok(res, { lead, isDuplicate: false, campaignMatched: !!campaign }, "Enquiry submitted successfully", 201);

    } catch (err) {
        console.error("Error in publicCreateLead:", err);
        next(err);
    }
};
/* ================= CRM ================= */
// Most recent: GET /api/v1/leads?sort=recent

// Price low-high: GET /api/v1/leads?sort=price_low_high

// Name A-Z: GET /api/v1/leads?sort=name_asc


export const listLeads = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const {
            status, source, assignedTo, enquiryType, priority,
            city, search, fromDate, toDate,
            followUpToday, overdue, sort,
        } = req.query;

        const filter = {};

        if (req.user.role === "sales_executive") {
            filter.assignedTo = req.user._id;
        } else if (assignedTo) {
            filter.assignedTo = assignedTo;
        }

        if (status) filter.status = status;
        if (source) filter.source = source;
        if (enquiryType) filter.enquiryType = enquiryType;
        if (priority) filter.priority = priority;
        if (city) filter.city = new RegExp(city, "i");

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
            filter.status = { $nin: ["Won", "Lost"] };
        }

        // ✅ Global search across lead + customer + brand fields
        if (search) {
            const rx = new RegExp(search.trim(), "i");

            // 1. Find matching customers
            const matchedCustomers = await Customer.find({
                $or: [
                    { name: rx },
                    { phone: rx },
                    { email: rx },
                    { city: rx },
                ],
            }).select("_id");

            const customerIds = matchedCustomers.map((c) => c._id);

            // 2. Find matching brands (Assuming you have a Brand model. If brands are stored as strings in another collection, adjust this query)
            // Note: If you don't have a separate Brand collection, you can skip this and remove { brand: { $in: brandIds } } below.
            const matchedBrands = await Brand.find({ name: rx }).select("_id");
            const brandIds = matchedBrands.map((b) => b._id);

            // 3. Build the $or filter
            filter.$or = [
                { requirement: rx },
                { notes: rx },
                { interestedVehicle: rx },
                { leadNumber: rx },
                { city: rx },
                { "location.city": rx },
                { "location.state": rx },
                { "location.country": rx },

                // Add matched customer IDs
                ...(customerIds.length ? [{ customer: { $in: customerIds } }] : []),

                // Add matched brand IDs (Only if brandIds has items)
                ...(brandIds.length ? [{ brand: { $in: brandIds } }] : []),
            ];
        }

        let sortOptions = { createdAt: -1 };
        switch (sort) {
            case "recent": sortOptions = { createdAt: -1 }; break;
            case "name_asc": sortOptions = { interestedVehicle: 1 }; break;
            case "price_low_high": sortOptions = { budget: 1 }; break;
            case "price_high_low": sortOptions = { budget: -1 }; break;
            case "city_asc": sortOptions = { city: 1 }; break;
            case "followup_asc": sortOptions = { nextFollowUpAt: 1 }; break;
            default: sortOptions = { createdAt: -1 };
        }

        const [data, total] = await Promise.all([
            Lead.find(filter)
                .populate("customer", "name phone email city source")
                .populate("vehicle", "brand model year askingPrice images slug status")
                .populate("assignedTo", "name email role")
                .sort(sortOptions)
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
            .populate("vehicle", "brand model variant year askingPrice images slug status")
            .populate("assignedTo", "name email role")
            .populate("campaign", "name")
            .populate("stageHistory.changedBy", "name")
            .populate("createdBy", "name")
            .populate("updatedBy", "name");

        if (!lead) return fail(res, "Lead not found", 404);

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

// POST /api/v1/leads  (manual entry / walk-in

export const createLead = async (req, res, next) => {
    try {
        const {
            customer: customerId, vehicle,
            name, mobile, email,
            enquiryType, interestedVehicle, brand,
            budget, source, assignedTo, status,
            nextFollowUpAt, city, notes, priority
        } = req.body;

        // ---- Validate brand (now ObjectId -> Brand) ----
        let brandId = null;
        if (brand) {
            if (!mongoose.Types.ObjectId.isValid(brand)) {
                return fail(res, "Invalid brand id", 400);
            }
            const brandDoc = await Brand.findById(brand).select("_id");
            if (!brandDoc) {
                return fail(res, "Brand not found", 404);
            }
            brandId = brandDoc._id;
        }

        // ---- Resolve / create customer ----
        let customer;
        if (customerId) {
            if (!mongoose.Types.ObjectId.isValid(customerId)) {
                return fail(res, "Invalid customer id", 400);
            }
            customer = await Customer.findById(customerId);
            if (!customer) return fail(res, "Customer not found", 404);
        } else if (name && mobile) {
            // ✅ FIX: Check if EXACT phone AND name combination exists
            customer = await Customer.findOne({
                phone: mobile,
                name: new RegExp(`^${name.trim()}$`, "i"),
            });

            // ✅ If not found, create a new customer (Senior's rule: same phone + diff name = new customer)
            if (!customer) {
                customer = await Customer.create({
                    name,
                    phone: mobile,
                    email,
                    city,
                    source: source || "manual", // Fixed default
                });
            }
        } else {
            return fail(res, "Customer ID or Name+Mobile is required", 400);
        }

        // ---- Validate assignedTo (optional ObjectId) ----
        if (assignedTo && !mongoose.Types.ObjectId.isValid(assignedTo)) {
            return fail(res, "Invalid assignedTo id", 400);
        }

        // ---- Create lead ----
        const lead = await Lead.create({
            customer: customer._id,
            vehicle: vehicle,
            assignedTo: assignedTo || null,
            enquiryType: enquiryType || "Purchase",
            interestedVehicle: interestedVehicle || "Unknown",
            brand: brandId,
            budget: budget ?? null,
            source: source || "manual",     // ✅ Fixed default to match schema enum
            status: status || "New",
            nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null,
            city,
            notes,
            priority: priority || "warm",
            createdBy: req.user._id,
            updatedBy: req.user._id,
            attribution: {
                firstTouchAt: new Date(),
                latestTouchAt: new Date(),
            },
        });

        // populate brand & customer for response
        await lead.populate([
            { path: "brand", select: "name" },
            { path: "customer", select: "name phone email" }
        ]);

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
            if (lead.status === "Won") {
                await bumpCampaignMetric(lead.campaign, "wonLeads", 1);
                if (lead.dealValue) {
                    await Campaign.updateOne(
                        { _id: lead.campaign },
                        { $inc: { "metrics.revenue": lead.dealValue } }
                    );
                }
            } else if (lead.status === "Lost") {
                await bumpCampaignMetric(lead.campaign, "lostLeads", 1);
            } else if (
                ["Qualified", "Test Drive", "Visit Scheduled", "Negotiation", "Reserved", "Booked"]
                    .includes(lead.status)
            ) {
                await bumpCampaignMetric(lead.campaign, "qualifiedLeads", 1);
            }
        }

        return ok(res, lead, "Lead updated");
    } catch (err) {
        next(err);
    }
};

// export const updateLeadStatus = async (req, res, next) => {
//     try {
//         const { status, note, lostReason, lostReasonCategory } = req.body;

//         const allowed = Object.keys(STAGE_RANK).concat(["Lost"]);
//         if (!allowed.includes(status))
//             return fail(res, "Invalid status", 400);

//         const lead = await Lead.findById(req.params.id);
//         if (!lead) return fail(res, "Lead not found", 404);

//         if (
//             req.user.role === "sales_executive" &&
//             String(lead.assignedTo) !== String(req.user._id)
//         ) {
//             return fail(res, "Not authorized", 403);
//         }

//         // ✅ Forward-only guard (except Lost / Won)
//         if (status !== "Lost" && status !== "Won") {
//             const currentRank = STAGE_RANK[lead.status] ?? -1;
//             const newRank = STAGE_RANK[status] ?? -1;
//             if (newRank < currentRank) {
//                 return fail(
//                     res,
//                     `Cannot move lead backward from "${lead.status}" to "${status}"`,
//                     400
//                 );
//             }
//         }

//         lead.status = status;
//         lead.updatedBy = req.user._id;
//         lead.stageHistory = lead.stageHistory || [];
//         lead.stageHistory.push({ stage: status, changedBy: req.user._id, note: note || "" });

//         if (status === "Lost") {
//             lead.lostReason = lostReason || lead.lostReason;
//             lead.lostReasonCategory = lostReasonCategory || lead.lostReasonCategory;
//         }

//         await lead.save();
//         return ok(res, lead, `Lead marked as ${status}`);
//     } catch (err) {
//         next(err);
//     }
// };



export const updateLeadStatus = async (req, res, next) => {
    try {
        const { status, note, lostReason, lostReasonCategory } = req.body;

        // 1. Validate status is allowed (Matches Mongoose Enum)
        const allowed = Object.keys(STAGE_RANK).concat(["Lost"]);
        if (!allowed.includes(status)) {
            return fail(res, "Invalid status", 400);
        }

        const lead = await Lead.findById(req.params.id);
        if (!lead) return fail(res, "Lead not found", 404);

        // Authorization check
        if (
            req.user.role === "sales_executive" &&
            String(lead.assignedTo) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        // 2. Forward-only Guard logic
        // Rule: Once Won, no further stage changes.
        if (lead.status === "Won" && status !== "Won") {
            return fail(res, "Cannot change status of a Won lead", 400);
        }

        // Rule: Cannot move backwards UNLESS current status is 'Lost' (allowing re-entry into pipeline)
        if (lead.status !== "Lost" && status !== "Lost" && status !== "Won") {
            const currentRank = STAGE_RANK[lead.status] ?? -1;
            const newRank = STAGE_RANK[status] ?? -1;

            if (newRank < currentRank) {
                return fail(
                    res,
                    `Cannot move lead backward from "${lead.status}" to "${status}"`,
                    400
                );
            }
        }

        // Prevent setting status to the exact same stage
        if (lead.status === status) {
            return ok(res, lead, `Lead is already in ${status} stage`);
        }

        // 3. Save the OLD status before updating
        const previousStatus = lead.status;

        // 4. Apply the changes
        lead.status = status;
        lead.updatedBy = req.user._id;

        // Handle Lost Reason Logic
        if (status === "Lost") {
            lead.lostReason = lostReason || lead.lostReason;
            lead.lostReasonCategory = lostReasonCategory || lead.lostReasonCategory;
        }

        // FIXED: Reset lost reason if the lead moves out of Lost stage
        // Hum previousStatus check kar rahe hain, kyunki lead.status ab naya ban chuka hai
        if (previousStatus === "Lost" && status !== "Lost") {
            lead.lostReason = null;
            lead.lostReasonCategory = null;
        }

        // Note: Aapke model ke pre('save') hook mein stageHistory automatic handle ho rahi hai.
        // Agar aap 'note' ko history mein save karna chahte hain, toh model mein hook update karein.

        await lead.save();
        return ok(res, lead, `Lead marked as ${status}`);
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/leads/:id/assign
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

        notifyLeadAssigned(lead, assignedToUser).catch(console.error);
        return ok(res, lead, "Lead assigned");
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/leads/:id/follow-up
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

        lead.status = "Won";
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

        lead.status = "Lost";
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

// GET /api/v1/leads/stats/dashboard
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
            Lead.countDocuments({ ...scopeFilter, status: "New" }),
            Lead.countDocuments({ ...scopeFilter, priority: "hot" }),
            Lead.countDocuments({
                ...scopeFilter,
                nextFollowUpAt: { $gte: startOfDay, $lte: endOfDay },
            }),
            Lead.countDocuments({
                ...scopeFilter,
                nextFollowUpAt: { $lt: new Date() },
                status: { $nin: ["Won", "Lost"] },
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
                { $match: { ...scopeFilter, city: { $ne: null } } },
                { $group: { _id: "$city", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            Lead.countDocuments({ ...scopeFilter, status: "Won" }),
            Lead.countDocuments({ ...scopeFilter, status: "Lost" }),
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
                                { $in: ["$status", ["Qualified", "Test Drive", "Visit Scheduled", "Negotiation", "Reserved", "Booked", "Won"]] },
                                1,
                                0,
                            ],
                        },
                    },
                    wonLeads: { $sum: { $cond: [{ $eq: ["$status", "Won"] }, 1, 0] } },
                    lostLeads: { $sum: { $cond: [{ $eq: ["$status", "Lost"] }, 1, 0] } },
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