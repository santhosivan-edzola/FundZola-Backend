const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendUserInvite({ to, name, email, password, modules }) {
  const moduleList = modules.length ? modules.join(', ') : 'None assigned';
  const loginUrl = process.env.APP_URL || 'http://localhost:5173';

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
      <div style="background:#1A1A1A;padding:24px;text-align:center;">
        <h1 style="color:#E8967A;margin:0;font-size:22px;">Fundzola</h1>
        <p style="color:#8ECFCA;margin:4px 0 0;font-size:11px;letter-spacing:1px;">by EdZola</p>
      </div>
      <div style="padding:32px;background:#fafafa;border:1px solid #eee;">
        <h2 style="color:#1A1A1A;margin-top:0;">You've been invited to Fundzola</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>You now have access to the Fundzola portal. Use the credentials below to log in:</p>
        <div style="background:#FAE8DC;border-left:4px solid #E8967A;padding:16px;margin:16px 0;border-radius:4px;">
          <p style="margin:0;"><strong>Email:</strong> ${email}</p>
          <p style="margin:8px 0 0;"><strong>Temporary Password:</strong> ${password}</p>
        </div>
        <p><strong>Modules you can access:</strong> ${moduleList}</p>
        <a href="${loginUrl}" style="display:inline-block;background:#E8967A;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:8px;">
          Log in to Fundzola
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px;">
          Please change your password after logging in for the first time.
        </p>
      </div>
    </div>
  `;

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`\n[Mailer] SMTP not configured — invitation details:\n  To: ${to}\n  Email: ${email}\n  Password: ${password}\n  Modules: ${moduleList}\n`);
    return;
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || '"Fundzola" <noreply@fundzola.com>',
    to,
    subject: 'You have been invited to Fundzola',
    html,
  });
}

module.exports = { sendUserInvite };
