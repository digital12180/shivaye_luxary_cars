import User from "../models/User.js";
import { ok, fail } from "../utils/response.js";
import { PERMISSIONS } from "../utils/permission.js";

const VALID_PERMISSIONS = Object.values(PERMISSIONS);

// ==========================
// GET USER PERMISSIONS
// ==========================
export const getUserPermissions = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id).select("permissions");
        if (!user) return fail(res, "User not found", 404);

        // 🔴 Strictly only permissions array return karo
        return ok(res, { permissions: user.permissions });
    } catch (err) {
        next(err);
    }
};

// ==========================
// REPLACE ALL PERMISSIONS (Full Update)
// ==========================
export const updateUserPermissions = async (req, res, next) => {
    try {
        const { permissions } = req.body;

        if (!Array.isArray(permissions)) {
            return fail(res, "permissions must be an array of strings", 400);
        }

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
        ).select("permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, { permissions: user.permissions }, "Permissions updated");
    } catch (err) {
        next(err);
    }
};

// ==========================
// ADD SINGLE PERMISSION
// ==========================
export const addUserPermission = async (req, res, next) => {
    try {
        const { permission } = req.body;

        if (!permission) {
            return fail(res, "permission is required", 400);
        }

        if (!VALID_PERMISSIONS.includes(permission)) {
            return fail(res, `Invalid permission: ${permission}`, 400);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                $addToSet: { permissions: permission },
                $set: { updatedBy: req.user._id },
            },
            { new: true }
        ).select("permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, { permissions: user.permissions }, `Permission added`);
    } catch (err) {
        next(err);
    }
};

// ==========================
// REMOVE SINGLE PERMISSION
// ==========================
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
        ).select("permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, { permissions: user.permissions }, `Permission removed`);
    } catch (err) {
        next(err);
    }
};

// ==========================
// CLEAR ALL PERMISSIONS
// ==========================
export const clearUserPermissions = async (req, res, next) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                permissions: [],
                updatedBy: req.user._id,
            },
            { new: true }
        ).select("permissions");

        if (!user) return fail(res, "User not found", 404);

        return ok(res, { permissions: user.permissions }, "All permissions cleared");
    } catch (err) {
        next(err);
    }
};