"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { saveTokens } from "@/lib/auth";

type LoginResponse = {
  access: string;
  refresh: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload = await apiFetch<LoginResponse>("/auth/login/", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      saveTokens(payload.access, payload.refresh);
      const nextPath =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("next") || "/dashboard"
          : "/dashboard";
      router.push(nextPath);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Login failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] w-full max-w-md items-center px-4 py-10">
      <form onSubmit={onSubmit} className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Login</h1>
        <p className="mt-2 text-sm text-slate-600">Use your username/password to continue.</p>
        <label className="mt-5 block text-sm">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            required
          />
        </label>
        <label className="mt-4 block text-sm">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            required
          />
        </label>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <button
          disabled={loading}
          className="mt-5 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "Logging in..." : "Login"}
        </button>
        <p className="mt-3 text-sm text-slate-600">
          No account?{" "}
          <Link href="/register" className="font-medium text-amber-700">
            Register
          </Link>
        </p>
      </form>
    </main>
  );
}
