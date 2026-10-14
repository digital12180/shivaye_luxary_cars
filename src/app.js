import express from "express";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import appointmentRoutes from "./routes/appointment.routes.js";
import campaignRoutes from "./routes/campaign.routes.js";
import customerRoutes from "./routes/customer.routes.js";
// import customerAuthRoutes from "./routes/customerAuth.routes.js";
import leadRoutes from "./routes/lead.routes.js";
import leadActivityRoutes from "./routes/leadActivity.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import reservationRoutes from "./routes/reservation.routes.js";
import saleRoutes from "./routes/sale.routes.js";
import vehicleRoutes from "./routes/vehicle.routes.js";
import { notFound, errorHandler } from "./middleware/error.middleware.js";

const app = express();
app.use("/api/v1/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/appointments", appointmentRoutes);
app.use("/api/v1/campaigns", campaignRoutes);
app.use("/api/v1/customers", customerRoutes);
// app.use("/api/v1/customer-auth", customerAuthRoutes);
app.use("/api/v1/leads", leadRoutes);
app.use("/api/v1/lead-activities", leadActivityRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/reservations", reservationRoutes);
app.use("/api/v1/sales", saleRoutes);
app.use("/api/v1/vehicles", vehicleRoutes);
//
app.use(notFound);
app.use(errorHandler);

export default app;