"use client";

import { useState, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown } from "lucide-react";

export interface Citation {
  index: number;
  label: string;
  url?: string;
  type: "pdf" | "file" | "github" | "web" | "notion" | "github_discussions" | "youtube";
}

interface CodeBlock {
  lang: string;
  file: string;
  lines: { n: number; text: string; hl?: boolean }[];
}

export interface Message {
  id: string;
  role: "user" | "ai";
  text: string;
  citations?: Citation[];
  code?: CodeBlock;
}

function citationIcon(type: string) {
  if (type === "pdf" || type === "file") return "📄";
  if (type === "github") return "🐙";
  if (type === "notion") return "📓";
  if (type === "github_discussions") return "💬";
  if (type === "youtube") return "▶️";
  return "🌐";
}

function CitationRef({ citation }: { citation: Citation }) {
  const icon = citationIcon(citation.type);
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
        {citation.index}
      </span>
      <span className="flex items-center gap-1 text-muted-foreground leading-5">
        <span>{icon}</span>
        <span className="truncate">{citation.label}</span>
      </span>
    </div>
  );
}

/**
 * Deduplicate citations by source name to produce a compact reference list.
 * Returns unique citations preserving the lowest index for each source.
 */
function deduplicateCitations(citations: Citation[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const c of citations) {
    const key = c.label;
    if (!seen.has(key)) seen.set(key, c);
  }
  return Array.from(seen.values());
}

/**
 * Preprocess markdown to turn [Source N] and [Source N: ...] into
 * inline superscript links that ReactMarkdown can render.
 */
function preprocessCitations(text: string): string {
  return text
    // [Source 3: path/to/file.ts] — with location label
    .replace(/\[Source\s+(\d+)\s*:[^\]]*\]/gi, (_match, n: string) => {
      return `[<sup>${n}</sup>](#cite-${n})`;
    })
    // [Sources 2, 3, 5] — plural comma-separated
    .replace(/\[Sources\s+([\d,\s]+)\]/gi, (_match, nums: string) => {
      const indices = nums.split(",").map((n: string) => n.trim()).filter(Boolean);
      return indices.map((n: string) => `[<sup>${n}</sup>](#cite-${n})`).join("");
    })
    // [Source 1] — simple single reference
    .replace(/\[Source\s+(\d+)\]/gi, (_match, n: string) => {
      return `[<sup>${n}</sup>](#cite-${n})`;
    });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded border bg-background/80 p-1 text-muted-foreground opacity-0 backdrop-blur transition-all hover:text-foreground group-hover/code:opacity-100"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function MarkdownContent({ content, citations }: { content: string; citations?: Citation[] }) {
  const processed = citations?.length ? preprocessCitations(content) : content;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        h1: ({ children, ...props }: ComponentPropsWithoutRef<"h1">) => (
          <h1 className="mb-3 mt-5 text-xl font-bold first:mt-0" {...props}>{children}</h1>
        ),
        h2: ({ children, ...props }: ComponentPropsWithoutRef<"h2">) => (
          <h2 className="mb-2 mt-4 text-lg font-semibold first:mt-0" {...props}>{children}</h2>
        ),
        h3: ({ children, ...props }: ComponentPropsWithoutRef<"h3">) => (
          <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0" {...props}>{children}</h3>
        ),
        h4: ({ children, ...props }: ComponentPropsWithoutRef<"h4">) => (
          <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0" {...props}>{children}</h4>
        ),
        p: ({ children, ...props }: ComponentPropsWithoutRef<"p">) => (
          <p className="mb-3 leading-relaxed last:mb-0" {...props}>{children}</p>
        ),
        ul: ({ children, ...props }: ComponentPropsWithoutRef<"ul">) => (
          <ul className="mb-3 ml-4 list-disc space-y-1 last:mb-0" {...props}>{children}</ul>
        ),
        ol: ({ children, ...props }: ComponentPropsWithoutRef<"ol">) => (
          <ol className="mb-3 ml-4 list-decimal space-y-1 last:mb-0" {...props}>{children}</ol>
        ),
        li: ({ children, ...props }: ComponentPropsWithoutRef<"li">) => (
          <li className="leading-relaxed" {...props}>{children}</li>
        ),
        blockquote: ({ children, ...props }: ComponentPropsWithoutRef<"blockquote">) => (
          <blockquote className="mb-3 border-l-2 border-primary/40 pl-4 italic text-muted-foreground last:mb-0" {...props}>
            {children}
          </blockquote>
        ),
        strong: ({ children, ...props }: ComponentPropsWithoutRef<"strong">) => (
          <strong className="font-semibold" {...props}>{children}</strong>
        ),
        a: ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => {
          if (href?.startsWith("#cite-")) {
            const num = href.replace("#cite-", "");
            return (
              <span className="inline-flex cursor-default items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold leading-4 text-primary align-super mx-0.5">
                {num}
              </span>
            );
          }
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80" {...props}>
              {children}
            </a>
          );
        },
        hr: (props: ComponentPropsWithoutRef<"hr">) => (
          <hr className="my-4 border-border" {...props} />
        ),
        table: ({ children, ...props }: ComponentPropsWithoutRef<"table">) => (
          <div className="mb-3 overflow-x-auto rounded-lg border last:mb-0">
            <table className="w-full text-sm" {...props}>{children}</table>
          </div>
        ),
        thead: ({ children, ...props }: ComponentPropsWithoutRef<"thead">) => (
          <thead className="border-b bg-muted/50" {...props}>{children}</thead>
        ),
        th: ({ children, ...props }: ComponentPropsWithoutRef<"th">) => (
          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground" {...props}>{children}</th>
        ),
        td: ({ children, ...props }: ComponentPropsWithoutRef<"td">) => (
          <td className="border-t px-3 py-2" {...props}>{children}</td>
        ),
        code: ({ children, className, ...props }: ComponentPropsWithoutRef<"code">) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            const lang = className?.replace("language-", "") || "";
            const codeString = String(children).replace(/\n$/, "");
            return (
              <div className="group/code relative my-3 overflow-hidden rounded-lg border bg-[#0d1117] last:mb-0">
                <div className="flex items-center border-b border-border/50 bg-muted/30 px-3 py-1.5">
                  <span className="text-[11px] font-mono text-primary/80">{lang}</span>
                  <CopyButton text={codeString} />
                </div>
                <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
                  <code className="font-mono text-[#c9d1d9]" {...props}>{children}</code>
                </pre>
              </div>
            );
          }
          return (
            <code className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-primary" {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children, ...props }: ComponentPropsWithoutRef<"pre">) => {
          return <>{children}</>;
        },
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end px-6">
        <div className="max-w-[68%] rounded-2xl rounded-br-sm border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3 px-6">
      <Avatar className="mt-0.5 h-7 w-7 shrink-0">
        <AvatarFallback className="border bg-primary/10 text-xs">
          ✦
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0 overflow-hidden text-sm">
        <MarkdownContent content={message.text} citations={message.citations} />

        {message.citations && message.citations.length > 0 && (() => {
          const unique = deduplicateCitations(message.citations!);
          return (
            <details className="mt-3 group/sources">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground select-none">
                Sources ({unique.length})
              </summary>
              <div className="mt-2 grid gap-1.5 pl-1">
                {unique.map((c) => (
                  <CitationRef key={c.index} citation={c} />
                ))}
              </div>
            </details>
          );
        })()}

        <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
            <Copy className="mr-1 h-3 w-3" /> Copy
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
            <RefreshCw className="mr-1 h-3 w-3" /> Regenerate
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
            <ThumbsUp className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
            <ThumbsDown className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
