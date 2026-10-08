import Customer from "../models/Customer.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { throwError } from "../utils/response.js";

export const verifyCustomerJWT = async (req, res, next) => {
    try {
        const token =
            req.cookies?.customerAccessToken ||
            req.header("Authorization")?.replace("Bearer ", "");

        if (!token) throwError(401, "Unauthorized: customer token missing");

        const decoded = verifyAccessToken(token);
        if (decoded.type !== "customer")
            throwError(401, "Unauthorized: wrong token type");

        const customer = await Customer.findById(decoded._id);
        if (!customer || !customer.isActive)
            throwError(401, "Unauthorized: customer not found or inactive");

        req.customer = customer;
        next();
    } catch (err) {
        next(err);
    }
};