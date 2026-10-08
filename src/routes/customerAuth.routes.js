import { Router } from "express";
import {
    sendOtp,
    verifyOtp,
    refreshToken,
    logout,
    me,
    loginWithPassword,
} from "../controllers/customerAuth.controller.js";
import { verifyCustomerJWT } from "../middleware/customerAuth.middleware.js";

const router = Router();

router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/login", loginWithPassword);        // optional
router.post("/refresh-token", refreshToken);
router.post("/logout", verifyCustomerJWT, logout);
router.get("/me", verifyCustomerJWT, me);

export default router;