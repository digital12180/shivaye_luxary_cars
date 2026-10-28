import User from "../models/User.js";
import { ok, fail } from "../utils/response.js";
import { PERMISSIONS } from "../utils/permission.js";

// Valid permissions ki list (validation ke liye)
const VALID_PERMISSIONS = Object.values(PERMISSIONS);

// ==========================
// LIST USERS
// ==========================
export const listUsers = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { role, status, search } = req.query;

        const filter = {};
        if (role) filter.role = role;       // 🔴 Ab role string hai
        if (status) filter.status = status;

        if (search) {
            filter.$or = [
                { name: new RegExp(search, "i") },
                { email: new RegExp(search, "i") },
                { phone: new RegExp(search, "i") },
            ];
        }

        const [data, total] = await Promise.all([
            User.find(filter)
                .skip((page - 1) * limit)
                .limit(limit)
                .sort("-createdAt"),
            User.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        next(err);
    }
};

// ==========================
// GET SINGLE USER
// ==========================
export const getUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return fail(res, "User not found", 404);
        return ok(res, user);
    } catch (err) {
        next(err);
    }
};

// ==========================
// CREATE USER
// ==========================
export const createUser = async (req, res, next) => {
    try {
        const { name, email, phone, password, role, permissions } = req.body;

        if (!name || !email || !password || !role) {
            return fail(res, "Name, email, password and role are required", 400);
        }

        const exists = await User.findOne({ email });
        if (exists) return fail(res, "Email already exists", 409);

        // Permissions validate karo (invalid values filter kar do)
        const validPermissions = Array.isArray(permissions)
            ? permissions.filter((p) => VALID_PERMISSIONS.includes(p))
            : [];

        const user = await User.create({
            name,
            email,
            phone,
            password,
            role,
            permissions: validPermissions,
            createdBy: req.user._id,
        });

        const safe = user.toObject();
        delete safe.password;

        return ok(res, safe, "User created", 201);
    } catch (err) {
        next(err);
    }
};

// ==========================
// UPDATE USER
// ==========================
export const updateUser = async (req, res, next) => {
    try {
        const allowed = ["name", "phone", "profileImage", "role", "status", "permissions"];
        const payload = {};

        allowed.forEach((key) => {
            if (req.body[key] !== undefined) payload[key] = req.body[key];
        });

        // Permissions ko validate karo agar aa rahi hai
        if (Array.isArray(payload.permissions)) {
            payload.permissions = payload.permissions.filter((p) =>
                VALID_PERMISSIONS.includes(p)
            );
        }

        payload.updatedBy = req.user._id;

        const user = await User.findByIdAndUpdate(req.params.id, payload, {
            new: true,
            runValidators: true,
        });

        if (!user) return fail(res, "User not found", 404);

        return ok(res, user, "User updated");
    } catch (err) {
        next(err);
    }
};

// ==========================
// DELETE USER (Soft Delete)
// ==========================
export const deleteUser = async (req, res, next) => {
    try {
        if (req.params.id === req.user._id.toString()) {
            return fail(res, "You cannot delete your own account", 400);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                deletedAt: new Date(),
                status: "inactive",
                isActive: false,
                updatedBy: req.user._id,
            },
            { new: true }
        );

        if (!user) return fail(res, "User not found", 404);

        return ok(res, {}, "User deleted");
    } catch (err) {
        next(err);
    }
};

// ==========================
// CHANGE STATUS
// ==========================
export const changeStatus = async (req, res, next) => {
    try {
        const { status } = req.body;

        if (!["active", "inactive", "suspended"].includes(status)) {
            return fail(res, "Invalid status value", 400);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { status, isActive: status === "active", updatedBy: req.user._id },
            { new: true, runValidators: true }
        );

        if (!user) return fail(res, "User not found", 404);

        return ok(res, user, "Status updated");
    } catch (err) {
        next(err);
    }
};

// ==========================
// CHANGE ROLE
// ==========================
export const changeRole = async (req, res, next) => {
    try {
        const { role } = req.body;

        if (!role) return fail(res, "role is required", 400);

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { role, updatedBy: req.user._id },
            { new: true, runValidators: true }
        );

        if (!user) return fail(res, "User not found", 404);

        return ok(res, user, "Role updated");
    } catch (err) {
        next(err);
    }
};

// ==========================
// UPDATE MY PROFILE
// ==========================
export const updateMyProfile = async (req, res, next) => {
    try {
        const allowed = ["name", "phone", "profileImage"];
        const payload = {};

        allowed.forEach((key) => {
            if (req.body[key] !== undefined) payload[key] = req.body[key];
        });

        const user = await User.findByIdAndUpdate(req.user._id, payload, {
            new: true,
            runValidators: true,
        });

        return ok(res, user, "Profile updated");
    } catch (err) {
        next(err);
    }
};