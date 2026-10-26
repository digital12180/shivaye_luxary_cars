import mongoose from "mongoose";
import Brand from "../models/Brand.js";
import Vehicle from "../models/Vehicle.js";
import { ok, fail } from "../utils/response.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";

export const listBrands = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 50;
        const { search, tier, featured, sortBy = "displayOrder" } = req.query;

        const filter = { isActive: true };

        if (tier) filter.tier = tier;
        if (featured === "true") filter.isFeatured = true;

        if (search) {
            filter.$or = [
                { name: new RegExp(search, "i") },
                { description: new RegExp(search, "i") },
            ];
        }

        const [data, total] = await Promise.all([
            Brand.find(filter)
                .sort(sortBy)
                .skip((page - 1) * limit)
                .limit(limit),
            Brand.countDocuments(filter),
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
   PUBLIC — GET /api/v1/brands/:slugOrId
   ============================================================ */
export const getBrand = async (req, res, next) => {
    try {
        const { slugOrId } = req.params;
        const query = mongoose.isValidObjectId(slugOrId)
            ? { _id: slugOrId }
            : { slug: slugOrId };

        const brand = await Brand.findOne(query);
        if (!brand) return fail(res, "Brand not found", 404);

        // Count vehicles for this brand (nice for detail page)
        const vehicleCount = await Vehicle.countDocuments({
            brand: brand.name,
            status: { $in: ["Available", "Reserved", "Booked"] },
        });

        return ok(res, { ...brand.toObject(), vehicleCount });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — GET /api/v1/brands/admin/all
   ============================================================ */
export const adminListBrands = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { search, tier, isActive, sortBy = "-createdAt" } = req.query;

        const filter = {};
        if (tier) filter.tier = tier;
        if (isActive !== undefined) filter.isActive = isActive === "true";

        if (search) {
            filter.$or = [
                { name: new RegExp(search, "i") },
                { description: new RegExp(search, "i") },
            ];
        }

        const [data, total] = await Promise.all([
            Brand.find(filter)
                .populate("createdBy", "name")
                .populate("updatedBy", "name")
                .sort(sortBy)
                .skip((page - 1) * limit)
                .limit(limit),
            Brand.countDocuments(filter),
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
   ADMIN — POST /api/v1/brands
   ============================================================ */
export const createBrand = async (req, res, next) => {
    try {
        const { name, description, country, foundedYear, website, tier, displayOrder, isActive, isFeatured, seo } = req.body;

        if (!name) return fail(res, "Brand name is required", 400);

        // Check duplicate
        const existing = await Brand.findOne({ name: new RegExp(`^${name}$`, "i") });
        if (existing) return fail(res, "Brand already exists", 409);

        // Upload logo if provided
        let logo = { url: null, publicId: null };
        if (req.file) {
            const uploaded = await uploadToCloudinary(
                req.file.buffer,
                "brand-logo",
                `${Date.now()}-${req.file.originalname}`
            );
            logo = { url: uploaded.url, publicId: uploaded.public_id };
        }

        const brand = await Brand.create({
            name,
            description,
            country,
            foundedYear,
            website,
            tier,
            displayOrder,
            isActive,
            isFeatured,
            seo,
            logo,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        return ok(res, brand, "Brand created", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — PATCH /api/v1/brands/:id
   ============================================================ */
export const updateBrand = async (req, res, next) => {
    try {
        const protectedFields = ["slug", "createdBy", "deletedAt"];
        protectedFields.forEach((f) => delete req.body[f]);

        const brand = await Brand.findById(req.params.id);
        if (!brand) return fail(res, "Brand not found", 404);

        // If new logo uploaded → replace old
        if (req.file) {
            if (brand.logo?.publicId) {
                await deleteFromCloudinary(brand.logo.publicId, "image");
            }
            const uploaded = await uploadToCloudinary(
                req.file.buffer,
                "brand-logo",
                `${Date.now()}-${req.file.originalname}`
            );
            brand.logo = { url: uploaded.url, publicId: uploaded.public_id };
        }

        Object.assign(brand, req.body);
        brand.updatedBy = req.user._id;
        await brand.save();

        return ok(res, brand, "Brand updated");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — PATCH /api/v1/brands/:id/toggle
   ============================================================ */
export const toggleBrandActive = async (req, res, next) => {
    try {
        const brand = await Brand.findById(req.params.id);
        if (!brand) return fail(res, "Brand not found", 404);

        brand.isActive = !brand.isActive;
        brand.updatedBy = req.user._id;
        await brand.save();

        return ok(res, brand, `Brand ${brand.isActive ? "activated" : "deactivated"}`);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — DELETE /api/v1/brands/:id
   ============================================================ */
export const deleteBrand = async (req, res, next) => {
    try {
        const brand = await Brand.findById(req.params.id);
        if (!brand) return fail(res, "Brand not found", 404);

        // Prevent delete if vehicles exist under this brand
        const vehicleCount = await Vehicle.countDocuments({ brand: brand.name });
        if (vehicleCount > 0) {
            return fail(
                res,
                `Cannot delete brand — ${vehicleCount} vehicle(s) are linked to it`,
                400
            );
        }

        // Cleanup logo
        if (brand.logo?.publicId) {
            await deleteFromCloudinary(brand.logo.publicId, "image");
        }

        brand.deletedAt = new Date();
        brand.isActive = false;
        brand.updatedBy = req.user._id;
        await brand.save();

        return ok(res, {}, "Brand deleted");
    } catch (err) {
        next(err);
    }
};