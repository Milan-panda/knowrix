"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FileStack,
  MessageSquareQuote,
  FolderGit2,
  Search,
  Server,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const features: {
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    title: "All your sources in one place",
    description:
      "PDFs, docs, Notion, YouTube, web pages, and more — connected in a single workspace so you never hunt for the right file again.",
    icon: FileStack,
  },
  {
    title: "Answers you can verify",
    description:
      "Every answer points back to the source. Click through to the exact file, page, or link. No more guessing where it came from.",
    icon: MessageSquareQuote,
  },
  {
    title: "Workspaces for every project",
    description:
      "Separate spaces for each team or project. Keep work organized and relevant so the right people see the right knowledge.",
    icon: FolderGit2,
  },
  {
    title: "Smart search under the hood",
    description:
      "We find the best matches across your content so you get relevant answers fast, without digging through folders.",
    icon: Search,
  },
  {
    title: "Secure and reliable",
    description:
      "Your data stays yours. We're built to keep your knowledge safe and available when you need it.",
    icon: Server,
  },
  {
    title: "Collaborate with your team",
    description:
      "Invite teammates, set roles, and build shared knowledge bases so everyone stays on the same page.",
    icon: Users,
  },
];

const container = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

export function FeaturesGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px 0px -60px 0px" });

  return (
    <section id="features" className="scroll-mt-20 px-4 py-20 sm:px-6 lg:px-8">
      <div className="container mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            className="text-3xl font-medium tracking-tight sm:text-4xl"
            style={{ fontFamily: "var(--font-instrument-serif), serif" }}
          >
            Built for how you work
          </h2>
          <p className="mt-4 text-muted-foreground">
            Everything you need to turn scattered docs into answers you can trust.
          </p>
        </div>
        <motion.div
          ref={ref}
          className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
          variants={container}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
        >
          {features.map(({ title, description, icon: Icon }) => (
            <motion.div key={title} variants={item}>
              <motion.div
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                whileTap={{ scale: 0.99 }}
                className="h-full"
              >
                <Card
                  className={cn(
                    "transition-colors duration-200",
                    "hover:border-[var(--accent-cyan)]/30 hover:shadow-lg hover:shadow-[var(--accent-cyan)]/5"
                  )}
                >
                  <CardHeader>
                    <motion.div
                      className="flex size-10 items-center justify-center rounded-lg bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]"
                      whileHover={{
                        scale: 1.05,
                        transition: { duration: 0.2 },
                      }}
                    >
                      <Icon className="size-5" aria-hidden />
                    </motion.div>
                    <CardTitle className="mt-2">{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                </Card>
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
