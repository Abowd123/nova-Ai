"use client";

import { Children, isValidElement, memo, useMemo, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { repairIncompleteMarkdown, splitMarkdownBlocks } from "./incomplete";
import { markdownSanitizeSchema } from "./sanitize-schema";
import { urlTransform } from "./safe-url";

const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: true }]] as const;

const rehypePlugins = [
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: "ignore", trust: false, maxSize: 20, maxExpand: 500, output: "htmlAndMathml" }],
  [rehypeHighlight, { detect: false }],
] as const;

function languageOf(children: ReactNode): string | null {
  const child = Children.toArray(children)[0];
  if (!isValidElement(child)) return null;
  const className = (child as ReactElement<{ className?: string }>).props.className ?? "";
  const match = className.match(/language-([\w+#.-]+)/);
  return match?.[1] ?? null;
}

const components: Components = {
  pre: ({ children }) => {
    const child = Children.toArray(children)[0];
    const inner = isValidElement(child) ? (child as ReactElement<{ children?: ReactNode }>).props.children : children;
    return <CodeBlock language={languageOf(children)}>{inner}</CodeBlock>;
  },
  code: ({ className, children }) => (
    <code className={cn(className, !className?.includes("hljs") && "rounded-md bg-surface-container-high px-1.5 py-0.5 font-mono text-[0.85em]")} dir="ltr">
      {children}
    </code>
  ),
  a: ({ href, children }) =>
    href ? (
      <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer nofollow ugc" className="font-medium text-primary underline underline-offset-4">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="my-2 max-h-96 max-w-full rounded-2xl border" />
    ) : null,
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-2xl border" role="region" tabIndex={0} aria-label="table">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border-b bg-surface-container px-3 py-2 text-start font-semibold">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b px-3 py-2 align-top">
      {children}
    </td>
  ),
};

const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins as never}
      rehypePlugins={rehypePlugins as never}
      components={components}
      urlTransform={urlTransform as never}
      skipHtml
    >
      {source}
    </ReactMarkdown>
  );
});

interface MarkdownProps {
  content: string;
  /** Streaming: repair partial syntax and re-parse only the last block. */
  streaming?: boolean;
  className?: string;
}

export const Markdown = memo(function Markdown({ content, streaming = false, className }: MarkdownProps) {
  const blocks = useMemo(() => {
    if (!streaming) return [content];
    const parts = splitMarkdownBlocks(content);
    const last = parts.length - 1;
    return parts.map((block, index) => (index === last ? repairIncompleteMarkdown(block) : block));
  }, [content, streaming]);

  return (
    <div className={cn("nova-markdown", className)} dir="auto" data-testid="markdown">
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} source={block} />
      ))}
    </div>
  );
});
