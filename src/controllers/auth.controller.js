import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { ok, fail, throwError } from "../utils/response.js";
import {
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
} from "../utils/jwt.js";
import { sendForgotPasswordEmail } from "../services/email.service.js";

const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "none",
};

// controllers/auth.controller.js

import Customer from "../models/Customer.js";
import { twilioService } from "../services/twilio.service.js";

/**
 * POST /api/auth/customer/send-otp
 * body: { phone }
 */
export async function sendCustomerLoginOTP(req, res) {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ success: false, message: "Phone required" });
        }

        const customer = await Customer.findOne({ phone: phone.trim() });

        // 🔒 Do NOT reveal whether phone exists? 
        // For a car-reservation site it's usually okay to say "not registered".
        // If you want privacy, always return success and only send if exists.
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "No account found for this number. Please reserve a car first.",
            });
        }

        if (!customer.isActive) {
            return res.status(403).json({ success: false, message: "Account disabled" });
        }

        // Rate limit: 1 OTP per 60 seconds
        if (customer.otpLastSentAt && (Date.now() - customer.otpLastSentAt.getTime()) < 60_000) {
            return res.status(429).json({
                success: false,
                message: "Please wait 60 seconds before requesting another OTP.",
            });
        }

        // Send OTP via WhatsApp using Twilio Verify
        const result = await twilioService.sendOTP(phone, "whatsapp");

        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: "Failed to send OTP",
                error: result.error,
            });
        }

        // Track last sent time (needs select:false fields → use updateOne or direct set)
        await Customer.updateOne(
            { _id: customer._id },
            { $set: { otpLastSentAt: new Date(), otp: result.otp } }
        );

        return res.json({
            success: true,
            message: "OTP sent on WhatsApp",
            // method: result.method,   // 'verify'
            method: 'verify',
            otp: result.otp, // only for development/testing; remove in production
        });
    } catch (err) {
        console.error("sendCustomerLoginOTP error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
}
/**
 * POST /api/auth/customer/verify-otp
 * body: { phone, code }
 */
// export async function verifyCustomerLoginOTP(req, res) {
//     try {
//         const { phone, code } = req.body;

//         if (!phone || !code) {
//             return res.status(400).json({ success: false, message: "Phone and code required" });
//         }

//         const customer = await Customer.findOne({ phone: phone.trim() })
//             .select("+otpAttempts");   // if using programmable branch

//         if (!customer) {
//             return res.status(404).json({ success: false, message: "Customer not found" });
//         }

//         // Brute-force guard (works for both verify & programmable paths)
//         if (customer.otpAttempts >= 5) {
//             return res.status(429).json({
//                 success: false,
//                 message: "Too many attempts. Request a new OTP.",
//             });
//         }

//         // Verify with Twilio
//         // const result = await twilioService.verifyOTP(phone, code);

//         // if (!result.success) {
//         //     // Increment attempts
//         //     await Customer.updateOne(
//         //         { _id: customer._id },
//         //         { $inc: { otpAttempts: 1 } }
//         //     );
//         //     return res.status(400).json({
//         //         success: false,
//         //         message: "Invalid or expired OTP",
//         //     });
//         // }
//         if (code !== customer.otp) { // For testing, accept a fixed OTP
//             await Customer.updateOne(
//                 { _id: customer._id },
//                 { $inc: { otpAttempts: 1 } }
//             );
//             return res.status(400).json({
//                 success: false,
//                 message: "Invalid or expired OTP",
//             });
//         }

//         // ✅ Success → mark verified, reset counters
//         customer.isVerified = true;
//         customer.otpAttempts = 0;
//         customer.otpLastSentAt = null;
//         customer.lastContactedAt = new Date();

//         const accessToken = signAccessToken(customer);
//         const refreshToken = signRefreshToken(customer);

//         // Store hash of refresh token (your schema has refreshTokenHash)
//         customer.refreshTokenHash = crypto
//             .createHash("sha256")
//             .update(refreshToken)
//             .digest("hex");

//         await customer.save();

//         // Cookie (recommended) or return tokens in body
//         res.cookie("refreshToken", refreshToken, {
//             httpOnly: true,
//             secure: process.env.NODE_ENV === "production",
//             sameSite: "strict",
//             maxAge: 30 * 24 * 60 * 60 * 1000,
//         });

//         return res.json({
//             success: true,
//             message: "Login successful",
//             accessToken,
//             customer: {
//                 id: customer._id,
//                 customerNumber: customer.customerNumber,
//                 name: customer.name,
//                 phone: customer.phone,
//                 email: customer.email,
//                 isVerified: customer.isVerified,
//             },
//         });
//     } catch (err) {
//         console.error("verifyCustomerLoginOTP error:", err);
//         return res.status(500).json({ success: false, message: "Server error" });
//     }
// }


async function verifyOtpLocally(customer, code) {
    // No OTP on record → treat as invalid
    if (!customer.otp) return false;

    // Optional: enforce expiry if you have otpExpiresAt on the schema
    // if (customer.otpExpiresAt && customer.otpExpiresAt < new Date()) return false;

    // Constant-time comparison to avoid timing attacks
    const storedOtp = String(customer.otp);
    const submittedOtp = String(code);

    const storedBuf = Buffer.from(storedOtp);
    const submittedBuf = Buffer.from(submittedOtp);

    if (storedBuf.length !== submittedBuf.length) return false;

    return crypto.timingSafeEqual(storedBuf, submittedBuf);
}

export async function verifyCustomerLoginOTP(req, res) {
    try {
        const { phone, code } = req.body;

        if (!phone || !code) {
            return res.status(400).json({
                success: false,
                message: "Phone and code required",
            });
        }

        const customer = await Customer.findOne({ phone: phone.trim() })
            .select("+otpAttempts +otp");

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Customer not found",
            });
        }

        // Brute-force guard
        if (customer.otpAttempts >= 5) {
            return res.status(429).json({
                success: false,
                message: "Too many attempts. Request a new OTP.",
            });
        }

        // Local verification (no Twilio)
        const isValid = await verifyOtpLocally(customer, code);

        if (!isValid) {
            await Customer.updateOne(
                { _id: customer._id },
                { $inc: { otpAttempts: 1 } }
            );
            return res.status(400).json({
                success: false,
                message: "Invalid or expired OTP",
            });
        }

        // ✅ Success → mark verified, reset counters, clear OTP
        customer.isVerified = true;
        customer.otpAttempts = 0;
        customer.otpLastSentAt = null;
        customer.otp = null; // one-time use
        customer.lastContactedAt = new Date();

        const payload = {
            id: customer._id.toString(),
            customerNumber: customer.customerNumber,
            phone: customer.phone,
            role: "customer",
        };

        const accessToken = signAccessToken(payload);
        const refreshToken = signRefreshToken(payload);
        customer.refreshTokenHash = crypto
            .createHash("sha256")
            .update(refreshToken)
            .digest("hex");

        await customer.save();

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        return res.json({
            success: true,
            message: "Login successful",
            accessToken,
            customer: {
                id: customer._id,
                customerNumber: customer.customerNumber,
                name: customer.name,
                phone: customer.phone,
                email: customer.email,
                isVerified: customer.isVerified,
            },
        });
    } catch (err) {
        console.error("verifyCustomerLoginOTP error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
}

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
            .cookie("accessToken", accessToken, { ...cookieOpts, maxAge: 10 * 60 * 1000 })
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

        console.log("refresh token called", req.cookies?.refreshToken);
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
        console.log("ltoken---", rawToken);
        sendForgotPasswordEmail(user.email, rawToken, user.name || "User").catch(
            (err) => console.error("Forgot password email failed:", err.message)
        );

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

export const updateProfile = async (req, res, next) => {
    try {
        const { name, phone, profileImage } = req.body;

        const user = await User.findById(req.user._id);
        if (!user) return fail(res, "User not found", 404);

        // Whitelist only safe fields
        if (name !== undefined) user.name = name;
        if (phone !== undefined) user.phone = phone;
        if (profileImage !== undefined) user.profileImage = profileImage;

        user.updatedBy = req.user._id;
        await user.save();

        const safe = user.toObject();
        delete safe.password;

        return ok(res, safe, "Profile updated");
    } catch (err) {
        next(err);
    }
};