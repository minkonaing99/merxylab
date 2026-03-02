"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearTokens } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";
import { apiFetch } from "@/lib/api";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getTheme, setTheme, subscribeThemeChange } from "@/lib/theme";

export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAccessToken();
  const clientTheme = useSyncExternalStore(subscribeThemeChange, getTheme, () => "light");
  const [role, setRole] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== "undefined" ? Boolean(document.fullscreenElement) : false,
  );
  const showAuthedNav = role !== null;
  const logoSrc = clientTheme === "dark" ? "/merxylab-logo-dark.png" : "/merxylab-logo-light.png";
  const desktopActionClass = "btn px-3 py-1.5 text-xs sm:w-auto sm:text-sm";
  const mobileActionClass = "btn w-full justify-start px-3 py-2 text-sm";

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    apiFetch<{ role?: string }>("/me/", {}, accessToken)
      .then((me) => {
        const nextRole = me.role ?? "student";
        setRole(nextRole);
        if (nextRole === "admin") {
          setTheme("light");
        }
      })
      .catch(() => setRole("student"));
  }, [accessToken]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const handleLogout = () => {
    clearTokens();
    setRole(null);
    setMobileOpen(false);
    router.push("/");
  };

  const renderThemeToggle = (actionClass: string, onAction?: () => void) => (
    <button
      type="button"
      onClick={() => {
        setTheme(clientTheme === "dark" ? "light" : "dark");
        onAction?.();
      }}
      className={`${actionClass} btn-secondary`}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
    >
      <Image src="/theme.svg" alt="" width={16} height={16} aria-hidden="true" className="theme-icon h-4 w-4" />
      <span className="sr-only">Toggle dark mode</span>
    </button>
  );

  const renderActions = (actionClass: string, onAction?: () => void) => {
    if (isFullscreen) {
      return role === "admin" ? null : renderThemeToggle(actionClass, onAction);
    }

    if (pathname === "/") {
      return (
        <Link className={`${actionClass} btn-primary`} href="/register" onClick={onAction}>
          Start Learning
        </Link>
      );
    }

    if (pathname === "/login" && !showAuthedNav) {
      return (
        <>
          {renderThemeToggle(actionClass, onAction)}
          <Link className={`${actionClass} btn-secondary`} href="/" onClick={onAction}>
            Home
          </Link>
          <Link className={`${actionClass} btn-primary`} href="/register" onClick={onAction}>
            Start Learning
          </Link>
        </>
      );
    }

    if (pathname === "/register" && !showAuthedNav) {
      return (
        <>
          {renderThemeToggle(actionClass, onAction)}
          <Link className={`${actionClass} btn-secondary`} href="/" onClick={onAction}>
            Home
          </Link>
          <Link className={`${actionClass} btn-primary`} href="/login" onClick={onAction}>
            Login
          </Link>
        </>
      );
    }

    if (!showAuthedNav) {
      return (
        <>
          {renderThemeToggle(actionClass, onAction)}
          <Link className={`${actionClass} btn-secondary`} href="/login" onClick={onAction}>
            Login
          </Link>
          <Link className={`${actionClass} btn-primary`} href="/register" onClick={onAction}>
            Start Learning
          </Link>
        </>
      );
    }

    return (
      <>
        {role !== "admin" && renderThemeToggle(actionClass, onAction)}
        {role === "admin" && (
          <>
            <Link className={`${actionClass} btn-primary`} href="/admin-ui" onClick={onAction}>
              Admin
            </Link>
            <Link className={`${actionClass} btn-secondary`} href="/admin-schedule" onClick={onAction}>
              Schedule
            </Link>
            <Link className={`${actionClass} btn-secondary`} href="/admin-students" onClick={onAction}>
              Students
            </Link>
          </>
        )}
        {role !== "admin" && (
          <>
            <Link className={`${actionClass} btn-primary`} href="/dashboard" onClick={onAction}>
              Dashboard
            </Link>
            <Link className={`${actionClass} btn-secondary`} href="/profile" onClick={onAction}>
              Profile
            </Link>
          </>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className={`${actionClass} btn-secondary cursor-pointer`}
        >
          Logout
        </button>
      </>
    );
  };

  return (
    <header className="sticky top-0 z-20 border-b backdrop-blur-md" style={{ background: "color-mix(in srgb, var(--surface) 86%, transparent)" }}>
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link
          href={showAuthedNav && role === "admin" ? "/admin-ui" : showAuthedNav ? "/dashboard" : "/"}
          className="inline-flex items-center"
          aria-label="MerxyLab Home"
        >
          <Image
            src={logoSrc}
            alt="MerxyLab Online Learning"
            width={242}
            height={70}
            priority
            className="h-8 w-auto sm:h-10"
          />
        </Link>
        <div className="hidden items-center gap-2 text-sm sm:ml-auto sm:flex sm:flex-wrap sm:justify-end">
          {renderActions(desktopActionClass)}
        </div>
        <div className="sm:hidden">
          {isFullscreen && role !== "admin" ? (
            renderThemeToggle("btn btn-secondary px-3 py-1.5 text-xs")
          ) : (
          <button
            type="button"
            className="btn btn-secondary px-3 py-1.5 text-xs"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-menu"
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            {mobileOpen ? "Close" : "Menu"}
          </button>
          )}
        </div>
      </nav>
      {mobileOpen && !isFullscreen && (
        <div id="mobile-nav-menu" className="mx-auto w-full max-w-6xl border-t px-4 pb-3 sm:hidden">
          <div className="grid gap-2 pt-3">
            {renderActions(mobileActionClass, () => setMobileOpen(false))}
          </div>
        </div>
      )}
    </header>
  );
}

