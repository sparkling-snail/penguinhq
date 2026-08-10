"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getPenguinSocket } from "@/lib/websocket";
import { useChatStore } from "@/stores/chatStore";
import type { ChatMessage } from "@/types/chat";

const STARTER_CODE = `def solve(nums: list[int]) -> int:
    # Describe your approach, then implement it here.
    pass
`;

interface LeetcodePracticeDeskProps {
  onClose: () => void;
}

export function LeetcodePracticeDesk({ onClose }: LeetcodePracticeDeskProps) {
  const [title, setTitle] = useState("Today's practice");
  const [code, setCode] = useState(STARTER_CODE);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading your saved practice…");
  const setActiveChannel = useChatStore((state) => state.setActiveChannel);

  useEffect(() => {
    let cancelled = false;
    void api.getActivePracticeSession().then((session) => {
      if (cancelled) return;
      const legacyDraft = window.localStorage.getItem("penguinhq.leetcode-draft");
      if (session) {
        setSessionId(session.id);
        setTitle(session.title);
        setCode(session.draftCode || legacyDraft || STARTER_CODE);
        setStatus("Loaded your saved practice.");
      } else if (legacyDraft) {
        setCode(legacyDraft);
        setStatus("Imported your previous local draft. Saving it to your learning history…");
      } else {
        setStatus("New practice session. Your work saves automatically.");
      }
      setReady(true);
    }).catch(() => {
      if (!cancelled) {
        setStatus("Couldn’t reach persistent storage. Your browser draft is still safe.");
        setReady(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const saveDraft = async (): Promise<string | null> => {
    window.localStorage.setItem("penguinhq.leetcode-draft", code);
    try {
      if (sessionId) {
        await api.savePracticeDraft(sessionId, { title, draft_code: code });
        setStatus("Draft saved to your learning history.");
        return sessionId;
      }
      const session = await api.createPracticeSession({ title, draft_code: code, language: "python" });
      setSessionId(session.id);
      setStatus("Practice session saved to your learning history.");
      return session.id;
    } catch {
      setStatus("Couldn’t save to PenguinHQ yet. Your browser draft is still safe.");
      return null;
    }
  };

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => { void saveDraft(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [code, title, ready]); // saveDraft intentionally snapshots the current editor state

  const askCoach = async (request: string) => {
    const savedSessionId = await saveDraft();
    if (!savedSessionId) return;
    try {
      const attempt = await api.createPracticeAttempt(savedSessionId, { source_code: code, language: "python" });
      setActiveChannel("leetcode");
      getPenguinSocket().send("chat.message", {
        id: crypto.randomUUID(),
        channel: "leetcode",
        authorId: "human",
        authorName: "You",
        authorColor: "#38bdf8",
        content: `@leetcode_coach ${request}\n[practice_attempt:${attempt.id}]\n\nProblem: ${title}\n\nMy current Python attempt:\n\`\`\`python\n${code}\n\`\`\``,
        createdAt: new Date().toISOString(),
      } satisfies ChatMessage);
      setStatus("Attempt saved. Leetcode Coach will add their feedback to this record.");
    } catch {
      setStatus("Couldn’t create a review snapshot. Your draft is still saved.");
    }
  };

  return (
    <section className="glass-panel flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-penguin-border px-5 py-3">
        <div>
          <p className="text-sm font-semibold text-violet-200">Leetcode practice desk</p>
          <p className="mt-0.5 text-xs text-slate-400">Write the solution. Ask the coach for a hint or review when you are ready.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-penguin-border px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">
          Back to office
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Problem title"
          className="rounded-md border border-penguin-border bg-slate-950/50 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
        />
        <textarea
          value={code}
          onChange={(event) => setCode(event.target.value)}
          spellCheck={false}
          aria-label="Python solution editor"
          className="min-h-0 flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 p-4 font-mono text-sm leading-6 text-sky-100 outline-none focus:border-violet-400"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void saveDraft()} className="rounded-md border border-penguin-border px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5">Save draft</button>
          <button type="button" onClick={() => void askCoach("Give me one hint only; do not reveal the solution.")} className="rounded-md bg-violet-500/20 px-3 py-2 text-xs font-medium text-violet-200 hover:bg-violet-500/30">Ask for a hint</button>
          <button type="button" onClick={() => void askCoach("Review my attempt for correctness, complexity, and edge cases. Do not provide a replacement solution.")} className="rounded-md bg-penguin-accent px-3 py-2 text-xs font-semibold text-slate-950 hover:opacity-90">Request review</button>
          <span className="text-xs text-slate-500">{status}</span>
        </div>
      </div>
    </section>
  );
}
