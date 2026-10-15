import mongoose from "mongoose";
import Vehicle from "../models/Vehicle.js";
import { ok, fail } from "../utils/response.js";
import { uploadMultipleToCloudinary, uploadToCloudinary, deleteMultipleFromCloudinary } from "../utils/cloudinary.js";

// Helper — generate next stock id
const generateStockId = async () => {
    const count = await Vehicle.countDocuments();
    const id = `SLC-${String(count + 1).padStart(5, "0")}`;
    return id;
};

// PUBLIC: GET /api/v1/vehicles
export const listVehicles = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 12;
        const {
            search, brand, model, city,
            fuelType, transmission, bodyType,
            minPrice, maxPrice, minYear, maxYear,
            maxKilometers, status, featured,
            sortBy = "-createdAt",
        } = req.query;

        const filter = { isPublished: true };

        // Public listing only shows these statuses by default
        filter.status = status ? status : { $in: ["available", "reserved", "booked", "sold"] };

        if (brand) filter.brand = new RegExp(`^${brand}$`, "i");
        if (model) filter.model = new RegExp(model, "i");
        if (city) filter["location.city"] = new RegExp(`^${city}$`, "i");
        if (fuelType) filter.fuelType = fuelType;
        if (transmission) filter.transmission = transmission;
        if (bodyType) filter.bodyType = bodyType;
        if (featured === "true") filter.featured = true;

        if (minPrice || maxPrice) {
            filter.price = {};
            if (minPrice) filter.price.$gte = Number(minPrice);
            if (maxPrice) filter.price.$lte = Number(maxPrice);
        }
        if (minYear || maxYear) {
            filter.year = {};
            if (minYear) filter.year.$gte = Number(minYear);
            if (maxYear) filter.year.$lte = Number(maxYear);
        }
        if (maxKilometers) filter.kilometers = { $lte: Number(maxKilometers) };

        if (search) {
            filter.$or = [
                { brand: new RegExp(search, "i") },
                { model: new RegExp(search, "i") },
                { variant: new RegExp(search, "i") },
                { description: new RegExp(search, "i") },
            ];
        }

        const [data, total] = await Promise.all([
            Vehicle.find(filter).sort(sortBy).skip((page - 1) * limit).limit(limit),
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

// PUBLIC: GET /api/v1/vehicles/:slugOrId
export const getVehicle = async (req, res, next) => {
    try {
        const { slugOrId } = req.params;
        const query = mongoose.isValidObjectId(slugOrId)
            ? { _id: slugOrId }
            : { slug: slugOrId };

        const vehicle = await Vehicle.findOne(query)
            .populate("soldTo", "name phone city")
            .populate("saleExecutive", "name");

        if (!vehicle) return fail(res, "Vehicle not found", 404);

        // Increment views (BRD 6.3 – tracking)
        await Vehicle.updateOne({ _id: vehicle._id }, { $inc: { views: 1 } });

        return ok(res, vehicle);
    } catch (err) {
        next(err);
    }
};

// PUBLIC: GET /api/v1/vehicles/:id/similar
export const getSimilarVehicles = async (req, res, next) => {
    try {
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        const similar = await Vehicle.find({
            _id: { $ne: vehicle._id },
            status: "available",
            isPublished: true,
            $or: [
                { brand: vehicle.brand },
                { bodyType: vehicle.bodyType },
                {
                    price: {
                        $gte: vehicle.price * 0.8,
                        $lte: vehicle.price * 1.2,
                    },
                },
            ],
        })
            .limit(6)
            .sort("-createdAt");

        return ok(res, similar);
    } catch (err) {
        next(err);
    }
};

export const createVehicle = async (req, res, next) => {
    try {
        const stockId = req.body.stockId || (await generateStockId());

        // ---- 1. Upload images to Cloudinary ----
        let imageUrls = [];
        let imagePublicIds = [];

        if (req.files?.images?.length) {
            const uploaded = await uploadMultipleToCloudinary(req.files.images);
            imageUrls = uploaded.map((f) => f.url);
            imagePublicIds = uploaded.map((f) => f.public_id);
        }

        // ---- 2. Upload video (if any) ----
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

        // ---- 3. Create vehicle ----
        const vehicle = await Vehicle.create({
            ...req.body,
            stockId,
            images: imageUrls,
            video: videoUrl,
            // store public_ids for later deletion
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

// ADMIN: PATCH /api/v1/vehicles/:id
export const updateVehicle = async (req, res, next) => {
    try {
        const protectedFields = ["slug", "views", "soldTo", "soldPrice", "soldAt", "saleExecutive"];
        protectedFields.forEach((f) => delete req.body[f]);

        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        // ---- Handle new image uploads ----
        if (req.files?.images?.length) {
            const uploaded = await uploadMultipleToCloudinary(req.files.images);

            // Optionally delete old images from Cloudinary
            if (vehicle.imagePublicIds?.length) {
                await deleteMultipleFromCloudinary(vehicle.imagePublicIds, "image");
            }

            vehicle.images = uploaded.map((f) => f.url);
            vehicle.imagePublicIds = uploaded.map((f) => f.public_id);
        }

        // ---- Handle new video ----
        if (req.files?.video?.length) {
            const v = req.files.video[0];

            // delete old video
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

        // ---- Apply other scalar fields ----
        Object.assign(vehicle, req.body);
        vehicle.updatedBy = req.user._id;
        await vehicle.save();

        return ok(res, vehicle, "Vehicle updated");
    } catch (err) {
        next(err);
    }
};

// ADMIN: PATCH /api/v1/vehicles/:id/status
export const updateStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        const allowed = ["available", "reserved", "booked", "sold", "inactive"];
        if (!allowed.includes(status))
            return fail(res, "Invalid status value", 400);

        const update = { status, updatedBy: req.user._id };
        if (status === "reserved") update.reservedAt = new Date();
        if (status === "sold") update.soldAt = new Date();

        const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, update, {
            new: true,
        });
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        // BRD 32/33: website reads same backend → status auto-reflected
        return ok(res, vehicle, `Vehicle marked as ${status}`);
    } catch (err) {
        next(err);
    }
};

// ADMIN: PATCH /api/v1/vehicles/:id/sold
export const markAsSold = async (req, res, next) => {
    try {
        const { soldTo, soldPrice, saleExecutive } = req.body;

        const vehicle = await Vehicle.findByIdAndUpdate(
            req.params.id,
            {
                status: "sold",
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

// ADMIN: PATCH /api/v1/vehicles/:id/featured
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

// ADMIN: DELETE /api/v1/vehicles/:id
export const deleteVehicle = async (req, res, next) => {
    try {
        const vehicle = await Vehicle.findById(req.params.id);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        // 🧹 Clean up Cloudinary assets
        if (vehicle.imagePublicIds?.length) {
            await deleteMultipleFromCloudinary(vehicle.imagePublicIds, "image");
        }
        if (vehicle.videoPublicId) {
            await deleteFromCloudinary(vehicle.videoPublicId, "video");
        }

        vehicle.deletedAt = new Date();
        vehicle.status = "inactive";
        vehicle.updatedBy = req.user._id;
        await vehicle.save();

        return ok(res, {}, "Vehicle deleted");
    } catch (err) {
        next(err);
    }
};

// ADMIN: GET /api/v1/vehicles/admin/all
export const adminListVehicles = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { status, brand, city, search } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (brand) filter.brand = new RegExp(brand, "i");
        if (city) filter["location.city"] = new RegExp(city, "i");
        if (search)
            filter.$or = [
                { brand: new RegExp(search, "i") },
                { model: new RegExp(search, "i") },
                { stockId: new RegExp(search, "i") },
                { registrationNumber: new RegExp(search, "i") },
            ];

        const [data, total] = await Promise.all([
            Vehicle.find(filter)
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

// ADMIN: GET /api/v1/vehicles/stats/summary  (BRD 34.1)
export const getInventoryStats = async (req, res, next) => {
    try {
        const [statusCounts, totalValue, featuredCount] = await Promise.all([
            Vehicle.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
            Vehicle.aggregate([
                { $match: { status: { $in: ["available", "reserved", "booked"] } } },
                { $group: { _id: null, totalValue: { $sum: "$price" } } },
            ]),
            Vehicle.countDocuments({ featured: true, isPublished: true }),
        ]);

        const stats = {
            available: 0,
            reserved: 0,
            booked: 0,
            sold: 0,
            inactive: 0,
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
   CRM — Get the Sale record for a vehicle (BRD 31)
   GET /api/v1/vehicles/:id/sale
   Returns the vehicle + buyer + sale record in one shot.
   ============================================================ */
export const getVehicleSale = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id))
            return fail(res, "Invalid vehicle id", 400);

        const vehicle = await Vehicle.findById(id)
            .populate("soldTo", "name phone email city state source")
            .populate("saleExecutive", "name email role");

        if (!vehicle) return fail(res, "Vehicle not found", 404);

        // Only sold vehicles have a linked sale
        if (vehicle.status !== "sold") {
            return ok(res, {
                isSold: false,
                vehicle,
                sale: null,
            }, "Vehicle is not sold yet");
        }

        // Lazy import avoids circular dependency at file top
        const Sale = (await import("../models/Sale.js")).default;

        const sale = await Sale.findOne({ vehicle: vehicle._id })
            .populate("customer", "name phone email city state source")
            .populate("salesExecutive", "name email role")
            .populate("lead", "status source campaign")
            .populate("campaign", "name source type")
            .populate("documents.uploadedBy", "name");

        return ok(res, {
            isSold: true,
            vehicle,
            sale,
        }, "Vehicle sale record fetched");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Full history timeline for a vehicle
   GET /api/v1/vehicles/:id/history
   Returns: vehicle, linked leads, appointments, reservations,
            and sale (if any) — perfect for the CRM detail page.
   ============================================================ */
export const getVehicleHistory = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id))
            return fail(res, "Invalid vehicle id", 400);

        const vehicle = await Vehicle.findById(id)
            .populate("soldTo", "name phone email")
            .populate("createdBy", "name")
            .populate("updatedBy", "name");

        if (!vehicle) return fail(res, "Vehicle not found", 404);

        // Lazy imports to avoid circular deps
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

            // Reservation model will exist after next step — safe even if collection empty
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
   BRD 13 — Persistent WhatsApp + Click-to-Call CTA
   PUBLIC: GET /api/v1/vehicles/:id/cta
   ============================================================ */
// controllers/vehicle.controller.js
import { buildWhatsAppCTA, buildCallCTA, buildVehicleWhatsAppMessage } from "../services/notification.service.js";

export const getVehicleCTA = async (req, res, next) => {
    try {
        const vehicle = await Vehicle.findById(req.params.id)
            .select("brand model variant year price stockId");

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
// export const getVehicleCTA = async (req, res, next) => {
//     try {
//         const { id } = req.params;
//         if (!mongoose.isValidObjectId(id))
//             return fail(res, "Invalid vehicle id", 400);

//         const vehicle = await Vehicle.findById(id)
//             .select("brand model variant year price stockId images location status");

//         if (!vehicle) return fail(res, "Vehicle not found", 404);

//         const dealerPhone = process.env.DEALER_PHONE || "+919876543210";
//         const dealerWhatsApp = process.env.DEALER_WHATSAPP || dealerPhone;

//         const { buildWhatsAppCTA, buildCallCTA, buildVehicleWhatsAppMessage } =
//             await import("../services/notification.service.js");

//         return ok(res, {
//             whatsapp: {
//                 url: buildWhatsAppCTA(vehicle, dealerWhatsApp),
//                 message: buildVehicleWhatsAppMessage(vehicle),
//                 number: dealerWhatsApp,
//             },
//             call: {
//                 url: buildCallCTA(dealerPhone),
//                 number: dealerPhone,
//             },
//         }, "CTA links fetched");
//     } catch (err) {
//         next(err);
//     }
// };