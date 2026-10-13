import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }),
});

// Colors match the frontend's design tokens (src/styles/_tokens.scss).
const COLORS = {
  bg: '#f5f6f4',
  surface: '#ffffff',
  border: '#e2e5e0',
  text: '#161a17',
  textSecondary: '#4f5a53',
  textTertiary: '#7a857e',
  accent: '#0f766e',
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Every field is a fixed string from this file; user input never reaches the HTML.
type EmailContent = {
  subject: string;
  heading: string;
  paragraphs: string[];
  button: { label: string; url: string };
  footnote: string;
};

// Mail clients ignore <style> blocks and modern CSS, so the layout is tables with inline styles.
function renderHtml(content: EmailContent) {
  const paragraphs = content.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${COLORS.textSecondary};">${text}</p>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${content.subject}</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:${FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 20px;font-size:18px;font-weight:700;color:${COLORS.accent};">Focentra</td></tr>
    <tr><td style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:12px;padding:40px 36px;">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:700;color:${COLORS.text};">${content.heading}</h1>
      ${paragraphs}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;"><tr>
        <td style="border-radius:8px;background:${COLORS.accent};">
          <a href="${content.button.url}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${content.button.label}</a>
        </td>
      </tr></table>
      <p style="margin:0 0 6px;font-size:13px;line-height:20px;color:${COLORS.textTertiary};">If the button doesn't work, copy this link into your browser:</p>
      <p style="margin:0 0 28px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${content.button.url}" style="color:${COLORS.accent};">${content.button.url}</a></p>
      <hr style="border:0;border-top:1px solid ${COLORS.border};margin:0 0 20px;">
      <p style="margin:0;font-size:13px;line-height:20px;color:${COLORS.textTertiary};">${content.footnote}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

// Mail without a plain-text part is more likely to be marked as spam.
function renderText(content: EmailContent) {
  return [
    content.heading,
    '',
    ...content.paragraphs.flatMap((text) => [text, '']),
    `${content.button.label}: ${content.button.url}`,
    '',
    content.footnote,
    '',
    '-- Focentra',
  ].join('\n');
}

async function send(to: string, content: EmailContent) {
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: content.subject,
    html: renderHtml(content),
    text: renderText(content),
  });
}

export async function sendVerificationEmail(to: string, token: string) {
  await send(to, {
    subject: 'Confirm your email - Focentra',
    heading: 'Welcome to Focentra',
    paragraphs: [
      'Confirm your email address to activate your account.',
      'Then set your first goal and start the timer.',
    ],
    button: { label: 'Confirm email', url: `${env.FRONTEND_URL}/verify-email?token=${token}` },
    footnote:
      "This link expires in 24 hours. If you didn't sign up for Focentra, you can ignore this email.",
  });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  await send(to, {
    subject: 'Reset your password - Focentra',
    heading: 'Reset your password',
    paragraphs: [
      'We received a request to reset the password for your Focentra account.',
      'Choose a new one with the button below. All your devices will be signed out afterwards.',
    ],
    button: {
      label: 'Set a new password',
      url: `${env.FRONTEND_URL}/reset-password?token=${token}`,
    },
    footnote:
      "This link expires in 1 hour. If you didn't ask for it, ignore this email; your password stays the same.",
  });
}
