"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function OpenSourceCta() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="container mx-auto max-w-4xl">
        <motion.div
          className="rounded-2xl border border-border/50 bg-card/80 p-8 text-center shadow-xl sm:p-12"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          whileHover={{ y: -2, transition: { duration: 0.2 } }}
        >
          <h2
            className="text-2xl font-medium tracking-tight sm:text-3xl"
            style={{ fontFamily: "var(--font-instrument-serif), serif" }}
          >
            Ready to get started?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Join teams who already use Knowrix to turn their docs into answers.
            No setup, no credit card — just connect your sources and start
            asking.
          </p>
          <div className="mt-8">
            <Button asChild size="lg" className="rounded-lg px-8">
              <Link href="/signup" className="inline-flex items-center gap-2">
                <motion.span
                  className="inline-flex items-center gap-2"
                  whileHover={{ x: 2 }}
                  transition={{ duration: 0.2 }}
                >
                  Start free
                  <ArrowRight className="size-4" />
                </motion.span>
              </Link>
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
