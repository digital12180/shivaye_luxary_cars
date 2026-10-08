import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import Vehicle from "../models/Vehicle.js";
import { ok, fail } from "../utils/response.js";
import extractAttribution from "../services/attribution.service.js";
import captureIpLocation from "../services/geolocation.service.js";

/* ================= PUBLIC / CUSTOMER PANEL ================= */

// POST /api/v1/customers/public  (lead capture from website forms)
export const publicCreateCustomer = async (req, res, next) => {
    try {
        const attribution = extractAttribution(req);
        const {location } = await captureLocation(req);

        const {
            name, email, phone, city, state,
            source, interestedIn, notes,
        } = req.body;

        if (!name || !phone) return fail(res, "Name and phone are required", 400);

        // Duplicate check by phone (BRD 9.2)
        let customer = await Customer.findOne({ phone });
        if (customer) {
            // Update latest touch and return existing
            if (attribution?.latestTouchSource)
                customer.attribution.latestTouchSource = attribution.latestTouchSource;
            if (city && !customer.city) customer.city = city;
            if (state && !customer.state) customer.state = state;
            customer.lastContactedAt = new Date();
            await customer.save();
            return ok(res, customer, "Existing customer found, updated");
        }

        // IP-based location (BRD 12)
        const ip = req.ip || req.headers["x-forwarded-for"] || null;

        customer = await Customer.create({
            name,
            email,
            phone,
            city,
            state,
            source: source || "direct_website",
            attribution: attribution || {},
            interestedIn: interestedIn || "buy",
            notes,
            ipAddress: ip,
            attribution: attribution || {},
            ipLocation: location || null,
            // ipLocation populated separately by an IP geo service
        });

        return ok(res, customer, "Customer created", 201);
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/customers/me  (Customer Panel)
export const getMyProfile = async (req, res, next) => {
    try {
        const customer = await Customer.findById(req.customer._id)
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
            req.customer._id,
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

        await Customer.findByIdAndUpdate(req.customer._id, {
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
        await Customer.findByIdAndUpdate(req.customer._id, {
            $pull: { savedCars: req.params.vehicleId },
        });
        return ok(res, {}, "Car removed from saved");
    } catch (err) {
        next(err);
    }
};

/* ================= CRM / ADMIN ================= */

// GET /api/v1/customers
export const listCustomers = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { search, source, city, interestedIn, isActive } = req.query;

        const filter = {};
        if (source) filter.source = source;
        if (city) filter.city = new RegExp(city, "i");
        if (interestedIn) filter.interestedIn = interestedIn;
        if (isActive !== undefined) filter.isActive = isActive === "true";

        if (search) {
            filter.$or = [
                { name: new RegExp(search, "i") },
                { phone: new RegExp(search, "i") },
                { email: new RegExp(search, "i") },
            ];
        }

        const [data, total] = await Promise.all([
            Customer.find(filter)
                .sort("-createdAt")
                .skip((page - 1) * limit)
                .limit(limit),
            Customer.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/customers/:id
export const getCustomer = async (req, res, next) => {
    try {
        const customer = await Customer.findById(req.params.id)
            .populate("savedCars", "brand model year price images slug status")
            .populate("createdBy", "name")
            .populate("updatedBy", "name");

        if (!customer) return fail(res, "Customer not found", 404);
        return ok(res, customer);
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
        const protectedFields = ["password", "otp", "otpExpires", "deletedAt", "savedCars"];
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