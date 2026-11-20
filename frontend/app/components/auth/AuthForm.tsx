"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { errorMessage, post } from "@/app/services/api";
import type { User } from "@/app/types/api";
import { Button, Card, ErrorNote, Input } from "@/app/components/ui";

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ name: "", email: "", password: "", inviteCode: params.get("invite") ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === "signin" ? { email: form.email, password: form.password } : { ...form, inviteCode: form.inviteCode || undefined };
      const { user } = await post<{ user: User }>(`/auth/${mode === "signin" ? "login" : "signup"}`, body);
      router.push(mode === "signup" || !user.onboardedAt ? "/onboarding" : params.get("next") ?? "/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <Link href="/" className="mb-6 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand font-bold text-brand-ink">J</span>
          <span className="font-semibold">JobPilot</span>
        </Link>
        <h1 className="text-xl font-semibold">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-ink-3">{mode === "signin" ? "Sign in to your job search." : "It takes about 3 minutes to set up."}</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "signup" && <Input label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />}
          <Input label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
          <Input label="Password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={mode === "signin" ? "current-password" : "new-password"} hint={mode === "signup" ? "At least 8 characters" : undefined} />
          {mode === "signup" && <Input label="College invite code (optional)" value={form.inviteCode} onChange={(e) => setForm({ ...form, inviteCode: e.target.value })} />}
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" loading={busy} className="w-full">
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-3">
          {mode === "signin" ? (
            <>New here? <Link className="font-medium text-brand" href="/auth/signup">Create an account</Link></>
          ) : (
            <>Already have an account? <Link className="font-medium text-brand" href="/auth/signin">Sign in</Link></>
          )}
        </p>
      </Card>
    </div>
  );
}
