"use client";

import { useEffect } from "react";

const STORAGE_KEY = "knowrix_landing_ping";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export function LandingVisitBeacon() {
  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(STORAGE_KEY)) return;
    sessionStorage.setItem(STORAGE_KEY, "1");

    void fetch(`${BACKEND_URL}/api/v1/analytics/landing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
  }, []);

  return null;
}
