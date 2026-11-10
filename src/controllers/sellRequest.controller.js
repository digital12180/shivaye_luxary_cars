import SellRequest from "../models/sellRequest.js";
import Customer from "../models/Customer.js"
import {
    uploadMultipleToCloudinary,
    deleteMultipleFromCloudinary,
} from "../utils/cloudinary.js";
import mongoose from "mongoose";


const PUBLIC_FIELDS = [
    "sellerName", "phone", "email", "city", "preferredContactTime",
    "brand", "model", "variant", "bodyType", "year", "registrationYear",
    "fuel", "transmission", "kilometres", "ownership", "exteriorColour",
    "registrationNumber", "vehicleLocation", "conditionDescription",
    "chasisNumber", "marketPrice", "askingPrice", "photos",
];

const pick = (obj, keys) =>
    keys.reduce((acc, k) => {
        if (obj[k] !== undefined) acc[k] = obj[k];
        return acc;
    }, {});
    
export const createSellRequest = async (req, res) => {
    const uploadedPublicIds = []; // track for rollback

    try {
        const data = req.body || {};

        // 1. Validate required fields (Customer)
        if (!data.phone || !data.name) {
            return res.status(400).json({
                success: false,
                message: "Name and Phone number are required to proceed.",
            });
        }

        // 2. Map source for Customer enum
        const customerSource = data.source
            ? String(data.source).toLowerCase().replace(" ", "_")
            : "direct_website";

        // 3. Find or Create the Customer
        let customer = await Customer.findOne({ phone: data.phone });

        if (!customer) {
            customer = await Customer.create({
                name: data.name,
                phone: data.phone,
                email: data.email || null,
                city: data.city || null,
                state: data.state || null,
                source: ["direct_website", "organic", "manual", "walk_in"].includes(
                    customerSource
                )
                    ? customerSource
                    : "other",
                interestedIn: "sell",
                ipAddress: req.ip || null,
            });
        } else {
            if (data.name && customer.name !== data.name) customer.name = data.name;
            if (data.city && !customer.city) customer.city = data.city;
            customer.interestedIn = "sell";
            await customer.save();
        }

        // 4. Upload photos to Cloudinary (if any)
        //    `req.files` is populated by multer.array("photos", N)
        let photoUrls = [];
        if (req.files && req.files.length > 0) {
            // Guard: max 10 photos
            if (req.files.length > 10) {
                return res.status(400).json({
                    success: false,
                    message: "You can upload a maximum of 10 photos.",
                });
            }

            const results = await uploadMultipleToCloudinary(req.files);
            // uploadMultipleToCloudinary returns [{ url, public_id }, ...]
            photoUrls = results.map((r) => r.url);
            results.forEach((r) => uploadedPublicIds.push(r.public_id));
        }

        // 5. Build SellRequest payload
        const { name, photos, ...rest } = data; // drop any client-sent URLs too
        const sellRequestPayload = {
            ...rest,
            sellerName: name,                             // name -> sellerName
            customer: customer._id,
            source: ["Website", "Admin", "Walk-in", "Referral"].includes(data.source)
                ? data.source
                : "Website",
            photos: photoUrls,                            // ⬅️ uploaded URLs
        };

        const newRequest = await SellRequest.create(sellRequestPayload);

        return res.status(201).json({
            success: true,
            message: "Sell request submitted successfully",
            data: newRequest,
            customerId: customer._id,
        });
    } catch (error) {
        console.error("Create Sell Request Error:", error);

        // Rollback: delete the files we just uploaded, so Cloudinary isn't polluted
        if (uploadedPublicIds.length > 0) {
            try {
                await deleteMultipleFromCloudinary(uploadedPublicIds, "image");
            } catch (cleanupErr) {
                console.error("Cloudinary cleanup failed:", cleanupErr);
            }
        }

        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || "field";
            return res.status(409).json({
                success: false,
                message: `A sell request with this ${field} already exists.`,
            });
        }

        return res.status(400).json({ success: false, message: error.message });
    }
};

export const getAllSellRequests = async (req, res) => {
    try {
        // FIX: validate & cap pagination
        let page = parseInt(req.query.page, 10);
        let limit = parseInt(req.query.limit, 10);
        if (!Number.isInteger(page) || page < 1) page = 1;
        if (!Number.isInteger(limit) || limit < 1) limit = 20;
        if (limit > 100) limit = 100;

        const { search = "", status } = req.query;

        const query = {};

        if (status && status !== "All Statuses") query.status = status;

        if (search) {
            const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            query.$or = [
                { sellerName: { $regex: escaped, $options: "i" } },
                { phone: { $regex: escaped, $options: "i" } },
                { brand: { $regex: escaped, $options: "i" } },
                { model: { $regex: escaped, $options: "i" } },
                { requestNumber: { $regex: escaped, $options: "i" } },
            ];
        }

        const [requests, total] = await Promise.all([
            SellRequest.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            SellRequest.countDocuments(query),
        ]);

        res.status(200).json({
            success: true,
            data: requests,
            pagination: { total, page, pages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error("Get Sell Requests Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

export const getSellRequestById = async (req, res) => {
    try {
        // FIX: validate ObjectId to avoid CastError → 500
        if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ success: false, message: "Invalid ID" });
        }
        const request = await SellRequest.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        res.status(200).json({ success: true, data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Admin-editable fields (protect requestNumber, deletedAt, chasisNumber uniqueness handled by validation)
const ADMIN_UPDATABLE = [
    "sellerName", "phone", "email", "city", "preferredContactTime",
    "brand", "model", "variant", "bodyType", "year", "registrationYear",
    "fuel", "transmission", "kilometres", "ownership", "exteriorColour",
    "registrationNumber", "vehicleLocation", "conditionDescription",
    "chasisNumber", "marketPrice", "askingPrice", "photos",
    "source", "status", "additionalInfo", "serviceHistory",
    "insuranceValidity", "accidentHistory", "assignedTo",
];

export const updateSellRequest = async (req, res) => {
    try {
        if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ success: false, message: "Invalid ID" });
        }
        // FIX: whitelist fields; pre-findOneAnd hook filters deleted docs
        const updates = pick(req.body, ADMIN_UPDATABLE);

        const updatedRequest = await SellRequest.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true, runValidators: true }
        );

        if (!updatedRequest) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        res.status(200).json({ success: true, data: updatedRequest });
    } catch (error) {
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || "field";
            return res.status(409).json({
                success: false,
                message: `A request with this ${field} already exists.`,
            });
        }
        res.status(400).json({ success: false, message: error.message });
    }
};

export const deleteSellRequest = async (req, res) => {
    try {
        if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ success: false, message: "Invalid ID" });
        }
        // FIX: findOneAndUpdate respects pre(/^findOneAnd/) → won't re-delete
        const deleted = await SellRequest.findByIdAndUpdate(
            req.params.id,
            { deletedAt: new Date() },
            { new: true }
        );
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        res.status(200).json({ success: true, message: "Request deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get all sell requests belonging to the logged-in customer
 * @route   GET /api/sell-requests/my
 * @access  Private (Customer)
 */
export const getMySellRequests = async (req, res) => {
    try {
        // ---- 1. Resolve the customer id from the authenticated user ----
        // Support multiple auth shapes so this works whether you log in
        // Customers directly or via a User model that references a Customer.
        const customerId =
            req.user?.customerId ||       // User model with `customerId` ref
            req.user?.customer ||         // User model with `customer` ref
            req.user?._id;                // Customer logs in directly

        if (!customerId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized. Please log in.",
            });
        }

        // ---- 2. Pagination (validated + capped) ----
        let page = parseInt(req.query.page, 10);
        let limit = parseInt(req.query.limit, 10);
        if (!Number.isInteger(page) || page < 1) page = 1;
        if (!Number.isInteger(limit) || limit < 1) limit = 20;
        if (limit > 50) limit = 50;

        // ---- 3. Optional status filter ----
        const query = { customer: customerId };

        const allowedStatuses = [
            "New",
            "Inspection Scheduled",
            "Offer Made",
            "Purchased",
            "Rejected",
        ];
        if (req.query.status && allowedStatuses.includes(req.query.status)) {
            query.status = req.query.status;
        }

        // ---- 4. Fetch (soft-deleted auto-excluded by model pre-hook) ----
        const [requests, total] = await Promise.all([
            SellRequest.find(query)
                .select(
                    // Only expose fields the customer needs — never leak
                    // assignedTo, additionalInfo, deletedAt, etc.
                    "requestNumber sellerName phone brand model variant year " +
                    "fuel transmission kilometres registrationNumber " +
                    "marketPrice askingPrice status photos source createdAt updatedAt"
                )
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            SellRequest.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            count: requests.length,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit) || 1,
            },
            data: requests,
        });
    } catch (error) {
        console.error("Get My Sell Requests Error:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error",
        });
    }
};

/**
 * @desc    Get a single sell request belonging to the logged-in customer
 * @route   GET /api/sell-requests/my/:id
 * @access  Private (Customer)
 */
export const getMySellRequestById = async (req, res) => {
    try {
        const customerId =
            req.user?.customerId || req.user?.customer || req.user?._id;

        if (!customerId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ success: false, message: "Invalid ID" });
        }

        // Ownership check is baked into the query — no cross-customer access
        const request = await SellRequest.findOne({
            _id: req.params.id,
            customer: customerId,
        })
            .select(
                "requestNumber sellerName phone brand model variant year " +
                "fuel transmission kilometres registrationNumber " +
                "marketPrice askingPrice status photos source createdAt updatedAt"
            )
            .lean();

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "Sell request not found",
            });
        }

        return res.status(200).json({ success: true, data: request });
    } catch (error) {
        console.error("Get My Sell Request Error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};