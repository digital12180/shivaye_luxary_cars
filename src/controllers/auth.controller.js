import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { ok, fail, throwError } from "../utils/response.js";
import {
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
} from "../utils/jwt.js";

const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
};

// POST /api/v1/auth/register
export const register = async (req, res, next) => {
    try {
        const { name, email, phone, password, role } = req.body;

        const exists = await User.findOne({ email });
        if (exists) return fail(res, "Email already registered", 409);

        const user = await User.create({
            name,
            email,
            phone,
            password,
            role,
            createdBy: req.user?._id || null,
        });

        const safe = user.toObject();
        delete safe.password;

        return ok(res, safe, "User registered", 201);
    } catch (err) {
        next(err);
    }
};

// POST /api/v1/auth/login
export const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email }).select("+password");
        if (!user) return fail(res, "Invalid credentials", 401);
        console.log(user);
        if (user.lockedUntil && user.lockedUntil > Date.now())
            return fail(res, "Account temporarily locked. Try later.", 423);

        const isValid = await user.comparePassword(password);
        if (!isValid) {
            user.failedLoginAttempts += 1;
            if (user.failedLoginAttempts >= 5)
                user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            await user.save();
            return fail(res, "Invalid credentials", 401);
        }

        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        user.lastLoginAt = new Date();
        user.lastLoginIp = req.ip;

        const accessToken = signAccessToken({ _id: user._id, role: user.role });
        const refreshToken = signRefreshToken({ _id: user._id });

        user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
        await user.save();

        const safe = user.toObject();
        delete safe.password;
        delete safe.refreshTokenHash;

        return res
            .status(200)
            .cookie("accessToken", accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 })
            .cookie("refreshToken", refreshToken, { ...cookieOpts, maxAge: 7 * 24 * 60 * 60 * 1000 })
            .json({
                success: true,
                message: "Logged in successfully",
                data: { user: safe, accessToken, refreshToken },
            });
    } catch (err) {
        console.error(err);
        // next(err);
    }
};

// POST /api/v1/auth/logout
export const logout = async (req, res, next) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { refreshTokenHash: null });
        return res
            .clearCookie("accessToken")
            .clearCookie("refreshToken")
            .json({ success: true, message: "Logged out successfully", data: {} });
    } catch (err) {
        next(err);
    }
};

// POST /api/v1/auth/refresh-token
export const refreshToken = async (req, res, next) => {
    try {
        const token = req.cookies?.refreshToken || req.body.refreshToken;
        if (!token) return fail(res, "Refresh token missing", 401);

        const decoded = verifyRefreshToken(token);
        const user = await User.findById(decoded._id).select("+refreshTokenHash");
        if (!user) return fail(res, "Invalid refresh token", 401);

        const valid = await bcrypt.compare(token, user.refreshTokenHash || "");
        if (!valid) return fail(res, "Refresh token revoked", 401);

        const accessToken = signAccessToken({ _id: user._id, role: user.role });

        return res
            .status(200)
            .cookie("accessToken", accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 })
            .json({
                success: true,
                message: "Token refreshed",
                data: { accessToken },
            });
    } catch (err) {
        next(err);
    }
};

// POST /api/v1/auth/change-password
export const changePassword = async (req, res, next) => {
    try {
        const { oldPassword, newPassword } = req.body;

        const user = await User.findById(req.user._id).select("+password");
        if (!user) return fail(res, "User not found", 404);

        const isValid = await user.comparePassword(oldPassword);
        if (!isValid) return fail(res, "Old password is incorrect", 400);

        user.password = newPassword;
        await user.save();

        return ok(res, {}, "Password changed successfully");
    } catch (err) {
        next(err);
    }
};

// POST /api/v1/auth/forgot-password
export const forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;

        const user = await User.findOne({ email });
        if (!user) return ok(res, {}, "If email exists, reset link sent");

        const rawToken = crypto.randomBytes(32).toString("hex");
        user.passwordResetToken = crypto
            .createHash("sha256")
            .update(rawToken)
            .digest("hex");
        user.passwordResetExpires = Date.now() + 15 * 60 * 1000;
        await user.save();

        // TODO: send reset link via email — `${process.env.CLIENT_URL}/reset-password/${rawToken}`

        return ok(res, {}, "If email exists, reset link sent");
    } catch (err) {
        next(err);
    }
};

// POST /api/v1/auth/reset-password/:token
export const resetPassword = async (req, res, next) => {
    try {
        const hashed = crypto
            .createHash("sha256")
            .update(req.params.token)
            .digest("hex");

        const user = await User.findOne({
            passwordResetToken: hashed,
            passwordResetExpires: { $gt: Date.now() },
        }).select("+passwordResetToken +passwordResetExpires");

        if (!user) return fail(res, "Invalid or expired reset token", 400);

        user.password = req.body.password;
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();

        return ok(res, {}, "Password reset successfully");
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/auth/me
export const me = async (req, res) => {
    return ok(res, req.user, "Current user");
};