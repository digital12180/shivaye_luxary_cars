export const forgotPasswordEmailTemplate = (userName, resetLink) => {
  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>Reset Your Password</title>
    </head>
    <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8; padding:40px 0;">
        <tr>
          <td align="center">
            <table width="500" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
              <!-- Header -->
              <tr>
                <td style="background-color:#111827; padding:24px; text-align:center;">
                  <h1 style="color:#ffffff; margin:0; font-size:22px;">Your App</h1>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:32px;">
                  <h2 style="color:#111827; margin-top:0;">Password Reset Request</h2>
                  <p style="color:#374151; font-size:15px; line-height:1.6;">
                    Hi ${userName},
                  </p>
                  <p style="color:#374151; font-size:15px; line-height:1.6;">
                    We received a request to reset your password. Click the button below to set a new password. This link is valid for <strong>15 minutes</strong>.
                  </p>
                  <div style="text-align:center; margin:32px 0;">
                    <a href="${resetLink}"
                       style="background-color:#2563eb; color:#ffffff; text-decoration:none; padding:12px 28px; border-radius:6px; font-size:15px; font-weight:bold; display:inline-block;">
                      Reset Password
                    </a>
                  </div>
                  <p style="color:#6b7280; font-size:13px; line-height:1.6;">
                    If the button doesn't work, copy and paste this link into your browser:
                  </p>
                  <p style="color:#2563eb; font-size:12px; word-break:break-all; line-height:1.6;">
                    ${resetLink}
                  </p>
                  <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0;" />
                  <p style="color:#9ca3af; font-size:12px; line-height:1.6;">
                    If you didn't request this, you can safely ignore this email. Your password won't change.
                  </p>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#f9fafb; padding:16px; text-align:center;">
                  <p style="color:#9ca3af; font-size:12px; margin:0;">
                    © ${new Date().getFullYear()} Your App. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;
};