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

const router = express.Router();

router.post("/", createSellRequest);

router.get("/", getAllSellRequests);
router.get("/:id", getSellRequestById);
router.put("/:id", updateSellRequest);
router.delete("/:id", deleteSellRequest);
router.get("/my-requests", getMySellRequests);
router.get("/my-requests/:id", getMySellRequestById);

export default router;