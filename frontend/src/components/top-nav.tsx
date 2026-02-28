"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearTokens } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";
import { apiFetch } from "@/lib/api";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getTheme, setTheme, subscribeThemeChange } from "@/lib/theme";

export function TopNav() {
  const router = useRouter();
  const accessToken = useAccessToken();
  const isAuthed = Boolean(accessToken);
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const theme = useSyncExternalStore(subscribeThemeChange, getTheme, () => "light");
  const [role, setRole] = useState<string | null>(null);
  const showAuthedNav = isHydrated && isAuthed;

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
    <header className="sticky top-0 z-20 border-b backdrop-blur-md" style={{ background: "color-mix(in srgb, var(--surface) 86%, transparent)" }}>
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link href={showAuthedNav ? "/dashboard" : "/"} className="font-semibold tracking-tight">
          MerxyLab
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="btn btn-secondary px-3 py-1.5 text-xs"
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          {!showAuthedNav ? (
            <>
              <Link className="btn btn-secondary px-3 py-1.5 text-xs" href="/login">
                Login
              </Link>
              <Link className="btn btn-primary px-3 py-1.5 text-xs" href="/register">
                Register
              </Link>
            </>
          ) : (
            <>
              <Link className="btn btn-secondary px-3 py-1.5 text-xs" href="/dashboard">
                Dashboard
              </Link>
              {role !== "admin" && (
                <Link className="btn btn-secondary px-3 py-1.5 text-xs" href="/profile">
                  Profile
                </Link>
              )}
              {role === "admin" && (
                <>
                  <Link className="btn btn-secondary px-3 py-1.5 text-xs" href="/admin-ui">
                    Admin UI
                  </Link>
                  <Link className="btn btn-secondary px-3 py-1.5 text-xs" href="/admin-students">
                    Students
                  </Link>
                </>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="btn btn-secondary cursor-pointer px-3 py-1.5 text-xs"
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
