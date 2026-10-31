import nodemailer from "nodemailer";

type AccountEmail = {
  to: string;
  recipientName: string;
  storeName: string;
  link: string;
  kind: "invite" | "password-reset";
  validFor: string;
};

export type MailFailure = { code: string; responseCode?: number };

const knownCodes = new Set([
  "SMTP_CONFIG_MISSING", "APP_URL_MISSING", "EAUTH", "ECONNECTION", "ECONNREFUSED",
  "ECONNRESET", "ETIMEDOUT", "ESOCKET", "ETLS", "EDNS", "EENVELOPE",
  "EMESSAGE", "EHOSTUNREACH",
]);

export function mailFailure(error: unknown): MailFailure {
  const details = error && typeof error === "object" ? error as { code?: unknown; responseCode?: unknown } : {};
  const rawCode = typeof details.code === "string" ? details.code.toUpperCase() : "";
  const code = knownCodes.has(rawCode) ? rawCode : "UNKNOWN";
  const responseCode = typeof details.responseCode === "number" && Number.isInteger(details.responseCode)
    && details.responseCode >= 400 && details.responseCode <= 599 ? details.responseCode : undefined;
  return { code, ...(responseCode ? { responseCode } : {}) };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export async function sendAccountEmail({ to, recipientName, storeName, link, kind, validFor }: AccountEmail) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from) {
    const error = new Error("SMTP settings are incomplete") as Error & { code: string };
    error.code = "SMTP_CONFIG_MISSING";
    throw error;
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const invite = kind === "invite";
  const title = invite ? "You’re invited to join the team" : "Reset your password";
  const action = invite ? "Set up your account" : "Choose a new password";
  const safeName = escapeHtml(recipientName);
  const safeStore = escapeHtml(storeName);
  const safeLink = escapeHtml(link);
  const text = invite
    ? `Hi ${recipientName},\n\nYou’ve been invited to join ${storeName}. Set up your account within ${validFor}: ${link}\n\nIf you weren’t expecting this invitation, you can ignore this email.`
    : `Hi ${recipientName},\n\nA store owner requested a password reset for your ${storeName} account. Choose a new password within ${validFor}: ${link}\n\nIf you didn’t request this, you can ignore this email.`;

  await transport.sendMail({
    from,
    to,
    subject: `${title} · ${storeName}`,
    text,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f1eb;font-family:Arial,Helvetica,sans-serif;color:#302923"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;background:#f5f1eb"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fffefa;border:1px solid #e9e0d7;border-radius:18px;overflow:hidden"><tr><td style="height:7px;background:#b8492d;font-size:0">&nbsp;</td></tr><tr><td style="padding:34px 32px 30px"><p style="margin:0 0 12px;color:#a45a43;font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase">${safeStore}</p><h1 style="margin:0 0 16px;font-size:27px;line-height:1.2;letter-spacing:-.5px">${title}</h1><p style="margin:0 0 10px;font-size:16px;line-height:1.6">Hi ${safeName},</p><p style="margin:0 0 24px;color:#625d56;font-size:15px;line-height:1.65">${invite ? `You’ve been invited to join the ${safeStore} team. Set up your password to get started.` : `A store owner requested a password reset for your ${safeStore} account. Use the button below to choose a new password.`}</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:10px;background:#b8492d"><a href="${safeLink}" style="display:inline-block;padding:14px 21px;color:#fff;text-decoration:none;font-size:15px;font-weight:bold">${action}</a></td></tr></table><p style="margin:21px 0 6px;color:#79746d;font-size:13px;line-height:1.6">This link expires in <strong>${escapeHtml(validFor)}</strong> and can only be used once.</p><p style="margin:20px 0 6px;color:#79746d;font-size:12px">If the button doesn’t work, copy this link into your browser:</p><p style="margin:0;overflow-wrap:anywhere;font-size:12px;line-height:1.6"><a href="${safeLink}" style="color:#a7442b">${safeLink}</a></p><hr style="margin:28px 0 17px;border:0;border-top:1px solid #eee8e1"><p style="margin:0;color:#999188;font-size:12px;line-height:1.5">If you weren’t expecting this email, you can safely ignore it.</p></td></tr></table><p style="margin:18px 0 0;color:#aaa198;font-size:11px">Store team access</p></td></tr></table></body></html>`,
  });
}
