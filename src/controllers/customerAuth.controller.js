import bcrypt from "bcryptjs";
import Customer from "../models/Customer.js";
import { ok, fail } from "../utils/response.js";
import {
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
} from "../utils/jwt.js";
import { generateOtp, hashOtp } from "../utils/otp.js";
import { sendOtpSms } from "../utils/sms.js";
import captureLocation from "../services/geolocation.service.js";
const OTP_TTL_MS = 5 * 60 * 1000;        // 5 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_OTP_ATTEMPTS = 5;

const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
};

/* ============================================================
   POST /api/v1/customer-auth/send-otp
   Body: { phone, name?, source?, attribution? }
   - If customer exists → send OTP
   - If not → create customer record + send OTP (silent registration)
   ============================================================ */
export const sendOtp = async (req, res, next) => {
    try {
        const { ip, location } = await captureLocation(req);
        const { phone, name, source, attribution } = req.body;
        if (!phone) return fail(res, "Phone is required", 400);

        let customer = await Customer.findOne({ phone }).select(
            "+otpLastSentAt +otpAttempts"
        );

        // Create minimal customer if first-time
        if (!customer) {
            customer = new Customer({
                name: name || "Guest",
                phone,
                source: source || "direct_website",
                attribution: attribution || {},
                interestedIn: "buy",
            });
        }

        // Cooldown check
        if (
            customer.otpLastSentAt &&
            Date.now() - customer.otpLastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
        ) {
            const wait = Math.ceil(
                (OTP_RESEND_COOLDOWN_MS - (Date.now() - customer.otpLastSentAt.getTime())) / 1000
            );
            return fail(res, `Please wait ${wait}s before requesting a new OTP`, 429);
        }

        const otp = generateOtp();
        customer.otp = hashOtp(otp);
        customer.otpExpires = new Date(Date.now() + OTP_TTL_MS);
        customer.otpAttempts = 0;
        customer.otpLastSentAt = new Date();

        // Capture IP + attribution on first visit (BRD 12)
        if (!customer.ipAddress) {
            customer.ipAddress = ip || req.ip || req.headers["x-forwarded-for"] || null;
        }
        customer.ipLocation = location || customer.ipLocation || null;

        await customer.save();

        await sendOtpSms(phone, otp);

        return ok(
            res,
            { phone: customer.phone, otpExpiresIn: OTP_TTL_MS / 1000 },
            "OTP sent successfully"
        );
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   POST /api/v1/customer-auth/verify-otp
   Body: { phone, otp }
   → returns access + refresh tokens
   ============================================================ */
export const verifyOtp = async (req, res, next) => {
    try {
        const { phone, otp } = req.body;
        if (!phone || !otp) return fail(res, "Phone and OTP are required", 400);

        const customer = await Customer.findOne({ phone }).select(
            "+otp +otpExpires +otpAttempts"
        );

        if (!customer) return fail(res, "Customer not found", 404);
        if (!customer.otp || !customer.otpExpires)
            return fail(res, "OTP not requested", 400);
        if (customer.otpExpires.getTime() < Date.now())
            return fail(res, "OTP expired", 400);
        if (customer.otpAttempts >= MAX_OTP_ATTEMPTS)
            return fail(res, "Too many attempts. Request a new OTP.", 429);

        const matches = customer.otp === hashOtp(otp);
        if (!matches) {
            customer.otpAttempts += 1;
            await customer.save();
            return fail(res, "Invalid OTP", 400);
        }

        // Success — clear OTP + mark verified
        customer.otp = undefined;
        customer.otpExpires = undefined;
        customer.otpAttempts = 0;
        customer.isVerified = true;

        const accessToken = signAccessToken({
            _id: customer._id,
            type: "customer",
        });
        const refreshToken = signRefreshToken({
            _id: customer._id,
            type: "customer",
        });

        customer.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
        await customer.save();

        const safe = customer.toObject();
        delete safe.otp;
        delete safe.otpExpires;
        delete safe.otpAttempts;
        delete safe.refreshTokenHash;

        return res
            .status(200)
            .cookie("customerAccessToken", accessToken, {
                ...cookieOpts,
                maxAge: 15 * 60 * 1000,
            })
            .cookie("customerRefreshToken", refreshToken, {
                ...cookieOpts,
                maxAge: 7 * 24 * 60 * 60 * 1000,
            })
            .json({
                success: true,
                message: "Logged in successfully",
                data: { customer: safe, accessToken, refreshToken },
            });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   POST /api/v1/customer-auth/refresh-token
   ============================================================ */
export const refreshToken = async (req, res, next) => {
    try {
        const token =
            req.cookies?.customerRefreshToken || req.body.refreshToken;
        if (!token) return fail(res, "Refresh token missing", 401);

        const decoded = verifyRefreshToken(token);
        if (decoded.type !== "customer")
            return fail(res, "Invalid token type", 401);

        const customer = await Customer.findById(decoded._id).select(
            "+refreshTokenHash"
        );
        if (!customer) return fail(res, "Customer not found", 401);

        const valid = await bcrypt.compare(token, customer.refreshTokenHash || "");
        if (!valid) return fail(res, "Refresh token revoked", 401);

        const accessToken = signAccessToken({
            _id: customer._id,
            type: "customer",
        });

        return res
            .status(200)
            .cookie("customerAccessToken", accessToken, {
                ...cookieOpts,
                maxAge: 15 * 60 * 1000,
            })
            .json({
                success: true,
                message: "Token refreshed",
                data: { accessToken },
            });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   POST /api/v1/customer-auth/logout
   ============================================================ */
export const logout = async (req, res, next) => {
    try {
        await Customer.findByIdAndUpdate(req.customer._id, {
            refreshTokenHash: null,
        });

        return res
            .clearCookie("customerAccessToken")
            .clearCookie("customerRefreshToken")
            .json({ success: true, message: "Logged out", data: {} });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   GET /api/v1/customer-auth/me
   ============================================================ */
export const me = async (req, res) => {
    return ok(res, req.customer, "Current customer");
};

/* ============================================================
   (Optional) Password-based login — for customers who set one
   POST /api/v1/customer-auth/login
   Body: { phone, password }
   ============================================================ */
export const loginWithPassword = async (req, res, next) => {
    try {
        const { phone, password } = req.body;
        if (!phone || !password)
            return fail(res, "Phone and password required", 400);

        const customer = await Customer.findOne({ phone }).select("+password");
        if (!customer || !customer.password)
            return fail(res, "Invalid credentials", 401);

        const valid = await customer.comparePassword(password);
        if (!valid) return fail(res, "Invalid credentials", 401);

        const accessToken = signAccessToken({
            _id: customer._id,
            type: "customer",
        });
        const refreshToken = signRefreshToken({
            _id: customer._id,
            type: "customer",
        });

        customer.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
        await customer.save();

        const safe = customer.toObject();
        delete safe.password;
        delete safe.refreshTokenHash;

        return res
            .status(200)
            .cookie("customerAccessToken", accessToken, {
                ...cookieOpts,
                maxAge: 15 * 60 * 1000,
            })
            .cookie("customerRefreshToken", refreshToken, {
                ...cookieOpts,
                maxAge: 7 * 24 * 60 * 60 * 1000,
            })
            .json({
                success: true,
                message: "Logged in",
                data: { customer: safe, accessToken, refreshToken },
            });
    } catch (err) {
        next(err);
    }
};