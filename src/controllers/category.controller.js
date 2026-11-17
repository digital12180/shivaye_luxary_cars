import mongoose from "mongoose";
import Category from "../models/Category.js";
import Vehicle from "../models/Vehicle.js";
import { ok, fail } from "../utils/response.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";

/* ============================================================
   PUBLIC — GET /api/v1/categories
   ============================================================ */
export const listCategories = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 50;
        const { search, type, featured, sortBy = "displayOrder", isActive } = req.query;

        const filter = {};

        if (type) filter.type = type;
        if (featured === "true") filter.isFeatured = true;

        // Handle isActive as boolean — only apply filter if explicitly passed
        if (isActive !== undefined && isActive !== "") {
            filter.isActive = isActive === "true" || isActive === true;
        }

        if (search) {
            filter.$or = [
                { name: new RegExp(search, "i") },
                { description: new RegExp(search, "i") },
            ];
        }

        // 🔥 FIX: Agar model mein soft delete (deletedAt) hai, toh filter mein add karein
        // taaki count aur find dono same records par kaam karein.
        // (Agar model mein deletedAt nahi hai, toh is line ko hata dein)
        filter.deletedAt = null;

        const [data, total] = await Promise.all([
            Category.find(filter)
                .sort(sortBy)
                .skip((page - 1) * limit)
                .limit(limit),

            // Count ab exact same filter par hoga jo data fetch kar raha hai
            Category.countDocuments(filter),
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

/* ============================================================
   PUBLIC — GET /api/v1/categories/:slugOrId
   ============================================================ */
export const getCategory = async (req, res, next) => {
    try {
        const { slugOrId } = req.params;
        const query = mongoose.isValidObjectId(slugOrId)
            ? { _id: slugOrId }
            : { slug: slugOrId };

        const category = await Category.findOne(query);
        if (!category) return fail(res, "Category not found", 404);

        const vehicleCount = await Vehicle.countDocuments({
            category: category.name,
            status: { $in: ["Available", "Reserved", "Booked"] },
        });

        return ok(res, { ...category.toObject(), vehicleCount });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — GET /api/v1/categories/admin/all
   ============================================================ */
export const adminListCategories = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { search, type, isActive, sortBy = "-createdAt" } = req.query;

        const filter = {};
        if (type) filter.type = type;
        if (isActive !== undefined) filter.isActive = isActive === "true";

        if (search) {
            filter.$or = [
                { name: new RegExp(search, "i") },
                { description: new RegExp(search, "i") },
            ];
        }

        const [data, total] = await Promise.all([
            Category.find(filter)
                .populate("createdBy", "name")
                .populate("updatedBy", "name")
                .sort(sortBy)
                .skip((page - 1) * limit)
                .limit(limit),
            Category.countDocuments(filter),
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
   ADMIN — POST /api/v1/categories
   ============================================================ */
export const createCategory = async (req, res, next) => {
    try {
        const { name, description, type, bodyType, displayOrder, isActive, isFeatured, seo } = req.body;

        if (!name) return fail(res, "Category name is required", 400);

        const existing = await Category.findOne({ name: new RegExp(`^${name}$`, "i") });
        if (existing) return fail(res, "Category already exists", 409);

        // Optional image upload
        let image = { url: null, publicId: null };
        if (req.file) {
            const uploaded = await uploadToCloudinary(
                req.file.buffer,
                "category-image",
                `${Date.now()}-${req.file.originalname}`
            );
            image = { url: uploaded.url, publicId: uploaded.public_id };
        }

        const category = await Category.create({
            name,
            description,
            type,
            bodyType,
            displayOrder,
            isActive,
            isFeatured,
            seo,
            image,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        return ok(res, category, "Category created", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — PATCH /api/v1/categories/:id
   ============================================================ */
export const updateCategory = async (req, res, next) => {
    try {
        const protectedFields = ["slug", "createdBy", "deletedAt"];
        protectedFields.forEach((f) => delete req.body[f]);

        const category = await Category.findById(req.params.id);
        if (!category) return fail(res, "Category not found", 404);

        if (req.file) {
            if (category.image?.publicId) {
                await deleteFromCloudinary(category.image.publicId, "image");
            }
            const uploaded = await uploadToCloudinary(
                req.file.buffer,
                "category-image",
                `${Date.now()}-${req.file.originalname}`
            );
            category.image = { url: uploaded.url, publicId: uploaded.public_id };
        }

        Object.assign(category, req.body);
        category.updatedBy = req.user._id;
        await category.save();

        return ok(res, category, "Category updated");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — PATCH /api/v1/categories/:id/toggle
   ============================================================ */
export const toggleCategoryActive = async (req, res, next) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) return fail(res, "Category not found", 404);

        category.isActive = !category.isActive;
        category.updatedBy = req.user._id;
        await category.save();

        return ok(res, category, `Category ${category.isActive ? "activated" : "deactivated"}`);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   ADMIN — DELETE /api/v1/categories/:id
   ============================================================ */
export const deleteCategory = async (req, res, next) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) return fail(res, "Category not found", 404);

        const vehicleCount = await Vehicle.countDocuments({ category: category.name });
        if (vehicleCount > 0) {
            return fail(
                res,
                `Cannot delete category — ${vehicleCount} vehicle(s) are linked to it`,
                400
            );
        }

        if (category.image?.publicId) {
            await deleteFromCloudinary(category.image.publicId, "image");
        }

        category.deletedAt = new Date();
        category.isActive = false;
        category.updatedBy = req.user._id;
        await category.save();

        return ok(res, {}, "Category deleted");
    } catch (err) {
        next(err);
    }
};

// Only important, business-relevant fields
const CSV_COLUMNS = [
  { key: "name",             label: "Name" },
  { key: "slug",             label: "Slug" },
  { key: "description",      label: "Description" },
  { key: "isActive",         label: "Active" },
  { key: "isFeatured",       label: "Featured" },
  { key: "metaTitle",        label: "Meta Title" },
  { key: "metaDescription",  label: "Meta Description" },
  { key: "keywords",         label: "Keywords" },
  { key: "createdAt",        label: "Created At" },
];

// CSV escaping
const esc = (val) => {
  if (val === null || val === undefined) return "";
  let s = String(val);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
};

const fmtDate = (d) => (d ? new Date(d).toISOString() : "");

export const exportCategoriesCSV = async (req, res, next) => {
  try {
    const { search, featured, isActive, sortBy = "displayOrder" } = req.query;

    const filter = { deletedAt: null };

    if (featured === "true") filter.isFeatured = true;

    if (isActive !== undefined && isActive !== "") {
      filter.isActive = isActive === "true" || isActive === true;
    }

    if (search) {
      filter.$or = [
        { name:        { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const categories = await Category.find(filter)
      .sort(sortBy)
      .lean();

    const rows = categories.map((c) => ({
      name:            c.name,
      slug:            c.slug || "",
      description:     c.description || "",
      isActive:        c.isActive   ? "Yes" : "No",
      isFeatured:      c.isFeatured ? "Yes" : "No",
      metaTitle:       c.seo?.metaTitle || "",
      metaDescription: c.seo?.metaDescription || "",
      keywords:        Array.isArray(c.seo?.keywords) ? c.seo.keywords.join(" | ") : "",
      createdAt:       fmtDate(c.createdAt),
    }));

    const header = CSV_COLUMNS.map((c) => esc(c.label)).join(",");
    const body   = rows.map((r) => CSV_COLUMNS.map((c) => esc(r[c.key])).join(",")).join("\r\n");

    const csv = "\uFEFF" + header + "\r\n" + body; // BOM for Excel UTF-8

    const filename = `categories_export_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
};