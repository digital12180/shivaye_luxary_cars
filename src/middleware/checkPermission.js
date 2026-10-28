import User from "../models/User.js";
import { fail } from "../utils/response.js";

export const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user._id) {
        return fail(res, "Unauthorized", 401);
      }

      // DB se latest user fetch karo (permissions ke liye)
      const user = await User.findById(req.user._id);

      if (!user || !user.isActive || user.status !== "active") {
        return fail(res, "User account is inactive or suspended", 403);
      }

      // Admin bypass (Optional: chahein to hata dein)
      if (user.role === "admin") {
        return next();
      }

      // Check permission
      const hasPermission = user.permissions?.includes(requiredPermission);

      if (!hasPermission) {
        return fail(
          res,
          `Forbidden: You don't have '${requiredPermission}' permission`,
          403
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};