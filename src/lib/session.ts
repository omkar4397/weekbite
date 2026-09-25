import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "wb_session";
const MAX_AGE_S = 30 * 24 * 3600;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.VERCEL) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret ?? "dev-only-insecure-secret-change-me");
}

export async function encryptSession(userId: number) {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key());
}

export async function decryptSession(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return typeof payload.uid === "number" ? { userId: payload.uid } : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_S,
};
