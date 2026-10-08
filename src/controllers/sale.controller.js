import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Vehicle from "../models/Vehicle.js";
import Customer from "../models/Customer.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/leadActivity.js";
import Campaign from "../models/Campaign.js";
import { ok, fail } from "../utils/response.js";
import { sendNotification } from "../services/notification.service.js";

/* ============================================================
   Helper — generate invoice number (e.g., SLC-INV-2025-00042)
   ============================================================ */
const generateInvoiceNumber = async () => {
    const year = new Date().getFullYear();
    const count = await Sale.countDocuments();
    return `SLC-INV-${year}-${String(count + 1).padStart(5, "0")}`;
};

/* ============================================================
   Helper — bump campaign metric (revenue / wonLeads)
   ============================================================ */
const bumpCampaignMetric = async (campaignId, field, delta) => {
    if (!campaignId) return;
    try {
        await Campaign.updateOne(
            { _id: campaignId },
            { $inc: { [`metrics.${field}`]: delta } }
        );
    } catch (err) {
        console.error("Campaign metric bump failed:", err.message);
    }
};

/* ============================================================
   CRM — Create Sale
   POST /api/v1/sales
   Body: { vehicle, customer, lead?, reservation?, salesExecutive?,
           pricing, saleType, source, deliveryDate?, notes,
           warranty?, exchange?, finance?, documents? }
   ============================================================ */
export const createSale = async (req, res, next) => {
    try {
        const { vehicle: vehicleId, customer: customerId, lead: leadId } = req.body;

        if (!vehicleId || !customerId)
            return fail(res, "vehicle and customer are required", 400);

        /* 1. Validate vehicle */
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return fail(res, "Vehicle not found", 404);

        if (vehicle.status === "sold")
            return fail(res, "Vehicle is already sold", 409);

        /* 2. Prevent duplicate sale */
        const existingSale = await Sale.findOne({ vehicle: vehicle._id });
        if (existingSale)
            return fail(res, "A sale record already exists for this vehicle", 409);

        /* 3. Validate customer */
        const customer = await Customer.findById(customerId);
        if (!customer) return fail(res, "Customer not found", 404);

        /* 4. Validate lead (if provided) */
        let lead = null;
        if (leadId && mongoose.isValidObjectId(leadId)) {
            lead = await Lead.findById(leadId);
        }

        /* 5. Auto-detect campaign from lead if not explicitly provided */
        const campaignId = req.body.campaign || lead?.campaign || null;

        /* 6. Invoice number */
        const invoiceNumber = req.body.invoiceNumber || (await generateInvoiceNumber());

        /* 7. Build snapshot fields */
        const vehicleSnapshot = {
            stockId: vehicle.stockId,
            brand: vehicle.brand,
            model: vehicle.model,
            variant: vehicle.variant,
            year: vehicle.year,
            fuelType: vehicle.fuelType,
            transmission: vehicle.transmission,
            color: vehicle.color,
            registrationNumber: vehicle.registrationNumber,
            kilometersAtSale: vehicle.kilometers,
        };

        const buyerSnapshot = {
            name: customer.name,
            phone: customer.phone,
            email: customer.email || null,
            city: customer.city || null,
            state: customer.state || null,
            address: customer.address || null,
            pincode: customer.pincode || null,
        };

        /* 8. Create sale */
        const sale = await Sale.create({
            ...req.body,
            vehicle: vehicle._id,
            customer: customer._id,
            lead: lead?._id || null,
            campaign: campaignId,
            salesExecutive: req.body.salesExecutive || req.user._id,
            vehicleSnapshot,
            buyerSnapshot,
            invoiceNumber,
            source: req.body.source || lead?.source || customer.source || "direct_website",
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        /* 9. Mark vehicle as sold (BRD 32) */
        vehicle.status = "sold";
        vehicle.soldAt = sale.saleDate;
        vehicle.soldTo = customer._id;
        vehicle.soldPrice = sale.pricing.finalSalePrice;
        vehicle.saleExecutive = sale.salesExecutive;
        vehicle.updatedBy = req.user._id;
        await vehicle.save();

        /* 10. Mark lead as won (if linked) */
        if (lead && lead.status !== "won") {
            lead.status = "won";
            lead.dealValue = sale.pricing.finalSalePrice;
            lead.wonAt = new Date();
            lead.closedAt = new Date();
            lead.updatedBy = req.user._id;
            await lead.save();

            await LeadActivity.create({
                lead: lead._id,
                customer: customer._id,
                type: "system",
                title: "Lead marked as won",
                description: `Sale completed. Invoice: ${invoiceNumber}`,
                meta: { saleId: sale._id, invoiceNumber },
            });
        }

        /* 11. Campaign metrics */
        if (campaignId) {
            await bumpCampaignMetric(campaignId, "wonLeads", 1);
            await bumpCampaignMetric(campaignId, "revenue", sale.pricing.finalSalePrice);
        }
        await sendNotification({
            recipientType: "customer",
            customerId: customer._id,
            to: customer.phone,
            channel: "whatsapp",
            type: "sale_completed",
            title: "Congratulations!",
            body: `Your ${vehicle.brand} ${vehicle.model} purchase is complete. Invoice: ${invoiceNumber}`,
            relatedTo: { sale: sale._id, vehicle: vehicle._id },
        });
        return ok(res, sale, "Sale recorded successfully", 201);
    } catch (err) {
        if (err.code === 11000) return fail(res, "Duplicate sale record", 409);
        next(err);
    }
};

/* ============================================================
   CRM — List sales
   GET /api/v1/sales
   Query: status, paymentStatus, salesExecutive, brand, source,
          fromDate, toDate, search, page, limit
   ============================================================ */
export const listSales = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const {
            paymentStatus, salesExecutive, brand, source,
            deliveryStatus, fromDate, toDate, search,
        } = req.query;

        const filter = {};

        if (req.user.role === "sales_executive") {
            filter.salesExecutive = req.user._id;
        } else if (salesExecutive) {
            filter.salesExecutive = salesExecutive;
        }

        if (paymentStatus) filter["pricing.paymentStatus"] = paymentStatus;
        if (brand) filter["vehicleSnapshot.brand"] = new RegExp(brand, "i");
        if (source) filter.source = source;
        if (deliveryStatus) filter.deliveryStatus = deliveryStatus;

        if (fromDate || toDate) {
            filter.saleDate = {};
            if (fromDate) filter.saleDate.$gte = new Date(fromDate);
            if (toDate) filter.saleDate.$lte = new Date(toDate);
        }

        if (search) {
            filter.$or = [
                { invoiceNumber: new RegExp(search, "i") },
                { "buyerSnapshot.name": new RegExp(search, "i") },
                { "buyerSnapshot.phone": new RegExp(search, "i") },
                { "vehicleSnapshot.brand": new RegExp(search, "i") },
                { "vehicleSnapshot.model": new RegExp(search, "i") },
                { "vehicleSnapshot.stockId": new RegExp(search, "i") },
            ];
        }

        const [data, total] = await Promise.all([
            Sale.find(filter)
                .populate("vehicle", "stockId brand model year images slug status")
                .populate("customer", "name phone email city")
                .populate("salesExecutive", "name email role")
                .populate("lead", "status source")
                .sort("-saleDate")
                .skip((page - 1) * limit)
                .limit(limit),
            Sale.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Get single sale
   GET /api/v1/sales/:id
   ============================================================ */
export const getSale = async (req, res, next) => {
    try {
        const sale = await Sale.findById(req.params.id)
            .populate("vehicle", "stockId brand model year images slug status")
            .populate("customer", "name phone email city state")
            .populate("salesExecutive", "name email role")
            .populate("lead", "status source assignedTo")
            .populate("reservation", "status paymentStatus")
            .populate("campaign", "name source type")
            .populate("createdBy", "name")
            .populate("updatedBy", "name")
            .populate("documents.uploadedBy", "name");

        if (!sale) return fail(res, "Sale not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(sale.salesExecutive?._id) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        return ok(res, sale);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Update sale (post-sale edits: payment, delivery, notes)
   PATCH /api/v1/sales/:id
   ============================================================ */
export const updateSale = async (req, res, next) => {
    try {
        const protectedFields = [
            "vehicleSnapshot", "buyerSnapshot", "invoiceNumber",
            "createdBy", "deletedAt", "vehicle", "customer",
        ];
        protectedFields.forEach((f) => delete req.body[f]);

        const sale = await Sale.findById(req.params.id);
        if (!sale) return fail(res, "Sale not found", 404);

        if (
            req.user.role === "sales_executive" &&
            String(sale.salesExecutive) !== String(req.user._id)
        ) {
            return fail(res, "Not authorized", 403);
        }

        Object.assign(sale, req.body);
        sale.updatedBy = req.user._id;
        await sale.save();

        return ok(res, sale, "Sale updated");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Update payment status
   PATCH /api/v1/sales/:id/payment
   Body: { amountPaid, paymentStatus?, paymentMethod? }
   ============================================================ */
export const updatePayment = async (req, res, next) => {
    try {
        const { amountPaid, paymentMethod } = req.body;

        const sale = await Sale.findById(req.params.id);
        if (!sale) return fail(res, "Sale not found", 404);

        if (amountPaid !== undefined) {
            sale.pricing.amountPaid = Number(amountPaid);
            const due = Math.max(0, sale.pricing.finalSalePrice - amountPaid);
            sale.pricing.amountDue = due;

            if (due === 0) sale.pricing.paymentStatus = "paid";
            else if (amountPaid > 0) sale.pricing.paymentStatus = "partial";
            else sale.pricing.paymentStatus = "pending";
        }

        if (paymentMethod !== undefined) sale.pricing.paymentMethod = paymentMethod;
        sale.updatedBy = req.user._id;
        await sale.save();

        return ok(res, sale, "Payment updated");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Delivery workflow
   PATCH /api/v1/sales/:id/delivery
   Body: { deliveryStatus, deliveryDate? }
   ============================================================ */
export const updateDelivery = async (req, res, next) => {
    try {
        const { deliveryStatus, deliveryDate } = req.body;
        const allowed = ["pending", "scheduled", "delivered", "cancelled"];
        if (!allowed.includes(deliveryStatus))
            return fail(res, "Invalid deliveryStatus", 400);

        const sale = await Sale.findById(req.params.id);
        if (!sale) return fail(res, "Sale not found", 404);

        sale.deliveryStatus = deliveryStatus;
        if (deliveryDate) sale.deliveryDate = new Date(deliveryDate);
        if (deliveryStatus === "delivered") sale.deliveredAt = new Date();
        sale.updatedBy = req.user._id;
        await sale.save();

        return ok(res, sale, `Delivery ${deliveryStatus}`);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Add document (RC transfer, NOC, insurance)
   POST /api/v1/sales/:id/documents
   Body: { name, url }
   ============================================================ */
export const addDocument = async (req, res, next) => {
    try {
        const { name, url } = req.body;
        if (!name || !url) return fail(res, "name and url are required", 400);

        const sale = await Sale.findById(req.params.id);
        if (!sale) return fail(res, "Sale not found", 404);

        sale.documents.push({
            name,
            url,
            uploadedAt: new Date(),
            uploadedBy: req.user._id,
        });
        sale.updatedBy = req.user._id;
        await sale.save();

        return ok(res, sale, "Document added");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Remove document
   DELETE /api/v1/sales/:id/documents/:docId
   ============================================================ */
export const removeDocument = async (req, res, next) => {
    try {
        const sale = await Sale.findById(req.params.id);
        if (!sale) return fail(res, "Sale not found", 404);

        sale.documents = sale.documents.filter(
            (d) => String(d._id) !== String(req.params.docId)
        );
        sale.updatedBy = req.user._id;
        await sale.save();

        return ok(res, sale, "Document removed");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Soft delete sale (admin only — reversible, restores vehicle)
   DELETE /api/v1/sales/:id
   ============================================================ */
export const deleteSale = async (req, res, next) => {
    try {
        const sale = await Sale.findById(req.params.id);
        if (!sale) return fail(res, "Sale not found", 404);

        sale.deletedAt = new Date();
        sale.isActive = false;
        sale.updatedBy = req.user._id;
        await sale.save();

        // Restore vehicle to available (BRD 32 – reversible status)
        await Vehicle.findByIdAndUpdate(sale.vehicle, {
            status: "available",
            soldAt: null,
            soldTo: null,
            soldPrice: null,
            saleExecutive: null,
            updatedBy: req.user._id,
        });

        // Roll back campaign metrics
        if (sale.campaign) {
            await bumpCampaignMetric(sale.campaign, "wonLeads", -1);
            await bumpCampaignMetric(sale.campaign, "revenue", -sale.pricing.finalSalePrice);
        }

        return ok(res, {}, "Sale deleted, vehicle restored");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Sales Dashboard (BRD 34.2)
   GET /api/v1/sales/stats/dashboard
   ============================================================ */
export const getSalesDashboard = async (req, res, next) => {
    try {
        const scopeFilter =
            req.user.role === "sales_executive" ? { salesExecutive: req.user._id } : {};

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const [
            totalSales,
            monthSales,
            revenueAgg,
            monthRevenueAgg,
            avgSaleAgg,
            byBrand,
            byExecutive,
            bySource,
            byPaymentStatus,
            bySaleType,
            avgDaysToSell,
        ] = await Promise.all([
            Sale.countDocuments(scopeFilter),
            Sale.countDocuments({ ...scopeFilter, saleDate: { $gte: startOfMonth } }),
            Sale.aggregate([
                { $match: scopeFilter },
                { $group: { _id: null, sum: { $sum: "$pricing.finalSalePrice" } } },
            ]),
            Sale.aggregate([
                { $match: { ...scopeFilter, saleDate: { $gte: startOfMonth } } },
                { $group: { _id: null, sum: { $sum: "$pricing.finalSalePrice" } } },
            ]),
            Sale.aggregate([
                { $match: scopeFilter },
                { $group: { _id: null, avg: { $avg: "$pricing.finalSalePrice" } } },
            ]),
            Sale.aggregate([
                { $match: scopeFilter },
                { $group: { _id: "$vehicleSnapshot.brand", count: { $sum: 1 }, revenue: { $sum: "$pricing.finalSalePrice" } } },
                { $sort: { count: -1 } },
            ]),
            Sale.aggregate([
                { $match: scopeFilter },
                { $group: { _id: "$salesExecutive", count: { $sum: 1 }, revenue: { $sum: "$pricing.finalSalePrice" } } },
                { $sort: { revenue: -1 } },
                {
                    $lookup: {
                        from: "users",
                        localField: "_id",
                        foreignField: "_id",
                        as: "user",
                    },
                },
                { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
                { $project: { _id: 0, userId: "$_id", name: "$user.name", count: 1, revenue: 1 } },
            ]),
            Sale.aggregate([
                { $match: scopeFilter },
                { $group: { _id: "$source", count: { $sum: 1 }, revenue: { $sum: "$pricing.finalSalePrice" } } },
                { $sort: { count: -1 } },
            ]),
            Sale.aggregate([
                { $match: scopeFilter },
                { $group: { _id: "$pricing.paymentStatus", count: { $sum: 1 } } },
            ]),
            Sale.aggregate([
                { $match: scopeFilter },
                { $group: { _id: "$saleType", count: { $sum: 1 } } },
            ]),
            Sale.aggregate([
                { $match: scopeFilter },
                {
                    $lookup: {
                        from: "vehicles",
                        localField: "vehicle",
                        foreignField: "_id",
                        as: "v",
                    },
                },
                { $unwind: { path: "$v", preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        days: {
                            $divide: [
                                { $subtract: ["$saleDate", "$v.listedAt"] },
                                1000 * 60 * 60 * 24,
                            ],
                        },
                    },
                },
                { $group: { _id: null, avg: { $avg: "$days" } } },
            ]),
        ]);

        return ok(res, {
            totalSales,
            monthSales,
            totalRevenue: revenueAgg[0]?.sum || 0,
            monthRevenue: monthRevenueAgg[0]?.sum || 0,
            averageSaleValue: avgSaleAgg[0]?.avg ? Number(avgSaleAgg[0].avg.toFixed(2)) : 0,
            averageDaysToSell: avgDaysToSell[0]?.avg ? Number(avgDaysToSell[0].avg.toFixed(1)) : 0,
            byBrand,
            byExecutive,
            bySource,
            byPaymentStatus,
            bySaleType,
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Monthly sales trend (BRD 34.2)
   GET /api/v1/sales/stats/monthly?year=2025
   ============================================================ */
export const getMonthlySalesTrend = async (req, res, next) => {
    try {
        const year = Number(req.query.year) || new Date().getFullYear();
        const scopeFilter =
            req.user.role === "sales_executive" ? { salesExecutive: req.user._id } : {};

        const data = await Sale.aggregate([
            {
                $match: {
                    ...scopeFilter,
                    saleDate: {
                        $gte: new Date(`${year}-01-01`),
                        $lt: new Date(`${year + 1}-01-01`),
                    },
                },
            },
            {
                $group: {
                    _id: { $month: "$saleDate" },
                    count: { $sum: 1 },
                    revenue: { $sum: "$pricing.finalSalePrice" },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        return ok(res, { year, data });
    } catch (err) {
        next(err);
    }
};