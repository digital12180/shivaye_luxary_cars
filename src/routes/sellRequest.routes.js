import express from "express";
import {
    createSellRequest,
    getAllSellRequests,
    getSellRequestById,
    updateSellRequest,
    deleteSellRequest,
    getMySellRequests,
    getMySellRequestById,
} from "../controllers/sellRequest.controller.js";
import { verifyCustomerJWT } from "../middleware/customerAuth.middleware.js"
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js"
import { upload } from "../middleware/upload.middleware.js";

const router = express.Router();

router.post("/", upload.array("photos", 10), createSellRequest);

router.get("/", getAllSellRequests);
router.get("/:id", getSellRequestById);
router.put("/:id", updateSellRequest);
router.delete("/:id", deleteSellRequest);
router.get("/my-requests", verifyCustomerJWT, getMySellRequests);
router.get("/my-requests/:id", verifyCustomerJWT, getMySellRequestById);

export default router;