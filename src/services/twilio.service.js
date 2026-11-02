import twilio from "twilio";

class TwilioService {
    constructor() {
        this.client = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );
        this.verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
        this.useVerify = process.env.TWILIO_USE_VERIFY === 'true';
    }

    /**
     * Send OTP via SMS (Using Twilio Verify for India compliance)
     */
    async sendOTP(phoneNumber) {
        try {
            // Format Indian number
            let formattedNumber = this.formatIndianNumber(phoneNumber);

            console.log("formatted number ------------", formattedNumber);


            if (this.useVerify) {
                // Using Twilio Verify Service (Recommended for India)
                const verification = await this.client.verify.v2
                    .services(this.verifyServiceSid)
                    .verifications.create({
                        to: formattedNumber,
                        channel: 'sms'
                    });

                return {
                    success: true,
                    status: verification.status,
                    method: 'verify'
                };
            } else {
                // Using Programmable SMS (Need DLT compliance)
                const otp = this.generateOTP();

                console.log("otpp=========================", otp);


                const message = await this.client.messages.create({
                    body: `Your OTP for login/registration is: ${otp}. Valid for 5 minutes. Do not share this OTP with anyone.`,
                    to: formattedNumber,
                    from: process.env.TWILIO_PHONE_NUMBER
                });

                return {
                    success: true,
                    messageSid: message.sid,
                    otp: process.env.NODE_ENV === 'development' ? otp : undefined,
                    method: 'programmable'
                };
            }
        } catch (error) {
            console.error('Twilio Send OTP Error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Verify OTP
     */
    async verifyOTP(phoneNumber, code) {
        try {
            let formattedNumber = this.formatIndianNumber(phoneNumber);

            if (this.useVerify) {
                const verificationCheck = await this.client.verify.v2
                    .services(this.verifyServiceSid)
                    .verificationChecks.create({
                        to: formattedNumber,
                        code: code
                    });

                return {
                    success: verificationCheck.status === 'approved',
                    status: verificationCheck.status
                };
            } else {
                // For programmable SMS, OTP verification needs to be done in-memory
                // This will be handled by your existing otpStore
                return {
                    success: true,
                    needsManualVerification: true
                };
            }
        } catch (error) {
            console.error('Twilio Verify OTP Error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Format Indian phone number
     */
    formatIndianNumber(phoneNumber) {
        let cleaned = phoneNumber.toString().trim();

        // Remove any non-digit characters except +
        cleaned = cleaned.replace(/[^\d+]/g, '');

        // Add +91 if not present
        if (!cleaned.startsWith('+')) {
            // Remove leading 0 if present
            if (cleaned.startsWith('0')) {
                cleaned = cleaned.substring(1);
            }
            cleaned = `+91${cleaned}`;
        }

        return cleaned;
    }

    /**
     * Generate 6-digit OTP
     */
    generateOTP() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /**
     * Send custom SMS (for order confirmations)
     */
    async sendCustomSMS(phoneNumber, message) {
        try {
            let formattedNumber = this.formatIndianNumber(phoneNumber);

            const messageResponse = await this.client.messages.create({
                body: message,
                to: formattedNumber,
                from: process.env.TWILIO_PHONE_NUMBER
            });

            return {
                success: true,
                messageSid: messageResponse.sid
            };
        } catch (error) {
            console.error('Twilio Send SMS Error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

export const twilioService = new TwilioService();