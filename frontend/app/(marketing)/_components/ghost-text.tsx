import { cn } from "@/lib/utils";

type GhostTextProps = {
  /** Text to render with vertical shade (gradient top to bottom) */
  text: string;
  className?: string;
};

export function GhostText({ text, className }: GhostTextProps) {
  return (
    <span
      className={cn("select-none pointer-events-none block", className)}
      style={{
        fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontWeight: 700,
        fontSize: "clamp(4rem, 18vw, 11rem)",
        lineHeight: 0.85,
        letterSpacing: "-0.04em",
        background: "linear-gradient(to bottom, #383838 0%, #252525 40%, #141414 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }}
      aria-hidden
    >
      {text}
    </span>
  );
}
