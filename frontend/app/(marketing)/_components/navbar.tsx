"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#pricing", label: "Pricing" },
];

export function Navbar() {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b border-border/40 transition-all duration-300",
        "bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
      )}
    >
      <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="font-display text-xl font-medium tracking-tight text-foreground hover:text-foreground/90"
          style={{ fontFamily: "var(--font-instrument-serif), serif" }}
        >
          Knowrix
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          {isLanding ? (
            <>
              <Button asChild size="sm" variant="ghost" className="rounded-lg">
                <Link href="/signin">Login</Link>
              </Button>
              <Button asChild size="sm" className="rounded-lg">
                <Link href="/signup">Get Started</Link>
              </Button>
            </>
          ) : (
            <Button asChild size="sm" variant="outline" className="rounded-lg">
              <Link href="/signin">Sign In</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
