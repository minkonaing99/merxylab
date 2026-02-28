"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";

export default function RegisterPage() {
  const router = useRouter();
  const accessToken = useAccessToken();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    apiFetch<{ role?: string }>("/me/", {}, token)
      .then((me) => {
        router.replace(me.role === "admin" ? "/admin-ui" : "/dashboard");
      })
      .catch(() => {
        setAuthChecking(false);
      });
  }, [accessToken, router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiFetch("/auth/register/", {
        method: "POST",
        body: JSON.stringify({ username, email, password }),
      });
      const nextPath =
        typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("next") : null;
      router.push(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Registration failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-65px)] w-full max-w-md items-center px-4 py-10 fade-up">
      {authChecking ? (
        <div className="surface w-full p-7 md:p-8 text-sm muted">Redirecting...</div>
      ) : (
      <form onSubmit={onSubmit} className="surface w-full p-7 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] muted">Get Started</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create Account</h1>
        <p className="mt-2 text-sm muted">Create your student account in less than a minute.</p>
        <label className="mt-5 block text-sm">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input"
            required
          />
        </label>
        <label className="mt-4 block text-sm">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </label>
        <label className="mt-4 block text-sm">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            minLength={8}
            required
          />
        </label>
        {error && <p className="mt-3 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
        <button
          disabled={loading}
          className="btn btn-primary mt-5 w-full disabled:opacity-60"
        >
          {loading ? "Creating..." : "Register"}
        </button>
        <p className="mt-4 text-center text-sm muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium">
            Login
          </Link>
        </p>
      </form>
      )}
    </main>
  );
}
