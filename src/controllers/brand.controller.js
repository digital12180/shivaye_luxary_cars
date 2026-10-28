import mongoose from "mongoose";
import Brand from "../models/Brand.js";
import Vehicle from "../models/Vehicle.js";
import { ok, fail } from "../utils/response.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";

export const listBrands = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 50;
        const { search, tier, featured, sortBy = "displayOrder", isActive=true } = req.query;

        const filter = {};

        if (tier) filter.tier = tier;
        if (featured === "true") filter.isFeatured = true;
        if (isActive) {
            filter.isActive = isActive;
        }
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
        if (!req.user || !req.user._id) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized. Please provide a valid Bearer Token.",
            });
        }

        let { name, description, country, foundedYear, website, tier, displayOrder, isActive, isFeatured, seo } = req.body;

        if (!name) return fail(res, "Brand name is required", 400);

        if (seo && typeof seo === "string") {
            try {
                seo = JSON.parse(seo);
            } catch {
                return fail(res, "Invalid SEO format. Please send valid JSON.", 400);
            }
        }

        const existing = await Brand.findOne({ name: new RegExp(`^${name}$`, "i") });
        if (existing) return fail(res, "Brand already exists", 409);

        let logo = { url: null, publicId: null };
        if (req.file) {
            try {
                const uploaded = await uploadToCloudinary(
                    req.file.buffer,
                    "image",
                    `${Date.now()}-${req.file.originalname}`
                );
                logo = { url: uploaded.url, publicId: uploaded.public_id };
            } catch (uploadError) {
                console.error("Cloudinary Upload Error:", uploadError);
                return fail(res, "Failed to upload logo to Cloudinary", 500);
            }
        }

        const brand = await Brand.create({
            name,
            description,
            country,
            foundedYear: foundedYear ? Number(foundedYear) : null,
            website,
            tier,
            displayOrder: displayOrder ? Number(displayOrder) : 0,
            isActive: isActive === "true" || isActive === true,
            isFeatured: isFeatured === "true" || isFeatured === true,
            seo,
            logo,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        return ok(res, brand, "Brand created", 201);
    } catch (err) {
        console.error("Create Brand Error:", err);
        next(err);
    }
};


export const updateBrand = async (req, res, next) => {
    try {
        const { id } = req.params;

        // 1. Validate ObjectId FIRST → prevents CastError 500
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return fail(res, "Invalid brand id", 400);
        }

        const brand = await Brand.findById(id);
        if (!brand) return fail(res, "Brand not found", 404);

        let { name, description, country, foundedYear, website, tier, displayOrder, isActive, isFeatured, seo } = req.body;

        // 2. Duplicate name check (exclude self)
        if (name && name.trim().toLowerCase() !== brand.name.toLowerCase()) {
            const dup = await Brand.findOne({
                _id: { $ne: id },
                name: new RegExp(`^${name.trim()}$`, "i"),
            });
            if (dup) return fail(res, "Brand name already exists", 409);
        }

        // 3. Parse SEO
        if (seo && typeof seo === "string") {
            try { seo = JSON.parse(seo); }
            catch { return fail(res, "Invalid SEO format", 400); }
        }

        // 4. Logo (replace if new file uploaded)
        if (req.file) {
            try {
                if (brand.logo?.publicId) {
                    await deleteFromCloudinary(brand.logo.publicId, "image").catch((e) =>
                        console.warn("Old logo delete failed:", e.message)
                    );
                }
                const uploaded = await uploadToCloudinary(
                    req.file.buffer,
                    "image",
                    `${Date.now()}-${req.file.originalname}`
                );
                brand.logo = { url: uploaded.url, publicId: uploaded.public_id };
            } catch (uploadError) {
                console.error("Cloudinary Upload Error:", uploadError);
                return fail(res, "Failed to upload logo", 500);
            }
        }

        // 5. Apply scalar fields safely
        if (name !== undefined) brand.name = name;
        if (description !== undefined) brand.description = description;
        if (country !== undefined) brand.country = country;
        if (website !== undefined) brand.website = website;
        if (tier !== undefined) brand.tier = tier;
        if (seo !== undefined) brand.seo = seo;

        if (foundedYear !== undefined && foundedYear !== "") {
            const n = Number(foundedYear);
            if (Number.isNaN(n)) return fail(res, "foundedYear must be a number", 400);
            brand.foundedYear = n;
        }

        if (displayOrder !== undefined && displayOrder !== "") {
            const n = Number(displayOrder);
            if (Number.isNaN(n)) return fail(res, "displayOrder must be a number", 400);
            brand.displayOrder = n;
        }

        if (isActive !== undefined)
            brand.isActive = isActive === "true" || isActive === true;
        if (isFeatured !== undefined)
            brand.isFeatured = isFeatured === "true" || isFeatured === true;

        brand.updatedBy = req.user?._id;

        await brand.save(); // triggers validators, returns clean JSON

        return ok(res, brand, "Brand updated");
    } catch (err) {
        console.error("Update Brand Error:", err);
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