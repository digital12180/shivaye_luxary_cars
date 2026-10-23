// utils/emailService.js
import nodemailer from "nodemailer";
import { forgotPasswordEmailTemplate } from "../templates/forgotPassword.email.js";
import dotenv from "dotenv";
dotenv.config();

// Create transporter once (reuse it)
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});

// Verify connection at startup (optional but recommended)
transporter.verify((error) => {
    if (error) {
        console.error("❌ Email transporter error:", error.message);
    } else {
        console.log("✅ Email transporter is ready");
    }
});

/**
 * Send forgot password email
 * @param {string} to - recipient email
 * @param {string} rawToken - the plain reset token
 * @param {string} userName - optional, for personalization
 */
export const sendForgotPasswordEmail = async (to, rawToken, userName = "User") => {
    try {
        const resetLink = `${process.env.CLIENT_URL}/reset-password/${rawToken}`;

        const mailOptions = {
            from: `"${process.env.FROM_NAME || "Your App"}" <${process.env.GMAIL_USER}>`,
            to,
            subject: "Reset Your Password",
            html: forgotPasswordEmailTemplate(userName, resetLink),
        };

        const info = await transporter.sendMail(mailOptions);
        console.log("📧 Forgot password email sent:", info.messageId);
        return info;
    } catch (err) {
        console.error("❌ Failed to send forgot password email:", err.message);
        throw err; // let controller decide what to do
    }
};