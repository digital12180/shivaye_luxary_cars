import User from "../models/User.js";
import { ok, fail } from "../utils/response.js";
import { PERMISSIONS } from "../utils/permission.js";

// Valid permissions ki list
const VALID_PERMISSIONS = Object.values(PERMISSIONS);

// ==========================
// GET USER PERMISSIONS
// ==========================
// GET /api/v1/users/:id/permissions
export const getUserPermissions = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id).select("name email role permissions");
        if (!user) return fail(res, "User not found", 404);

        return ok(res, {
            userId: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            permissions: user.permissions,
        });
    } catch (err) {
        next(err);
    }
};

// ==========================
// REPLACE ALL PERMISSIONS (Full Update)
// ==========================
// PUT /api/v1/users/:id/permissions
// Body: { permissions: ["Leads_read", "Leads_create", ...] }
export const updateUserPermissions = async (req, res, next) => {
    try {
        const { permissions } = req.body;

        if (!Array.isArray(permissions)) {
            return fail(res, "permissions must be an array of strings", 400);
        }

        // Validate: sirf valid permissions allow hongi
        const validPermissions = permissions.filter((p) =>
            VALID_PERMISSIONS.includes(p)
        );

        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                permissions: validPermissions,
                updatedBy: req.user._id,
            },
            { new: true, runValidators: true }
        ).select("name email role permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, user, "User permissions updated");
    } catch (err) {
        next(err);
    }
};

// ==========================
// ADD SINGLE PERMISSION
// ==========================
// POST /api/v1/users/:id/permissions
// Body: { permission: "Leads_create" }
export const addUserPermission = async (req, res, next) => {
    try {
        const { permission } = req.body;

        if (!permission) {
            return fail(res, "permission is required", 400);
        }

        if (!VALID_PERMISSIONS.includes(permission)) {
            return fail(res, `Invalid permission: ${permission}`, 400);
        }

        // $addToSet duplicates avoid karta hai
        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                $addToSet: { permissions: permission },
                $set: { updatedBy: req.user._id },
            },
            { new: true }
        ).select("name email role permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, user, `Permission '${permission}' added`);
    } catch (err) {
        next(err);
    }
};

// ==========================
// REMOVE SINGLE PERMISSION
// ==========================
// DELETE /api/v1/users/:id/permissions
// Body: { permission: "Leads_delete" }
export const removeUserPermission = async (req, res, next) => {
    try {
        const { permission } = req.body;

        if (!permission) {
            return fail(res, "permission is required", 400);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                $pull: { permissions: permission },
                $set: { updatedBy: req.user._id },
            },
            { new: true }
        ).select("name email role permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, user, `Permission '${permission}' removed`);
    } catch (err) {
        next(err);
    }
};

// ==========================
// BULK ADD PERMISSIONS
// ==========================
// POST /api/v1/users/:id/permissions/bulk-add
// Body: { permissions: ["Leads_read", "Leads_create"] }
export const addMultiplePermissions = async (req, res, next) => {
    try {
        const { permissions } = req.body;

        if (!Array.isArray(permissions) || permissions.length === 0) {
            return fail(res, "permissions array is required", 400);
        }

        const validPermissions = permissions.filter((p) =>
            VALID_PERMISSIONS.includes(p)
        );

        if (validPermissions.length === 0) {
            return fail(res, "No valid permissions provided", 400);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                $addToSet: { permissions: { $each: validPermissions } },
                $set: { updatedBy: req.user._id },
            },
            { new: true }
        ).select("name email role permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, user, `${validPermissions.length} permission(s) added`);
    } catch (err) {
        next(err);
    }
};

// ==========================
// BULK REMOVE PERMISSIONS
// ==========================
// DELETE /api/v1/users/:id/permissions/bulk-remove
// Body: { permissions: ["Leads_delete", "Users_delete"] }
export const removeMultiplePermissions = async (req, res, next) => {
    try {
        const { permissions } = req.body;

        if (!Array.isArray(permissions) || permissions.length === 0) {
            return fail(res, "permissions array is required", 400);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                $pull: { permissions: { $in: permissions } },
                $set: { updatedBy: req.user._id },
            },
            { new: true }
        ).select("name email role permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, user, `${permissions.length} permission(s) removed`);
    } catch (err) {
        next(err);
    }
};

// ==========================
// CLEAR ALL PERMISSIONS
// ==========================
// DELETE /api/v1/users/:id/permissions/clear
export const clearUserPermissions = async (req, res, next) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                permissions: [],
                updatedBy: req.user._id,
            },
            { new: true }
        ).select("name email role permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, user, "All permissions cleared");
    } catch (err) {
        next(err);
    }
};