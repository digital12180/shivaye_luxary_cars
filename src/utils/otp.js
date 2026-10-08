import crypto from "crypto";

export const generateOtp = () =>
    String(crypto.randomInt(100000, 999999)); // 6-digit

export const hashOtp = (otp) =>
    crypto.createHash("sha256").update(String(otp)).digest("hex");