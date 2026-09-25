"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { encryptSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export type FormState = { error?: string } | undefined;

const SignupSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name"),
  email: z.email("Please enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

async function startSession(userId: number) {
  (await cookies()).set(SESSION_COOKIE, await encryptSession(userId), sessionCookieOptions);
}

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = SignupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const db = await getDb();
  const { name, email, password } = parsed.data;
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (existing) return { error: "An account with this email already exists" };
  const [user] = await db
    .insert(schema.users)
    .values({ name, email, passwordHash: await bcrypt.hash(password, 10) })
    .returning({ id: schema.users.id });
  await startSession(user.id);
  redirect("/locations?welcome=1");
}

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Wrong email or password" };
  }
  await startSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}
