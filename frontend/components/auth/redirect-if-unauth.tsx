"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/**
 * When auth has finished loading and there is no user (e.g. 401), redirect to sign-in
 * so the user is not stuck on dashboard or workspace with "create workspace" modal.
 */
export function RedirectIfUnauth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isAuthPage =
    pathname?.startsWith("/signin") || pathname?.startsWith("/signup");
  const shouldRedirect = !loading && !user && !isAuthPage;

  useEffect(() => {
    if (!shouldRedirect) return;
    router.replace("/signin");
  }, [shouldRedirect, router]);

  if (shouldRedirect) {
    return null;
  }

  return <>{children}</>;
}
