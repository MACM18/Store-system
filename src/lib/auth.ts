import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const scrypt = promisify(nodeScrypt);
const COOKIE = "store_session";
const sessionDays = Math.min(Math.max(Number(process.env.SESSION_DAYS ?? 14), 1), 60);

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, saltHex, keyHex] = encoded.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function detectDevice(userAgent: string) {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS/.test(userAgent) ? "Mac" : /Linux/.test(userAgent) ? "Linux" : "device";
  return `${browser} on ${os}`;
}

export async function createDeviceSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 500) ?? "";
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  const session = await prisma.deviceSession.create({
    data: { userId, tokenHash: tokenDigest(token), deviceName: detectDevice(userAgent), userAgent, expiresAt },
  });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return session;
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.deviceSession.findUnique({
    where: { tokenHash: tokenDigest(token) },
    include: { user: { include: { store: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.deviceSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

export async function endCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (token) {
    await prisma.deviceSession.updateMany({ where: { tokenHash: tokenDigest(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  cookieStore.delete(COOKIE);
}

export async function requireRole(...roles: Array<"OWNER" | "MANAGER" | "CASHIER">) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (roles.length > 0 && !roles.includes(session.user.role)) redirect("/?error=authorization");
  return session;
}
