"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearTokens } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";
import { apiFetch } from "@/lib/api";
import { useEffect, useState } from "react";

export function TopNav() {
  const router = useRouter();
  const accessToken = useAccessToken();
  const isAuthed = Boolean(accessToken);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    apiFetch<{ role?: string }>("/me/", {}, accessToken)
      .then((me) => setRole(me.role ?? "student"))
      .catch(() => setRole("student"));
  }, [accessToken]);

  const handleLogout = () => {
    clearTokens();
    setRole(null);
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/90 backdrop-blur-md">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link href={isAuthed ? "/dashboard" : "/"} className="font-semibold tracking-tight text-slate-900">
          MerxyLab
        </Link>
        <div className="flex items-center gap-3 text-sm text-slate-700">
          {!isAuthed ? (
            <>
              <Link className="rounded-md px-2 py-1 hover:bg-slate-100" href="/login">
                Login
              </Link>
              <Link className="rounded-md bg-amber-700 px-3 py-1.5 font-medium text-white" href="/register">
                Register
              </Link>
            </>
          ) : (
            <>
              <Link className="rounded-md px-2 py-1 hover:bg-slate-100" href="/dashboard">
                Dashboard
              </Link>
              {role === "admin" && (
                <Link className="rounded-md px-2 py-1 hover:bg-slate-100" href="/admin-ui">
                  Admin UI
                </Link>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5"
              >
                Logout
              </button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
