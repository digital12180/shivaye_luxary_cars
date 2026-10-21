import { Router } from "express";
import {
    listFollowUps,
    createFollowUp,
    updateFollowUp,
    deleteFollowUp,
} from "../controllers/followUp.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router.get("/", restrictTo("admin", "sales_manager", "sales_executive"), listFollowUps);
router.post("/", restrictTo("admin", "sales_manager", "sales_executive"), createFollowUp);
router.patch("/:id", restrictTo("admin", "sales_manager", "sales_executive"), updateFollowUp);
router.delete("/:id", restrictTo("admin", "sales_manager"), deleteFollowUp);

export default router;