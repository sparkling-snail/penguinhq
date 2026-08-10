import type { Agent } from "@/types/agent";
import type { Task } from "@/types/task";

export interface PracticeSession {
  id: string;
  title: string;
  problemStatement: string | null;
  language: string;
  status: string;
  draftCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeAttempt {
  id: string;
  sessionId: string;
  sourceCode: string;
  language: string;
  createdAt: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Minimal fetch wrapper. React Query (wired in `hooks/`) is the caller in
 * every real component — this file stays a dumb HTTP client with no
 * caching/retry logic of its own so those concerns live in exactly one
 * place (React Query's config).
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listAgents: () => apiFetch<Agent[]>("/agents"),
  listTasks: () => apiFetch<Task[]>("/tasks?limit=50"),
  health: () => apiFetch<{ status: string }>("/health"),
  getActivePracticeSession: () => apiFetch<PracticeSession | null>("/practice/sessions/active"),
  createPracticeSession: (body: { title: string; draft_code: string; language: string }) =>
    apiFetch<PracticeSession>("/practice/sessions", { method: "POST", body: JSON.stringify(body) }),
  savePracticeDraft: (sessionId: string, body: { title: string; draft_code: string }) =>
    apiFetch<PracticeSession>(`/practice/sessions/${sessionId}/draft`, { method: "PATCH", body: JSON.stringify(body) }),
  createPracticeAttempt: (sessionId: string, body: { source_code: string; language: string }) =>
    apiFetch<PracticeAttempt>(`/practice/sessions/${sessionId}/attempts`, { method: "POST", body: JSON.stringify(body) }),
};
