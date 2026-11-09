import SellRequest from "../models/sellRequest.js";

export const createSellRequest = async (req, res) => {
    try {
        const data = req.body;

        // Default source is Website if not provided
        if (!data.source) data.source = "Website";

        const newRequest = await SellRequest.create(data);

        // (Optional) Yahan aap Twilio ya email notification bhej sakte hain
        // await twilioService.sendCustomSMS(data.phone, `Your sell request ${newRequest.requestNumber} is received.`);

        res.status(201).json({
            success: true,
            message: "Sell request submitted successfully",
            data: newRequest,
        });
    } catch (error) {
        console.error("Create Sell Request Error:", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get all sell requests (Admin CRM)
 * @route   GET /api/sell-requests
 * @access  Private (Admin)
 */
export const getAllSellRequests = async (req, res) => {
    try {
        const { page = 1, limit = 20, search = "", status } = req.query;

        let query = {};

        // Filter by status if provided
        if (status && status !== "All Statuses") {
            query.status = status;
        }

        // Search by seller name, phone, or vehicle
        if (search) {
            query.$or = [
                { sellerName: { $regex: search, $options: "i" } },
                { phone: { $regex: search, $options: "i" } },
                { brand: { $regex: search, $options: "i" } },
                { model: { $regex: search, $options: "i" } },
                { requestNumber: { $regex: search, $options: "i" } },
            ];
        }

        const requests = await SellRequest.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await SellRequest.countDocuments(query);

        res.status(200).json({
            success: true,
            data: requests,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("Get Sell Requests Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

/**
 * @desc    Get single sell request details
 * @route   GET /api/sell-requests/:id
 * @access  Private (Admin)
 */
export const getSellRequestById = async (req, res) => {
    try {
        const request = await SellRequest.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        res.status(200).json({ success: true, data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Update status or details (Admin actions)
 * @route   PUT /api/sell-requests/:id
 * @access  Private (Admin)
 */
export const updateSellRequest = async (req, res) => {
    try {
        const updatedRequest = await SellRequest.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!updatedRequest) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        res.status(200).json({ success: true, data: updatedRequest });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Soft delete a sell request
 * @route   DELETE /api/sell-requests/:id
 * @access  Private (Admin)
 */
export const deleteSellRequest = async (req, res) => {
    try {
        const deleted = await SellRequest.findByIdAndUpdate(
            req.params.id,
            { deletedAt: new Date() },
            { new: true }
        );

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        res.status(200).json({ success: true, message: "Request deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};