"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Link2, Cpu, MessageSquare } from "lucide-react";

const steps = [
  {
    step: 1,
    title: "Connect",
    description: "Add your sources — PDFs, repos, Notion pages, URLs",
    icon: Link2,
  },
  {
    step: 2,
    title: "Ingest",
    description: "We read, organize, and index your content automatically",
    icon: Cpu,
  },
  {
    step: 3,
    title: "Chat",
    description: "Ask anything and get answers with sources you can click and verify",
    icon: MessageSquare,
  },
];

const container = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const stepItem = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
};

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px 0px -60px 0px" });

  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 border-t border-border/40 bg-muted/20 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="container mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            className="text-3xl font-medium tracking-tight sm:text-4xl"
            style={{ fontFamily: "var(--font-instrument-serif), serif" }}
          >
            How It Works
          </h2>
          <p className="mt-4 text-muted-foreground">
            Three steps from scattered docs to answers you can trust.
          </p>
        </div>

        <motion.div
          ref={ref}
          className="mt-16 flex flex-col items-center gap-10 sm:mt-20 sm:flex-row sm:items-start sm:justify-center sm:gap-0"
          variants={container}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
        >
          {steps.map(({ step, title, description, icon: Icon }, index) => (
            <motion.div
              key={step}
              className="flex flex-1 basis-0 items-center sm:flex-row"
              variants={stepItem}
            >
              <div className="flex flex-col items-center sm:min-w-0 sm:flex-1">
                <motion.div
                  className="flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-[var(--accent-cyan)]/60 bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]"
                  whileHover={{
                    scale: 1.08,
                    transition: { duration: 0.2 },
                  }}
                  whileTap={{ scale: 0.96 }}
                >
                  <Icon className="size-7" aria-hidden />
                </motion.div>
                <div className="mt-4 text-center">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Step {step}
                  </span>
                  <h3 className="mt-1 text-lg font-semibold text-foreground">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {description}
                  </p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div
                  className="hidden shrink-0 items-center self-start pt-7 sm:flex"
                  style={{ width: "clamp(24px, 8vw, 64px)" }}
                  aria-hidden
                >
                  <div className="h-0.5 w-full rounded-full bg-[var(--accent-cyan)]/50" />
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
