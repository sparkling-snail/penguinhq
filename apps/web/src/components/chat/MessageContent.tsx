/**
 * Renders an agent/human chat message's content with a small, hand-rolled
 * formatter rather than a full markdown library — agents only ever emit
 * a narrow, predictable set of constructs (```code fences```, **bold**,
 * bare URLs, and line breaks), so parsing exactly those keeps this
 * dependency-free and easy to reason about, instead of pulling in
 * react-markdown for four rules.
 *
 * Without this, multi-line agent output (job listings, tech briefs,
 * leetcode solutions) rendered as one squished line of literal asterisks
 * and backticks — plain <p> tags collapse newlines, and nothing parsed
 * the markdown syntax agents already emit.
 */

import type { ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s]+)/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Combined pass: split on URLs first, then bold within each segment —
  // simplest way to handle both without a real tokenizer for two rules.
  const urlSplit: Array<{ text: string; isUrl: boolean }> = [];
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) urlSplit.push({ text: text.slice(lastIndex, match.index), isUrl: false });
    urlSplit.push({ text: match[0], isUrl: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) urlSplit.push({ text: text.slice(lastIndex), isUrl: false });

  urlSplit.forEach((segment, segIdx) => {
    if (segment.isUrl) {
      nodes.push(
        <a
          key={`${keyPrefix}-url-${segIdx}`}
          href={segment.text}
          target="_blank"
          rel="noopener noreferrer"
          className="text-penguin-accent underline decoration-penguin-accent/40 underline-offset-2 hover:decoration-penguin-accent"
        >
          {segment.text}
        </a>
      );
      return;
    }

    // Bold within this plain-text segment
    let boldLast = 0;
    let boldMatch: RegExpExecArray | null;
    BOLD_RE.lastIndex = 0;
    let pieceIdx = 0;
    while ((boldMatch = BOLD_RE.exec(segment.text)) !== null) {
      if (boldMatch.index > boldLast) {
        nodes.push(segment.text.slice(boldLast, boldMatch.index));
      }
      nodes.push(
        <strong key={`${keyPrefix}-b-${segIdx}-${pieceIdx++}`} className="font-semibold text-slate-100">
          {boldMatch[1]}
        </strong>
      );
      boldLast = boldMatch.index + boldMatch[0].length;
    }
    if (boldLast < segment.text.length) {
      nodes.push(segment.text.slice(boldLast));
    }
  });

  return nodes;
}

export function MessageContent({ content }: { content: string }) {
  // Split out ```fenced code blocks``` first — everything else is line-
  // by-line inline formatting. Agents occasionally emit malformed nested
  // bold (e.g. wrapping an already-bold string in ** again) — collapsing
  // runs of 3+ asterisks to a clean pair keeps that from leaving stray
  // literal asterisks in the rendered output.
  const normalized = content.replace(/\*{3,}/g, "**");
  const parts = normalized.split(/```(\w*\n[\s\S]*?)```/g);

  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-300">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          // Odd indices are code-fence contents (regex capture group)
          const firstNewline = part.indexOf("\n");
          const code = firstNewline >= 0 ? part.slice(firstNewline + 1) : part;
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg border border-penguin-border bg-black/30 p-3 font-mono text-xs text-slate-200"
            >
              <code>{code.replace(/\n$/, "")}</code>
            </pre>
          );
        }

        if (!part) return null;

        return part.split("\n").map((line, lineIdx) =>
          line ? (
            <p key={`${i}-${lineIdx}`} className="break-words">
              {renderInline(line, `${i}-${lineIdx}`)}
            </p>
          ) : (
            <div key={`${i}-${lineIdx}`} className="h-1.5" />
          )
        );
      })}
    </div>
  );
}
