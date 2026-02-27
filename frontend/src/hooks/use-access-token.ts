"use client";

import { useSyncExternalStore } from "react";
import { getAccessToken, subscribeAuthChange } from "@/lib/auth";

export function useAccessToken() {
  return useSyncExternalStore(subscribeAuthChange, getAccessToken, () => null);
}
