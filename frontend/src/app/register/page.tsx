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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [usernameHint, setUsernameHint] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  const passwordRules = {
    minLength: password.length >= 8,
    hasLower: /[a-z]/.test(password),
    hasUpper: /[A-Z]/.test(password),
    hasNumber: /\d/.test(password),
  };
  const isPasswordStrong =
    passwordRules.minLength && passwordRules.hasLower && passwordRules.hasUpper && passwordRules.hasNumber;
  const isConfirmMatched = confirmPassword.length > 0 && password === confirmPassword;

  const checkUsername = async (value: string) => {
    const nextUsername = value.trim();
    if (nextUsername.length < 3) {
      setUsernameStatus("idle");
      setUsernameHint(nextUsername ? "Username must be at least 3 characters." : "");
      return false;
    }
    setUsernameStatus("checking");
    setUsernameHint("");
    try {
      const result = await apiFetch<{ available: boolean; detail?: string }>(
        `/auth/username-available/?username=${encodeURIComponent(nextUsername)}`,
      );
      const available = Boolean(result.available);
      setUsernameStatus(available ? "available" : "taken");
      setUsernameHint(result.detail || (available ? "Username is available." : "Username is already taken."));
      return available;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not check username right now.";
      setUsernameStatus("idle");
      setUsernameHint(message);
      return false;
    }
  };

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    apiFetch<{ role?: string }>("/me/", {}, token)
      .then((me) => {
        router.replace(me.role === "admin" ? "/admin-students" : "/dashboard");
      })
      .catch(() => {
        setAuthChecking(false);
      });
  }, [accessToken, router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkUsername(username);
    }, 350);
    return () => clearTimeout(timer);
  }, [username]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const normalizedUsername = username.trim();
    if (!isPasswordStrong) {
      setError("Password must include uppercase, lowercase, number, and at least 8 characters.");
      return;
    }
    if (!isConfirmMatched) {
      setError("Retype password does not match.");
      return;
    }
    const available = await checkUsername(normalizedUsername);
    if (!available) {
      setError("Please choose a different username.");
      return;
    }

    setLoading(true);
    try {
      await apiFetch("/auth/register/", {
        method: "POST",
        body: JSON.stringify({ username: normalizedUsername, email, password }),
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
        {usernameHint && (
          <p
            className={`mt-2 text-xs ${
              usernameStatus === "available"
                ? "text-emerald-600"
                : usernameStatus === "taken"
                  ? "text-red-500"
                  : "muted"
            }`}
          >
            {usernameStatus === "checking" ? "Checking username..." : usernameHint}
          </p>
        )}
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
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <p className="mb-1 font-medium text-slate-700">Password tips</p>
          <p className={passwordRules.minLength ? "text-emerald-600" : "text-slate-500"}>- At least 8 characters</p>
          <p className={passwordRules.hasUpper ? "text-emerald-600" : "text-slate-500"}>- Include uppercase letter</p>
          <p className={passwordRules.hasLower ? "text-emerald-600" : "text-slate-500"}>- Include lowercase letter</p>
          <p className={passwordRules.hasNumber ? "text-emerald-600" : "text-slate-500"}>- Include number</p>
        </div>
        <label className="mt-4 block text-sm">
          Retype Password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input"
            required
          />
        </label>
        {confirmPassword.length > 0 && (
          <p className={`mt-2 text-xs ${isConfirmMatched ? "text-emerald-600" : "text-red-500"}`}>
            {isConfirmMatched ? "Password matched." : "Password does not match."}
          </p>
        )}
        {error && <p className="mt-3 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
        <button
          disabled={loading || !isPasswordStrong || !isConfirmMatched || usernameStatus !== "available"}
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
