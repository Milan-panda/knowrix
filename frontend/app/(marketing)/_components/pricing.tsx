"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";

const included = [
  "Unlimited workspaces",
  "All supported sources (PDF, Notion, web, and more)",
  "Chat with cited answers",
  "Team roles and invites",
  "Full access to every feature",
];

const listContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.15 },
  },
};

const listItem = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0 },
};

export function Pricing() {
  return (
    <section
      id="pricing"
      className="scroll-mt-20 border-t border-border/40 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="container mx-auto max-w-3xl">
        <motion.div
          className="rounded-2xl border border-border/50 bg-card/50 p-8 text-center sm:p-12"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          whileHover={{ transition: { duration: 0.2 } }}
        >
          <motion.div
            className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/10 px-4 py-1.5 text-sm font-medium text-[var(--accent-cyan)]"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Sparkles className="size-4" />
            Pricing coming soon
          </motion.div>
          <h2
            className="mt-4 text-2xl font-medium tracking-tight sm:text-3xl"
            style={{ fontFamily: "var(--font-instrument-serif), serif" }}
          >
            Use Knowrix free while we launch
          </h2>
          <p className="mt-2 text-muted-foreground">
            No credit card, no time limit. Try everything — we'll give you a
            heads-up before any pricing changes.
          </p>
          <motion.ul
            className="mt-8 space-y-3 text-left sm:mx-auto sm:max-w-sm"
            variants={listContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-20px" }}
          >
            {included.map((item) => (
              <motion.li
                key={item}
                className="flex items-center gap-2 text-sm text-muted-foreground"
                variants={listItem}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <Check className="size-4 shrink-0 text-[var(--accent-cyan)]" />
                {item}
              </motion.li>
            ))}
          </motion.ul>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button asChild size="lg" className="mt-8 rounded-lg px-8">
              <Link href="/signup">Get started free</Link>
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
