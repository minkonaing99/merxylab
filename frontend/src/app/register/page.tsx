"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    <main className="mx-auto flex min-h-[calc(100vh-65px)] w-full max-w-md items-center px-4 py-10">
      <form onSubmit={onSubmit} className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Create Account</h1>
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
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="mt-4 block text-sm">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            minLength={8}
            required
          />
        </label>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <button
          disabled={loading}
          className="mt-5 w-full rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "Creating..." : "Register"}
        </button>
        <p className="mt-3 text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-slate-900">
            Login
          </Link>
        </p>
      </form>
    </main>
  );
}
