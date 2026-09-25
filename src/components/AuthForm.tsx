"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup } from "@/app/actions/auth";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [state, action, pending] = useActionState(mode === "login" ? login : signup, undefined);
  return (
    <div className="mx-auto max-w-sm card p-6 space-y-5">
      <h1 className="text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
      <form action={action} className="space-y-3">
        {mode === "signup" && (
          <label className="block space-y-1 text-sm">
            <span>Name</span>
            <input name="name" className="input" required autoComplete="name" />
          </label>
        )}
        <label className="block space-y-1 text-sm">
          <span>Email</span>
          <input name="email" type="email" className="input" required autoComplete="email" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Password</span>
          <input
            name="password"
            type="password"
            className="input"
            required
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn w-full" disabled={pending}>
          {pending ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>
      <p className="text-sm text-muted">
        {mode === "login" ? (
          <>No account? <Link className="text-brand" href="/signup">Sign up</Link></>
        ) : (
          <>Already registered? <Link className="text-brand" href="/login">Log in</Link></>
        )}
      </p>
    </div>
  );
}
