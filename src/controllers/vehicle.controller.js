import mongoose from "mongoose";
import Vehicle from "../models/Vehicle.js";
import Brand from "../models/Brand.js";
import Category from "../models/Category.js";
import { ok, fail } from "../utils/response.js";
import { uploadMultipleToCloudinary, uploadToCloudinary, deleteMultipleFromCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";

const generateStockId = async () => {
    const count = await Vehicle.countDocuments();
    return `SLC-${String(count + 1).padStart(5, "0")}`;
};

/* ============================================================
   PUBLIC — GET /api/v1/vehicles
Sort: Most recent	GET /api/v1/vehicles?sort=recent
Sort: Name A-Z	GET /api/v1/vehicles?sort=name_asc
Sort: Price low-high	GET /api/v1/vehicles?sort=price_low_high
Filter by RC Status	GET /api/v1/vehicles?rcCheck=Verified
   ============================================================ */
export const listVehicles = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 12;
        const {
            search, brand, model, location,
            fuelType, transmission, bodyType,
            minPrice, maxPrice, minYear, maxYear,
            maxKilometers, status, featured,
            brandRef, categoryRef, rcCheck, // ✅ Added rcCheck
            sort, // ✅ Changed sortBy to 'sort' to match standard UI query
        } = req.query;

        const filter = { isPublished: true };

        // Frontend default is "All statuses", so if not provided, show active ones
        filter.status = status ? status : { $in: ["Available", "Reserved", "Booked", "Sold"] };

        // Basic filters
        if (brand) filter.brand = new RegExp(`^${brand}$`, "i");
        if (brandRef) filter.brandRef = brandRef;
        if (categoryRef) filter.categoryRef = categoryRef;
        if (model) filter.model = new RegExp(model, "i");
        if (location) filter.location = new RegExp(location, "i");
        if (fuelType) filter.fuelType = fuelType;
        if (transmission) filter.transmission = transmission;
        if (bodyType) filter.bodyType = bodyType;
        if (featured === "true") filter.featured = true;

        // ✅ RC Check Filter (Not checked / Verified)
        if (rcCheck) filter.rcCheck = rcCheck;

        // Price & Year Range
        if (minPrice || maxPrice) {
            filter.askingPrice = {};
            if (minPrice) filter.askingPrice.$gte = Number(minPrice);
            if (maxPrice) filter.askingPrice.$lte = Number(maxPrice);
        }
        if (minYear || maxYear) {
            filter.year = {};
            if (minYear) filter.year.$gte = Number(minYear);
            if (maxYear) filter.year.$lte = Number(maxYear);
        }
        if (maxKilometers) filter.kilometers = { $lte: Number(maxKilometers) };

        // Search filter
        if (search) {
            filter.$or = [
                { brand: new RegExp(search, "i") },
                { model: new RegExp(search, "i") },
                { variant: new RegExp(search, "i") },
                { description: new RegExp(search, "i") },
                { stockId: new RegExp(search, "i") }, // Added stockId to search (SH-08115)
            ];
        }

        // ✅ SORTING LOGIC (Matching Frontend Dropdown)
        let sortOptions = { createdAt: -1 }; // Default: Most recent

        switch (sort) {
            case "recent":
                sortOptions = { createdAt: -1 };
                break;
            case "name_asc": // For "Sort: Name A-Z"
                sortOptions = { brand: 1, model: 1 }; // Sort by Brand then Model
                break;
            case "price_low_high": // For "Sort: Price low-high"
                sortOptions = { askingPrice: 1 };
                break;

            // Optional: If you add more options later
            case "price_high_low":
                sortOptions = { askingPrice: -1 };
                break;
            case "year_desc":
                sortOptions = { year: -1 };
                break;
            default:
                sortOptions = { createdAt: -1 };
        }

        const [data, total] = await Promise.all([
            Vehicle.find(filter)
                .populate("brandRef", "name logo slug")
                .populate("categoryRef", "name slug")
                .sort(sortOptions) // ✅ Applied dynamic sorting here
                .skip((page - 1) * limit)
                .limit(limit),
            Vehicle.countDocuments(filter),
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
   PUBLIC — GET /api/v1/vehicles/:slugOrId
   ============================================================ */
export const getVehicle = async (req, res, next) => {
    try {
        const { slugOrId } = req.params;
        const query = mongoose.isValidObjectId(slugOrId)
            ? { _id: slugOrId }
            : { slug: slugOrId };

        const vehicle = await Vehicle.findOne(query)
            .populate("brandRef", "name logo slug website country")
            .populate("categoryRef", "name slug description")
            .populate("soldTo", "name phone city")
            .populate("saleExecutive", "name");

        if (!vehicle) return fail(res, "Vehicle not found", 404);

        await Vehicle.updateOne({ _id: vehicle._id }, { $inc: { views: 1 } });

        return ok(res, vehicle);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   PUBLIC — GET /api/v1/vehicles/:id/similar
   ============================================================ */
export const getSimilarVehicles = async (req, res, next) => {
    try {
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        const similar = await Vehicle.find({
            _id: { $ne: vehicle._id },
            status: "Available",
            isPublished: true,
            $or: [
                { brandRef: vehicle.brandRef },
                { categoryRef: vehicle.categoryRef },
                {
                    askingPrice: {
                        $gte: vehicle.askingPrice * 0.8,
                        $lte: vehicle.askingPrice * 1.2,
                    },
                },
            ],
        })
            .populate("brandRef", "name logo")
            .populate("categoryRef", "name")
            .limit(6)
            .sort("-createdAt");

        return ok(res, similar);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — POST /api/v1/vehicles
   ============================================================ */
export const createVehicle = async (req, res, next) => {
    try {
        const stockId = req.body.stockId || (await generateStockId());

        // ---- Auto-resolve brandRef / categoryRef ----
        let brandRef = req.body.brandRef || null;
        let categoryRef = req.body.categoryRef || null;

        // If only brandRef provided → denormalize brand name
        if (brandRef && mongoose.isValidObjectId(brandRef)) {
            const brandDoc = await Brand.findById(brandRef);
            if (brandDoc) req.body.brand = brandDoc.name;
        }
        // If only brand name provided → try find matching brand
        else if (req.body.brand) {
            const brandDoc = await Brand.findOne({
                name: new RegExp(`^${req.body.brand}$`, "i"),
            });
            if (brandDoc) brandRef = brandDoc._id;
        }

        // Same for category
        if (categoryRef && mongoose.isValidObjectId(categoryRef)) {
            const catDoc = await Category.findById(categoryRef);
            if (catDoc) req.body.category = catDoc.name;
        } else if (req.body.category) {
            const catDoc = await Category.findOne({
                name: new RegExp(`^${req.body.category}$`, "i"),
            });
            if (catDoc) categoryRef = catDoc._id;
        }

        // ---- Upload images ----
        let imageUrls = [];
        let imagePublicIds = [];
        if (req.files?.images?.length) {
            const uploaded = await uploadMultipleToCloudinary(req.files.images);
            imageUrls = uploaded.map((f) => f.url);
            imagePublicIds = uploaded.map((f) => f.public_id);
        }

        // ---- Upload video ----
        let videoUrl = null;
        let videoPublicId = null;
        if (req.files?.video?.length) {
            const v = req.files.video[0];
            const uploaded = await uploadToCloudinary(
                v.buffer,
                "video",
                `${Date.now()}-${v.originalname}`
            );
            videoUrl = uploaded.url;
            videoPublicId = uploaded.public_id;
        }

        const vehicle = await Vehicle.create({
            ...req.body,
            stockId,
            brandRef,
            categoryRef,
            images: imageUrls,
            video: videoUrl,
            imagePublicIds,
            videoPublicId,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        return ok(res, vehicle, "Vehicle created", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — PATCH /api/v1/vehicles/:id
   ============================================================ */
export const updateVehicle = async (req, res, next) => {
    try {
        const protectedFields = ["slug", "views", "soldTo", "soldPrice", "soldAt", "saleExecutive"];
        protectedFields.forEach((f) => delete req.body[f]);

        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        // ---- Resolve brand/category refs if provided ----
        if (req.body.brandRef && mongoose.isValidObjectId(req.body.brandRef)) {
            const brandDoc = await Brand.findById(req.body.brandRef);
            if (brandDoc) req.body.brand = brandDoc.name;
        }
        if (req.body.categoryRef && mongoose.isValidObjectId(req.body.categoryRef)) {
            const catDoc = await Category.findById(req.body.categoryRef);
            if (catDoc) req.body.category = catDoc.name;
        }

        // ---- Images ----
        if (req.files?.images?.length) {
            const uploaded = await uploadMultipleToCloudinary(req.files.images);
            if (vehicle.imagePublicIds?.length) {
                await deleteMultipleFromCloudinary(vehicle.imagePublicIds, "image");
            }
            vehicle.images = uploaded.map((f) => f.url);
            vehicle.imagePublicIds = uploaded.map((f) => f.public_id);
        }

        // ---- Video ----
        if (req.files?.video?.length) {
            const v = req.files.video[0];
            if (vehicle.videoPublicId) {
                await deleteFromCloudinary(vehicle.videoPublicId, "video");
            }
            const uploaded = await uploadToCloudinary(
                v.buffer,
                "video",
                `${Date.now()}-${v.originalname}`
            );
            vehicle.video = uploaded.url;
            vehicle.videoPublicId = uploaded.public_id;
        }

        Object.assign(vehicle, req.body);
        vehicle.updatedBy = req.user._id;
        await vehicle.save();

        return ok(res, vehicle, "Vehicle updated");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — PATCH /api/v1/vehicles/:id/status
   ============================================================ */
export const updateStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        const allowed = ["Available", "Reserved", "Booked", "Sold", "Inactive"];
        if (!allowed.includes(status))
            return fail(res, "Invalid status value", 400);

        const update = { status, updatedBy: req.user._id };
        if (status === "Reserved") update.reservedAt = new Date();
        if (status === "Sold") update.soldAt = new Date();

        const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        return ok(res, vehicle, `Vehicle marked as ${status}`);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — PATCH /api/v1/vehicles/:id/sold
   ============================================================ */
export const markAsSold = async (req, res, next) => {
    try {
        const { soldTo, soldPrice, saleExecutive } = req.body;

        const vehicle = await Vehicle.findByIdAndUpdate(
            req.params.id,
            {
                status: "Sold",
                soldTo,
                soldPrice,
                saleExecutive: saleExecutive || req.user._id,
                soldAt: new Date(),
                updatedBy: req.user._id,
            },
            { new: true, runValidators: true }
        );

        if (!vehicle) return fail(res, "Vehicle not found", 404);
        return ok(res, vehicle, "Vehicle marked as sold");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — PATCH /api/v1/vehicles/:id/featured
   ============================================================ */
export const toggleFeatured = async (req, res, next) => {
    try {
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        vehicle.featured = !vehicle.featured;
        vehicle.updatedBy = req.user._id;
        await vehicle.save();

        return ok(res, vehicle, `Featured ${vehicle.featured ? "enabled" : "disabled"}`);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — DELETE /api/v1/vehicles/:id
   ============================================================ */
export const deleteVehicle = async (req, res, next) => {
    try {
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        if (vehicle.imagePublicIds?.length) {
            await deleteMultipleFromCloudinary(vehicle.imagePublicIds, "image");
        }
        if (vehicle.videoPublicId) {
            await deleteFromCloudinary(vehicle.videoPublicId, "video");
        }

        vehicle.deletedAt = new Date();
        vehicle.status = "Inactive";
        vehicle.updatedBy = req.user._id;
        await vehicle.save();

        return ok(res, {}, "Vehicle deleted");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — GET /api/v1/vehicles/admin/all
   ============================================================ */
export const adminListVehicles = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { status, brand, location, search, brandRef, categoryRef } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (brand) filter.brand = new RegExp(brand, "i");
        if (location) filter.location = new RegExp(location, "i");
        if (brandRef) filter.brandRef = brandRef;
        if (categoryRef) filter.categoryRef = categoryRef;
        if (search)
            filter.$or = [
                { brand: new RegExp(search, "i") },
                { model: new RegExp(search, "i") },
                { stockId: new RegExp(search, "i") },
                { registrationNumber: new RegExp(search, "i") },
            ];

        const [data, total] = await Promise.all([
            Vehicle.find(filter)
                .populate("brandRef", "name logo")
                .populate("categoryRef", "name")
                .populate("createdBy", "name")
                .populate("updatedBy", "name")
                .sort("-createdAt")
                .skip((page - 1) * limit)
                .limit(limit),
            Vehicle.countDocuments(filter),
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
   ADMIN — GET /api/v1/vehicles/stats/summary
   ============================================================ */
export const getInventoryStats = async (req, res, next) => {
    try {
        const [statusCounts, totalValue, featuredCount] = await Promise.all([
            Vehicle.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
            Vehicle.aggregate([
                { $match: { status: { $in: ["Available", "Reserved", "Booked"] } } },
                { $group: { _id: null, totalValue: { $sum: "$askingPrice" } } },
            ]),
            Vehicle.countDocuments({ featured: true, isPublished: true }),
        ]);

        const stats = {
            Available: 0, Reserved: 0, Booked: 0, Sold: 0, Inactive: 0,
        };
        statusCounts.forEach((s) => (stats[s._id] = s.count));

        return ok(res, {
            ...stats,
            total: Object.values(stats).reduce((a, b) => a + b, 0),
            activeInventoryValue: totalValue[0]?.totalValue || 0,
            featured: featuredCount,
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — GET /api/v1/vehicles/:id/sale
   ============================================================ */
export const getVehicleSale = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id))
            return fail(res, "Invalid vehicle id", 400);

        const vehicle = await Vehicle.findById(id)
            .populate("brandRef", "name logo")
            .populate("categoryRef", "name")
            .populate("soldTo", "name phone email city state source")
            .populate("saleExecutive", "name email role");

        if (!vehicle) return fail(res, "Vehicle not found", 404);

        if (vehicle.status !== "Sold") {
            return ok(res, { isSold: false, vehicle, sale: null }, "Vehicle is not sold yet");
        }

        const Sale = (await import("../models/Sale.js")).default;

        const sale = await Sale.findOne({ vehicle: vehicle._id })
            .populate("customer", "name phone email city state source")
            .populate("salesExecutive", "name email role")
            .populate("lead", "status source campaign")
            .populate("campaign", "name source type")
            .populate("documents.uploadedBy", "name");

        return ok(res, { isSold: true, vehicle, sale }, "Vehicle sale record fetched");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — GET /api/v1/vehicles/:id/history
   ============================================================ */
export const getVehicleHistory = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id))
            return fail(res, "Invalid vehicle id", 400);

        const vehicle = await Vehicle.findById(id)
            .populate("brandRef", "name logo")
            .populate("categoryRef", "name")
            .populate("soldTo", "name phone email")
            .populate("createdBy", "name")
            .populate("updatedBy", "name");

        if (!vehicle) return fail(res, "Vehicle not found", 404);

        const [
            { default: Lead },
            { default: Appointment },
            { default: Reservation },
            { default: Sale },
        ] = await Promise.all([
            import("../models/Lead.js"),
            import("../models/Appointment.js"),
            import("../models/Reservation.js"),
            import("../models/Sale.js"),
        ]);

        const [leads, appointments, reservations, sale] = await Promise.all([
            Lead.find({ vehicle: vehicle._id })
                .populate("customer", "name phone city source")
                .populate("assignedTo", "name")
                .select("customer status source assignedTo createdAt nextFollowUpAt")
                .sort("-createdAt"),

            Appointment.find({ vehicle: vehicle._id })
                .populate("customer", "name phone")
                .populate("assignedTo", "name")
                .select("customer type status scheduledAt completedAt assignedTo")
                .sort("-scheduledAt"),

            Reservation.find({ vehicle: vehicle._id })
                .populate("customer", "name phone")
                .select("customer status paymentStatus amount createdAt referenceNumber")
                .sort("-createdAt"),

            Sale.findOne({ vehicle: vehicle._id })
                .populate("customer", "name phone email city")
                .populate("salesExecutive", "name email"),
        ]);

        return ok(res, {
            vehicle,
            summary: {
                totalLeads: leads.length,
                totalAppointments: appointments.length,
                totalReservations: reservations.length,
                isSold: !!sale,
            },
            leads,
            appointments,
            reservations,
            sale,
        }, "Vehicle history fetched");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   PUBLIC — GET /api/v1/vehicles/:id/cta
   ============================================================ */
import { buildWhatsAppCTA, buildCallCTA, buildVehicleWhatsAppMessage } from "../services/notification.service.js";

export const getVehicleCTA = async (req, res, next) => {
    try {
        const vehicle = await Vehicle.findById(req.params.id)
            .select("brand model variant year askingPrice stockId");

        if (!vehicle) return fail(res, "Vehicle not found", 404);

        const dealerPhone = process.env.DEALER_PHONE;
        const dealerWhatsApp = process.env.DEALER_WHATSAPP;

        return ok(res, {
            whatsapp: {
                url: buildWhatsAppCTA(vehicle, dealerWhatsApp),
                message: buildVehicleWhatsAppMessage(vehicle),
                number: dealerWhatsApp,
            },
            call: {
                url: buildCallCTA(dealerPhone),
                number: dealerPhone,
            },
        });
    } catch (err) {
        next(err);
    }
};