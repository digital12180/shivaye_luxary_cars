import Customer from "../models/Customer.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { throwError } from "../utils/response.js";

export const verifyCustomerJWT = async (req, res, next) => {
    try {
        const token =
            req.cookies?.accessToken ||
            req.header("Authorization")?.replace("Bearer ", "");

        if (!token) throwError(401, "Unauthorized: token missing"); // Debugging line

        const decoded = verifyAccessToken(token);

        if (!decoded) throwError(401, "Unauthorized: invalid token payload");

        const id = decoded._id || decoded.id;

        console.log("Token:", id);

        if (!id) throwError(401, "Unauthorized: token has no user id");

        if (decoded.role && decoded.role !== "customer") {
            throwError(401, "Unauthorized: wrong role");
        }

        const user = await Customer.findOne({_id:id});
        console.log("Token:", user);

        if (!user) throwError(401, "Unauthorized: customer not found");

        req.user = user;
        next();
    } catch (err) {
        console.log(err)
        next(err);
    }
};