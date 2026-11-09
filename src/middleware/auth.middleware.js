import User from "../models/User.js";
import Customer from "../models/Customer.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { throwError } from "../utils/response.js";

/* ==================== ADMIN / STAFF AUTH ==================== */
export const verifyJWT = async (req, res, next) => {
    try {
        const token =
            req.cookies?.accessToken ||
            req.header("Authorization")?.replace("Bearer ", "");

        if (!token) throwError(401, "Unauthorized: token missing");

        const decoded = verifyAccessToken(token);
        if (!decoded) throwError(401, "Unauthorized: invalid token payload");

        const id = decoded._id || decoded.id;   // 👈 accept both
        if (!id) throwError(401, "Unauthorized: token has no user id");

        const user = await User.findById(id);
        if (!user || user.status !== "active") {
            throwError(401, "Unauthorized: user not found or inactive");
        }

        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
};

/* ==================== ROLE RESTRICTION ==================== */
export const restrictTo = (...roles) => (req, res, next) => {
    if (!req.user) {
        return next(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));
    }
    if (!roles.includes(req.user.role)) {
        return next(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
    }
    next();
};

/* ==================== CUSTOMER AUTH ==================== */
/**
 * Customer auth — self-contained. Do NOT use this AND verifyCustomerJWT
 * in the same route; either one is enough.
 */
export const requireCustomer = async (req, res, next) => {
    try {
        const token =
            req.cookies?.accessToken ||
            req.header("Authorization")?.replace("Bearer ", "");

        if (!token) throwError(401, "Unauthorized: token missing");

        const decoded = verifyAccessToken(token);
        if (!decoded) throwError(401, "Unauthorized: invalid token payload");

        const id = decoded._id || decoded.id;
        if (!id) throwError(401, "Unauthorized: token has no user id");

        if (decoded.role && decoded.role !== "customer") {
            throwError(401, "Unauthorized: wrong role");
        }

        const user = await Customer.findById(id);
        if (!user) throwError(401, "Unauthorized: customer not found");

        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
};