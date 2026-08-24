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
const JOB_CARD_RE = /:::job-card\n([\s\S]*?)\n:::/g;

interface JobCardData {
  title: string;
  company: string;
  location: string;
  salary?: string | null;
  postedDate?: string | null;
  skills?: string[];
  url?: string;
}

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

function JobCard({ job }: { job: JobCardData }) {
  const safeUrl = job.url?.startsWith("https://") || job.url?.startsWith("http://") ? job.url : null;
  return (
    <article className="rounded-lg border border-penguin-border bg-slate-950/45 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-100">{job.title}</h3>
          <p className="truncate text-xs font-medium text-penguin-accent">{job.company}</p>
        </div>
        {safeUrl && (
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md bg-penguin-accent px-2.5 py-1 text-xs font-semibold text-slate-950 hover:opacity-90"
          >
            View
          </a>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
        <span>📍 {job.location}</span>
        {job.postedDate && <span>🕒 {job.postedDate}</span>}
        {job.salary && <span>💰 {job.salary}</span>}
      </div>
      {!!job.skills?.length && (
        <div className="mt-2 flex flex-wrap gap-1">
          {job.skills.map((skill) => (
            <span key={skill} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
              {skill}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function renderText(content: string, keyPrefix: string): ReactNode {
  const parts = content.split(/```(\w*\n[\s\S]*?)```/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const firstNewline = part.indexOf("\n");
      const code = firstNewline >= 0 ? part.slice(firstNewline + 1) : part;
      return (
        <pre key={`${keyPrefix}-code-${i}`} className="overflow-x-auto rounded-lg border border-penguin-border bg-black/30 p-3 font-mono text-xs text-slate-200">
          <code>{code.replace(/\n$/, "")}</code>
        </pre>
      );
    }
    if (!part) return null;
    return part.split("\n").map((line, lineIdx) =>
      line ? (
        <p key={`${keyPrefix}-${i}-${lineIdx}`} className="break-words">
          {renderInline(line, `${keyPrefix}-${i}-${lineIdx}`)}
        </p>
      ) : (
        <div key={`${keyPrefix}-${i}-${lineIdx}`} className="h-1.5" />
      )
    );
  });
}

export function MessageContent({ content }: { content: string }) {
  // Split out ```fenced code blocks``` first — everything else is line-
  // by-line inline formatting. Agents occasionally emit malformed nested
  // bold (e.g. wrapping an already-bold string in ** again) — collapsing
  // runs of 3+ asterisks to a clean pair keeps that from leaving stray
  // literal asterisks in the rendered output.
  const normalized = content.replace(/\*{3,}/g, "**");
  const blocks: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  JOB_CARD_RE.lastIndex = 0;
  while ((match = JOB_CARD_RE.exec(normalized)) !== null) {
    if (match.index > cursor) blocks.push(renderText(normalized.slice(cursor, match.index), `text-${cursor}`));
    try {
      const job = JSON.parse(match[1]!) as JobCardData;
      blocks.push(<JobCard key={`job-${match.index}`} job={job} />);
    } catch {
      blocks.push(renderText(match[0], `invalid-job-${match.index}`));
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < normalized.length) blocks.push(renderText(normalized.slice(cursor), `text-${cursor}`));

  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-300">
      {blocks.length ? blocks : renderText(normalized, "plain")}
    </div>
  );
}
