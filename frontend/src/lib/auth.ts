const ACCESS_TOKEN_KEY = "merxylab_access_token";
const REFRESH_TOKEN_KEY = "merxylab_refresh_token";
const DEVICE_ID_KEY = "merxylab_device_id";
const AUTH_EVENT = "merxylab-auth-change";

function notifyAuthChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function saveTokens(access: string, refresh: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ACCESS_TOKEN_KEY, access);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  notifyAuthChanged();
}

export function clearTokens() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  notifyAuthChanged();
}

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") {
    return "server-device";
  }

  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `device-${Date.now()}`;
  window.localStorage.setItem(DEVICE_ID_KEY, value);
  return value;
}

export function subscribeAuthChange(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => callback();
  window.addEventListener("storage", handler);
  window.addEventListener(AUTH_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(AUTH_EVENT, handler);
  };
}
