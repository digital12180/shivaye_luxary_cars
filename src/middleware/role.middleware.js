import jwt from "jsonwebtoken";
import User from "../models/User.js"; // Apne User model ka path check kar lein
import { fail } from "../utils/response.js";

export const restrictTo = (...allowedRoles) => {
    return (req, res, next) => {
        // verifyJWT ne req.user set kiya hoga
        if (!req.user) {
            return fail(res, "Unauthorized: Please login first", 401);
        }

        // Check karein ki user ka role allowed list me hai ya nahi
        if (!allowedRoles.includes(req.user.role)) {
            return fail(
                res,
                `Access Denied: This action requires one of these roles: [${allowedRoles.join(", ")}]`,
                403
            );
        }

        next();
    };
};