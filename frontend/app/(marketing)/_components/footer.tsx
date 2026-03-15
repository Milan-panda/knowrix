import Link from "next/link";
import { Github, Linkedin } from "lucide-react";
import { GhostText } from "./ghost-text";

const footerLinks = [
  { href: "#", label: "Documentation" },
  { href: "#", label: "Privacy" },
  { href: "#", label: "Terms" },
];

const CREATOR_LINKS = [
  { href: "https://github.com/Milan-panda/", label: "GitHub", icon: Github },
  { href: "https://www.linkedin.com/in/milanpanda/", label: "LinkedIn", icon: Linkedin },
];

type FooterProps = {
  /** Optional ghost/watermark text at the very bottom (e.g. "Knowrix", "DevSt") */
  ghostText?: string;
};

export function Footer({ ghostText = "Knowrix" }: FooterProps) {
  return (
    <footer
      className="relative overflow-hidden border-t border-border/40"
      style={{
        background: "linear-gradient(to bottom, #18181b 0%, #0f0f10 30%, #0a0a0a 60%, #000 100%)",
      }}
    >
      {/* Main footer content */}
      <div className="relative z-10 px-4 pt-10 pb-8 sm:px-6 lg:px-8">
        <div className="container mx-auto max-w-6xl">
          <nav className="flex flex-wrap items-center justify-center gap-6">
            {footerLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-muted-foreground">
            <span>Made by Milan Panda</span>
            {CREATOR_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                aria-label={item.label}
              >
                <item.icon className="size-3.5" />
              </a>
            ))}
          </p>
        </div>
      </div>

      {/* Ghost text at bottom — same gradient continues, no hard edge */}
      {ghostText ? (
        <div className="relative z-0 flex min-h-[11rem] items-end justify-center pt-2 pb-4">
          <GhostText text={ghostText} className="text-center" />
        </div>
      ) : null}
    </footer>
  );
}
