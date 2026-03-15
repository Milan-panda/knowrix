"use client";

import { motion } from "framer-motion";
import {
  FileText,
  Github,
  Globe,
  Video,
  FileCode2,
  BookOpen,
  BookMarked,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const sources: { name: string; icon: LucideIcon }[] = [
  { name: "PDF", icon: FileText },
  { name: "GitHub", icon: Github },
  { name: "Notion", icon: BookOpen },
  { name: "YouTube", icon: Video },
  { name: "Web", icon: Globe },
  { name: "DOCX", icon: FileCode2 },
  { name: "Markdown", icon: BookMarked },
];

export function LogosBar() {
  return (
    <section className="border-y border-border/40 bg-muted/20 py-8">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6">
        <p className="mb-6 text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Works with
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 sm:gap-x-14">
          {sources.map(({ name, icon: Icon }, i) => (
            <motion.div
              key={name}
              className={cn(
                "flex items-center gap-2 text-muted-foreground/70",
                "transition-colors hover:text-muted-foreground"
              )}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-20px" }}
              transition={{ duration: 0.35, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ scale: 1.05, y: -1 }}
              whileTap={{ scale: 0.98 }}
            >
              <Icon className="size-5 sm:size-6" aria-hidden />
              <span className="text-sm font-medium sm:text-base">{name}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
