"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { MessageSquare, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const headline = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1 + 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  }),
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

const stagger = {
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.2 },
  },
};

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <div className="grain-overlay" aria-hidden />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,oklch(0.75_0.18_195_/_.15),transparent)]" />
      <div className="container relative mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <h1
            className={cn(
              "text-4xl font-medium tracking-tight sm:text-5xl md:text-6xl lg:text-7xl",
              "text-foreground"
            )}
            style={{ fontFamily: "var(--font-instrument-serif), serif" }}
          >
            <motion.span
              custom={0}
              initial="hidden"
              animate="visible"
              variants={headline}
              className="block"
            >
              Your Knowledge.
            </motion.span>
            <motion.span
              custom={1}
              initial="hidden"
              animate="visible"
              variants={headline}
              className="block text-[var(--accent-cyan)]"
            >
              One Chat Away.
            </motion.span>
          </h1>
          <motion.p
            className="mt-6 text-lg text-muted-foreground sm:text-xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            Connect your PDFs, docs, Notion, and more in one place. Ask
            questions and get answers that cite the source — so you can trust
            every detail.
          </motion.p>
          <motion.div
            className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.div variants={fadeUp}>
              <Button asChild size="lg" className="rounded-lg px-8 text-base">
                <Link href="/signup" className="flex items-center gap-2">
                  <motion.span
                    className="inline-flex items-center gap-2"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Get started free
                    <MessageSquare className="size-4" />
                  </motion.span>
                </Link>
              </Button>
            </motion.div>
            <motion.div variants={fadeUp}>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-lg px-8 text-base"
              >
                <a href="#features" className="flex items-center gap-2">
                  <motion.span
                    className="inline-flex items-center gap-2"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    See features
                    <Play className="size-4" />
                  </motion.span>
                </a>
              </Button>
            </motion.div>
          </motion.div>
        </div>
        {/* Hero visual: animated mockup */}
        <motion.div
          className="relative mx-auto mt-16 max-w-4xl"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.div
            className="animate-float-subtle rounded-xl border border-border/50 bg-card/50 p-2 shadow-2xl shadow-black/20 backdrop-blur sm:p-3"
            whileHover={{ scale: 1.01, transition: { duration: 0.2 } }}
          >
            <div className="rounded-lg bg-muted/30 p-4 font-mono text-sm">
              <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                <span className="size-2 rounded-full bg-red-500/80" />
                <span className="size-2 rounded-full bg-yellow-500/80" />
                <span className="size-2 rounded-full bg-green-500/80" />
                <span className="ml-2 text-muted-foreground">
                  Knowrix — Chat
                </span>
              </div>
              <div className="mt-3 space-y-3">
                <p className="text-muted-foreground">
                  &gt; What does the API rate limit section say?
                </p>
                <p className="text-foreground">
                  According to{" "}
                  <span className="rounded bg-[var(--accent-cyan)]/20 px-1 text-[var(--accent-cyan)]">
                    docs/api.md (lines 42–58)
                  </span>
                  , the rate limit is 100 requests per minute per key…
                </p>
              </div>
            </div>
          </motion.div>
          <motion.div
            className="absolute -inset-4 -z-10 rounded-2xl bg-[var(--accent-cyan)]/10 blur-2xl animate-glow-pulse"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9, duration: 0.5 }}
          />
        </motion.div>
      </div>
    </section>
  );
}
