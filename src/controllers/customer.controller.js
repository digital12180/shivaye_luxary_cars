import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import Vehicle from "../models/Vehicle.js";
import { ok, fail } from "../utils/response.js";
import { extractAttribution } from "../services/attribution.service.js";
import { captureLocation } from "../services/geolocation.service.js";
import Lead from "../models/Lead.js";
import Appointment from "../models/Appointment.js";
import Reservation from "../models/Reservation.js";


export const publicCreateCustomer = async (req, res, next) => {
    try {
        const attribution = extractAttribution(req);
        const { location } = await captureLocation(req);

        const { name, email, phone, city, state, source, interestedIn, notes } = req.body;

        if (!name || !phone) return fail(res, "Name and phone are required", 400);

        let customer = await Customer.findOne({ phone });
        if (customer) {
            if (attribution?.latestTouchSource) customer.attribution.latestTouchSource = attribution.latestTouchSource;
            if (city && !customer.city) customer.city = city;
            if (state && !customer.state) customer.state = state;
            customer.lastContactedAt = new Date();
            await customer.save();
            return ok(res, customer, "Existing customer found, updated");
        }

        const ip = req.ip || req.headers["x-forwarded-for"] || null;

        customer = await Customer.create({
            name, email, phone, city, state,
            source: source || "direct_website",
            attribution: attribution || {},
            interestedIn: interestedIn || "buy",
            notes,
            ipAddress: ip,
            ipLocation: location || null,
        });

        return ok(res, customer, "Customer created", 201);
    } catch (err) {
        next(err);
    }
};

export const getMyProfile = async (req, res, next) => {
    try {
        // 1. Safely check if the middleware actually set req.user
        if (!req.user || !req.user._id) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: req.user is missing. Check token/cookie transport."
            });
        }

        // 2. Proceed with the fetch
        const customer = await Customer.findById(req.user._id)
            .populate("savedCars", "brand model year price images slug status");

        if (!customer) return fail(res, "Customer not found", 404);
        return ok(res, customer);
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/customers/me
export const updateMyProfile = async (req, res, next) => {
    try {
        const allowed = [
            "name", "email", "alternatePhone",
            "city", "state", "country", "address", "pincode",
        ];
        const payload = {};
        allowed.forEach((k) => {
            if (req.body[k] !== undefined) payload[k] = req.body[k];
        });

        const customer = await Customer.findByIdAndUpdate(
            req.user._id,
            payload,
            { new: true, runValidators: true }
        );
        if (!customer) return fail(res, "Customer not found", 404);
        return ok(res, customer, "Profile updated");
    } catch (err) {
        next(err);
    }
};

// POST /api/v1/customers/me/saved-cars/:vehicleId  (BRD 27.1)
export const saveCar = async (req, res, next) => {
    try {
        const vehicle = await Vehicle.findById(req.params.vehicleId);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        await Customer.findByIdAndUpdate(req.user._id, {
            $addToSet: { savedCars: vehicle._id },
        });

        return ok(res, {}, "Car saved");
    } catch (err) {
        next(err);
    }
};

// DELETE /api/v1/customers/me/saved-cars/:vehicleId
export const removeSavedCar = async (req, res, next) => {
    try {
        await Customer.findByIdAndUpdate(req.user._id, {
            $pull: { savedCars: req.params.vehicleId },
        });
        return ok(res, {}, "Car removed from saved");
    } catch (err) {
        next(err);
    }
};

/* ================= CRM / ADMIN ================= */

export const listCustomers = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        
        const { search, source, city, interestedIn, isActive, sort } = req.query;

        // ==========================================
        // 1. BUILD MATCH FILTER
        // ==========================================
        const matchFilter = {
            deletedAt: null // 🔥 Fix: Soft-delete filter explicit
        };

        if (source) matchFilter.source = source;
        if (city) matchFilter.city = new RegExp(city, "i");
        if (interestedIn) matchFilter.interestedIn = interestedIn;
        
        // Boolean handling for isActive
        if (isActive !== undefined && isActive !== "") {
            matchFilter.isActive = isActive === "true" || isActive === true;
        }

        if (search) {
            matchFilter.$or = [
                { name: new RegExp(search, "i") },
                { phone: new RegExp(search, "i") },
                { email: new RegExp(search, "i") },
                { customerNumber: new RegExp(search, "i") },
            ];
        }

        // ==========================================
        // 2. SORTING LOGIC
        // ==========================================
        let sortOptions = { createdAt: -1 };
        if (sort === "name_asc") sortOptions = { name: 1 };
        else if (sort === "name_desc") sortOptions = { name: -1 };
        else if (sort === "recent") sortOptions = { createdAt: -1 };

        // ==========================================
        // 3. AGGREGATION PIPELINE (Optimized)
        // ==========================================
        const pipeline = [
            { $match: matchFilter },
            { $sort: sortOptions },
            { $skip: skip },
            { $limit: limit },

            // --- Populate Saved Cars ---
            {
                $lookup: {
                    from: "vehicles",
                    localField: "savedCars",
                    foreignField: "_id",
                    as: "savedCars",
                    pipeline: [
                        { $project: { brand: 1, model: 1, year: 1, price: 1, images: 1, slug: 1, status: 1 } }
                    ]
                }
            },
            // --- Populate CreatedBy (User) ---
            {
                $lookup: {
                    from: "users",
                    localField: "createdBy",
                    foreignField: "_id",
                    as: "createdBy",
                    pipeline: [{ $project: { name: 1, email: 1, role: 1 } }]
                }
            },
            { $unwind: { path: "$createdBy", preserveNullAndEmptyArrays: true } },
            // --- Populate UpdatedBy (User) ---
            {
                $lookup: {
                    from: "users",
                    localField: "updatedBy",
                    foreignField: "_id",
                    as: "updatedBy",
                    pipeline: [{ $project: { name: 1, email: 1, role: 1 } }]
                }
            },
            { $unwind: { path: "$updatedBy", preserveNullAndEmptyArrays: true } },

            // --- Attach Enquiries Count ---
            {
                $lookup: {
                    from: "leads",
                    localField: "_id",
                    foreignField: "customer",
                    as: "enquiries",
                    pipeline: [{ $match: { deletedAt: null } }, { $count: "count" }]
                }
            },
            // --- Attach Appointments Count ---
            {
                $lookup: {
                    from: "appointments",
                    localField: "_id",
                    foreignField: "customer",
                    as: "appointments",
                    pipeline: [{ $match: { deletedAt: null } }, { $count: "count" }]
                }
            },
            // --- Attach Purchased Vehicle ---
            {
                $lookup: {
                    from: "vehicles",
                    localField: "_id",
                    foreignField: "soldTo",
                    as: "purchasedVehicle",
                    pipeline: [
                        { $match: { status: "Sold", deletedAt: null } },
                        { $project: { brand: 1, model: 1, year: 1, soldPrice: 1 } },
                        { $limit: 1 }
                    ]
                }
            },

            // --- Format Final Document ---
            {
                $addFields: {
                    enquiriesCount: { $ifNull: [{ $arrayElemAt: ["$enquiries.count", 0] }, 0] },
                    appointmentsCount: { $ifNull: [{ $arrayElemAt: ["$appointments.count", 0] }, 0] },
                    purchasedVehicle: { 
                        $let: {
                            vars: { pv: { $arrayElemAt: ["$purchasedVehicle", 0] } },
                            in: {
                                $cond: [
                                    { $ifNull: ["$$pv", false] },
                                    { $concat: ["$$pv.brand", " ", "$$pv.model"] },
                                    null
                                ]
                            }
                        }
                    }
                }
            },
            // --- Remove temporary lookup arrays ---
            { $project: { enquiries: 0, appointments: 0, purchasedVehicle: 0, password: 0, otp: 0, refreshTokenHash: 0 } }
        ];

        // Run Data & Count in parallel
        const [data, total] = await Promise.all([
            Customer.aggregate(pipeline),
            Customer.countDocuments(matchFilter)
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

// GET /api/v1/customers/:id
export const getCustomer = async (req, res, next) => {
    try {
        const customer = await Customer.findById(req.params.id)
            .populate("savedCars", "brand model year askingPrice images slug status")
            .populate("createdBy", "name")
            .populate("updatedBy", "name")
            .lean();

        if (!customer) return fail(res, "Customer not found", 404);

        // ✅ Fetch related counts for Record Overview
        const [enquiriesCount, appointmentsCount, reservationsCount, purchasedVehicle, recentLeads] = await Promise.all([
            Lead.countDocuments({ customer: customer._id }),
            Appointment.countDocuments({ customer: customer._id }),
            Reservation.countDocuments({ customer: customer._id }), // Assuming Reservation model exists
            Vehicle.findOne({ soldTo: customer._id, status: "Sold" }).select("brand model year askingPrice").lean(),
            Lead.find({ customer: customer._id })
                .sort("-createdAt")
                .limit(5)
                .select("leadNumber interestedVehicle status createdAt")
                .lean()
        ]);

        return ok(res, {
            ...customer,
            stats: {
                enquiriesCount,
                appointmentsCount,
                reservationsCount,
                purchasedVehicle: purchasedVehicle ? `${purchasedVehicle.brand} ${purchasedVehicle.model}` : null,
            },
            recentLeads // For "Customer history" timeline
        });
    } catch (err) {
        next(err);
    }
};

// POST /api/v1/customers  (manual / walk-in entry – BRD 11.1)
export const createCustomer = async (req, res, next) => {
    try {
        const { name, phone } = req.body;
        if (!name || !phone) return fail(res, "Name and phone are required", 400);

        const existing = await Customer.findOne({ phone });
        if (existing) return fail(res, "Customer with this phone already exists", 409);

        const customer = await Customer.create({
            ...req.body,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        return ok(res, customer, "Customer created", 201);
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/customers/:id
export const updateCustomer = async (req, res, next) => {
    try {
        const protectedFields = ["password", "otp", "otpExpires", "deletedAt", "savedCars", "customerNumber"];
        protectedFields.forEach((f) => delete req.body[f]);

        const customer = await Customer.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedBy: req.user._id },
            { new: true, runValidators: true }
        );
        if (!customer) return fail(res, "Customer not found", 404);

        return ok(res, customer, "Customer updated");
    } catch (err) {
        next(err);
    }
};

// PATCH /api/v1/customers/:id/status
export const toggleCustomerStatus = async (req, res, next) => {
    try {
        const customer = await Customer.findById(req.params.id);
        if (!customer) return fail(res, "Customer not found", 404);

        customer.isActive = !customer.isActive;
        customer.updatedBy = req.user._id;
        await customer.save();

        return ok(res, customer, `Customer ${customer.isActive ? "activated" : "deactivated"}`);
    } catch (err) {
        next(err);
    }
};

// DELETE /api/v1/customers/:id
export const deleteCustomer = async (req, res, next) => {
    try {
        const customer = await Customer.findByIdAndUpdate(
            req.params.id,
            { deletedAt: new Date(), isActive: false, updatedBy: req.user._id },
            { new: true }
        );
        if (!customer) return fail(res, "Customer not found", 404);

        return ok(res, {}, "Customer deleted");
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/customers/stats/summary  (BRD 34.3)
export const getCustomerStats = async (req, res, next) => {
    try {
        const [bySource, byCity, byIntent, total] = await Promise.all([
            Customer.aggregate([
                { $group: { _id: "$source", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            Customer.aggregate([
                { $match: { city: { $ne: null } } },
                { $group: { _id: "$city", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            Customer.aggregate([
                { $group: { _id: "$interestedIn", count: { $sum: 1 } } },
            ]),
            Customer.countDocuments(),
        ]);

        return ok(res, { total, bySource, byCity, byIntent });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/customer/reserved-cars
 * Auth required (customer JWT)
 */
export async function getMyReservedCars(req, res) {
    try {
        const customerId = req.user.id; // set by auth middleware

        const reservations = await Reservation.find({
            customer: customerId,
            status: "Completed",          // adapt to your status field
        })
            .populate("vehicle")
            .sort({ createdAt: -1 })
            .lean();

        return res.json({ success: true, data: reservations });
    } catch (err) {
        console.error("getMyReservedCars error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
}