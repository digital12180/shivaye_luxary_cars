import { Router } from "express";
import {
    register,
    login,
    logout,
    refreshToken,
    changePassword,
    forgotPassword,
    resetPassword,
    me,
} from "../controllers/auth.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", verifyJWT, logout);
router.post("/refresh-token", refreshToken);
router.post("/change-password", verifyJWT, changePassword);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);
router.get("/me", verifyJWT, me);

export default router;