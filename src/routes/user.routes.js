import { Router } from "express";
import {
    listUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    changeStatus,
    changeRole,
    updateMyProfile,
} from "../controllers/user.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

// Self
router.patch("/me/profile", updateMyProfile);

// Admin / Manager
router.get("/", restrictTo("admin", "sales_manager"), listUsers);
router.post("/", restrictTo("admin"), createUser);
router.get("/:id", restrictTo("admin", "sales_manager"), getUser);
router.patch("/:id", restrictTo("admin"), updateUser);
router.delete("/:id", restrictTo("admin"), deleteUser);
router.patch("/:id/status", restrictTo("admin"), changeStatus);
router.patch("/:id/role", restrictTo("admin"), changeRole);

export default router;