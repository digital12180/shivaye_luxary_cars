import User from "../models/User.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { throwError } from "../utils/response.js";

export const verifyJWT = async (req, res, next) => {
    try {
        const token =
            req.cookies?.accessToken ||
            req.header("Authorization")?.replace("Bearer ", "");

        if (!token) throwError(401, "Unauthorized: token missing");

        const decoded = verifyAccessToken(token);
        const user = await User.findById(decoded._id);
        if (!user || user.status !== "active")
            throwError(401, "Unauthorized: user not found or inactive");

        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
};

export const restrictTo = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role))
        return next(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
    next();
};