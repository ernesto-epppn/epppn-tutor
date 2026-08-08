"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect } from "react";

const PROJECTS_STORAGE_KEY = "ernesto_projects_v1";
const PENDING_FOLLOWUP_KEY = "ernesto_v144_pending_followup";
const FEEDBACK_QUEUE_KEY = "ernesto_v144_feedback_queue";

const PROJECT_COLORS = ["#6F7D3C", "#B4684D", "#26384D", "#B88A35", "#7B3E46", "#5E6A72", "#C2A56B"];

type LocalChat = {
  id?: string;
  role: "user" | "ernesto";
  text: string;
  mode?: string | null;
  rag?: { used?: number } | null;
};

type LocalProject = {
  id: string;
  title: string;
  objective?: string;
  color?: string;
  chat: LocalChat[];
  updatedAt?: number;
};

type MemoryRow = {
  project_id: string;
  title: string;
  objective?: string;
  summary?: string;
  facts?: Array<{ category?: string; fact?: string; confidence?: string }>;
  open_questions?: string[];
  turn_count?: number;
  summarized_turn_count?: number;
  updated_at?: string;
};

type PendingFollowup = {
  kind: "analyse" | "action";
  expectedMessage: string;
  answer: string;
};

function readProjects(): LocalProject[] {
  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => p?.id && typeof p?.title === "string") : [];
  } catch {
    return [];
  }
}

function writeProjects(projects: LocalProject[]) {
  try {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects.slice(0, 30)));
  } catch {
    // Ernesto keeps working even when storage is unavailable.
  }
}

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function activeProjectTitle() {
  return normalizeText(document.querySelector<HTMLElement>(".activeProjectTitleText")?.innerText);
}

function findActiveProject(projects = readProjects()) {
  const title = activeProjectTitle();
  if (title) {
    const exact = projects.find((project) => normalizeText(project.title) === title);
    if (exact) return exact;
  }
  return projects[0] || null;
}

function projectColorFor(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) sum += id.charCodeAt(i);
  return PROJECT_COLORS[sum % PROJECT_COLORS.length];
}

function mergeRemoteProjects(memories: MemoryRow[], userId: string) {
  const local = readProjects();
  const ids = new Set(local.map((project) => project.id));
  const additions = memories
    .filter((memory) => memory?.project_id && !ids.has(memory.project_id))
    .map((memory) => ({
      id: memory.project_id,
      title: memory.title || "Dossier général",
      objective: memory.objective || "",
      color: projectColorFor(memory.project_id),
      chat: [] as LocalChat[],
      updatedAt: memory.updated_at ? Date.parse(memory.updated_at) || Date.now() : Date.now(),
    }));

  if (!additions.length) return false;
  writeProjects([...additions, ...local]);

  const mergeKey = `ernesto_v144_remote_merge:${userId}`;
  if (window.sessionStorage.getItem(mergeKey) === "1") return false;
  window.sessionStorage.setItem(mergeKey, "1");
  return true;
}

function recentDossierContext(project: LocalProject | null) {
  if (!project) return "";
  const recent = Array.isArray(project.chat) ? project.chat.slice(-6) : [];
  if (!recent.length) return "";
  return recent
    .map((item) => {
      const label = item.role === "user" ? "Utilisateur" : "Ernesto";
      return `${label}: ${normalizeText(item.text).slice(0, 1100)}`;
    })
    .join("\n");
}

function durableMemoryContext(memory?: MemoryRow) {
  if (!memory) return "";
  const parts: string[] = [];
  if (memory.summary) parts.push(`Synthèse durable : ${normalizeText(memory.summary)}`);
  if (Array.isArray(memory.facts) && memory.facts.length) {
    const facts = memory.facts
      .slice(0, 10)
      .map((item) => normalizeText(item?.fact))
      .filter(Boolean)
      .map((fact) => `- ${fact}`)
      .join("\n");
    if (facts) parts.push(`Repères durables :\n${facts}`);
  }
  return parts.join("\n");
}

function readPendingFollowup(): PendingFollowup | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_FOLLOWUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.answer || !parsed?.expectedMessage) return null;
    return parsed as PendingFollowup;
  } catch {
    return null;
  }
}

function augmentContext(existing: string, memoryCache: Map<string, MemoryRow>) {
  const project = findActiveProject();
  const blocks: string[] = [];

  if (existing.trim()) blocks.push(existing.trim());

  if (project) {
    const memory = memoryCache.get(project.id);
    const recent = recentDossierContext(project);
    const durable = durableMemoryContext(memory);
    const dossierParts = [
      `Dossier actif : ${project.title}`,
      project.objective ? `Objectif du dossier : ${normalizeText(project.objective)}` : "",
      durable,
      recent ? `Échanges récents utiles :\n${recent}` : "",
    ].filter(Boolean);

    if (dossierParts.length) {
      blocks.push(
        `CONTEXTE INTERNE DU DOSSIER — utilise-le pour assurer la continuité, sans annoncer que tu consultes une mémoire :\n${dossierParts.join("\n")}`
      );
    }
  }

  const pending = readPendingFollowup();
  if (pending) {
    blocks.push(
      `SUIVI INTERNE — l'utilisateur demande ${pending.kind === "analyse" ? "d'approfondir" : "de transformer en plan d'action"} la réponse précédente. Ne recopie pas cette réponse, utilise-la comme point de départ :\n${pending.answer.slice(0, 10000)}`
    );
    window.sessionStorage.removeItem(PENDING_FOLLOWUP_KEY);
  }

  return blocks.join("\n\n");
}

function cloneAndAugmentRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  memoryCache: Map<string, MemoryRow>
) {
  if (!init?.body) return { input, init };

  if (init.body instanceof FormData) {
    const copy = new FormData();
    init.body.forEach((value, key) => copy.append(key, value));
    const existing = String(copy.get("contextText") || "");
    copy.set("contextText", augmentContext(existing, memoryCache));
    return { input, init: { ...init, body: copy } };
  }

  if (typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body);
      parsed.contextText = augmentContext(String(parsed.contextText || ""), memoryCache);
      return { input, init: { ...init, body: JSON.stringify(parsed) } };
    } catch {
      return { input, init };
    }
  }

  return { input, init };
}

function answerTextFromBlock(block: HTMLElement | null) {
  const text = block?.querySelector<HTMLElement>(".answerTextPlain")?.innerText;
  return normalizeText(text || "");
}

function setControlledTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectResponseMode(label: "Action" | "Analyse") {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".answerDepth button"));
  const target = buttons.find((button) => normalizeText(button.textContent) === label);
  target?.click();
}

function queueFollowup(kind: "analyse" | "action", answer: string) {
  if (!answer) return;
  const expectedMessage =
    kind === "analyse" ? "Approfondir cette réponse" : "Transformer cette réponse en plan d’action concret";
  const pending: PendingFollowup = { kind, expectedMessage, answer: answer.slice(0, 12000) };
  window.sessionStorage.setItem(PENDING_FOLLOWUP_KEY, JSON.stringify(pending));

  selectResponseMode(kind === "analyse" ? "Analyse" : "Action");
  const textarea = document.querySelector<HTMLTextAreaElement>(".chatTextarea");
  if (!textarea) return;
  setControlledTextareaValue(textarea, expectedMessage);
  textarea.focus();

  window.setTimeout(() => {
    const send = document.querySelector<HTMLButtonElement>(".sendBtn");
    if (send && !send.disabled) send.click();
  }, 140);
}

function findMessageMetadata(project: LocalProject | null, answer: string) {
  if (!project || !Array.isArray(project.chat)) return { question: "", mode: null as string | null, ragUsed: null as number | null };
  const normalizedAnswer = normalizeText(answer);
  const index = project.chat.findIndex(
    (item) => item.role === "ernesto" && normalizeText(item.text) === normalizedAnswer
  );
  if (index < 0) return { question: "", mode: null, ragUsed: null };
  const message = project.chat[index];
  let question = "";
  for (let i = index - 1; i >= 0; i -= 1) {
    if (project.chat[i]?.role === "user") {
      question = normalizeText(project.chat[i].text);
      break;
    }
  }
  const rawMode = normalizeText(message.mode).toUpperCase();
  const mode = rawMode === "ECOLE" || rawMode === "ANALYSE" ? "ANALYSE" : rawMode ? "ACTION" : null;
  const ragUsed = Number(message.rag?.used);
  return { question, mode, ragUsed: Number.isFinite(ragUsed) ? ragUsed : null };
}

function feedbackQueue() {
  try {
    const raw = window.localStorage.getItem(FEEDBACK_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function enqueueFeedback(payload: Record<string, unknown>) {
  try {
    const queue = feedbackQueue();
    queue.push(payload);
    window.localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(queue.slice(-50)));
  } catch {
    // Feedback remains optional.
  }
}

export default function ErnestoV144Enhancer() {
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return;

    const supabase = createClient(url, anon);
    const originalFetch = window.fetch.bind(window);
    const memoryCache = new Map<string, MemoryRow>();
    const clientSyncSignatures = new Map<string, string>();
    let syncTimer: number | null = null;
    let disposed = false;

    async function accessToken() {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token || "";
    }

    async function loadMemories() {
      const token = await accessToken();
      if (!token || disposed) return;
      try {
        const res = await originalFetch("/api/dossier-memory", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const memories: MemoryRow[] = Array.isArray(data?.memories) ? data.memories : [];
        memories.forEach((memory) => memory?.project_id && memoryCache.set(memory.project_id, memory));
        decorateMemoryBadge();

        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;
        if (userId && mergeRemoteProjects(memories, userId)) {
          window.location.reload();
        }
      } catch {
        // Remote memory is an enhancement; local dossier context still works.
      }
    }

    async function syncActiveDossier() {
      const project = findActiveProject();
      if (!project || disposed) return;
      const chat = Array.isArray(project.chat) ? project.chat.slice(-12) : [];
      const last = chat[chat.length - 1];
      const signature = `${project.title}|${project.objective || ""}|${chat.length}|${last?.id || ""}|${normalizeText(last?.text).slice(-160)}`;
      if (clientSyncSignatures.get(project.id) === signature) return;
      clientSyncSignatures.set(project.id, signature);

      const token = await accessToken();
      if (!token) return;
      try {
        const res = await originalFetch("/api/dossier-memory", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            projectId: project.id,
            title: project.title,
            objective: project.objective || "",
            chat: chat.map((item) => ({ role: item.role, text: item.text })),
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.memory?.project_id) {
          memoryCache.set(data.memory.project_id, data.memory);
          decorateMemoryBadge();
        }
      } catch {
        // Fail-soft: recent local context remains available.
      }
    }

    function scheduleSync(delay = 1100) {
      if (syncTimer) window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => void syncActiveDossier(), delay);
    }

    function decorateMemoryBadge() {
      document.querySelectorAll(".v144-memory-badge").forEach((node) => node.remove());
      const project = findActiveProject();
      if (!project) return;
      const memory = memoryCache.get(project.id);
      if (!memory?.summary) return;
      const strip = document.querySelector<HTMLElement>(".activeProjectStrip");
      if (!strip) return;
      const badge = document.createElement("span");
      badge.className = "v144-memory-badge";
      badge.textContent = "Mémoire active";
      badge.title = "Ernesto conserve les repères utiles de ce dossier pour assurer la continuité entre vos échanges.";
      strip.appendChild(badge);
    }

    async function postFeedback(payload: Record<string, unknown>) {
      const token = await accessToken();
      if (!token) {
        enqueueFeedback(payload);
        return false;
      }
      try {
        const res = await originalFetch("/api/feedback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          enqueueFeedback(payload);
          return false;
        }
        return true;
      } catch {
        enqueueFeedback(payload);
        return false;
      }
    }

    async function flushFeedbackQueue() {
      const queue = feedbackQueue();
      if (!queue.length) return;
      const token = await accessToken();
      if (!token) return;
      const remaining: unknown[] = [];
      for (const payload of queue.slice(-20)) {
        try {
          const res = await originalFetch("/api/feedback", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });
          if (!res.ok) remaining.push(payload);
        } catch {
          remaining.push(payload);
        }
      }
      try {
        window.localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
    }

    function buildFeedbackPayload(block: HTMLElement, rating: 1 | -1, reason: string | null) {
      const answer = answerTextFromBlock(block);
      const project = findActiveProject();
      const meta = findMessageMetadata(project, answer);
      return {
        projectId: project?.id || null,
        projectTitle: project?.title || activeProjectTitle() || null,
        question: meta.question || null,
        answer,
        mode: meta.mode,
        rating,
        reason,
        ragUsed: meta.ragUsed,
      };
    }

    function markFeedbackSent(actions: HTMLElement, label = "Merci") {
      actions.querySelectorAll<HTMLButtonElement>(".v144-feedback-btn").forEach((button) => {
        button.disabled = true;
      });
      let status = actions.querySelector<HTMLElement>(".v144-feedback-sent");
      if (!status) {
        status = document.createElement("span");
        status.className = "v144-feedback-sent";
        actions.appendChild(status);
      }
      status.textContent = label;
    }

    function showNegativeReasons(actions: HTMLElement, block: HTMLElement) {
      block.querySelector(".v144-feedback-reasons")?.remove();
      const row = document.createElement("div");
      row.className = "v144-feedback-reasons";
      const reasons = [
        ["Trop vague", "too_vague"],
        ["Incorrect", "incorrect"],
        ["Pas assez pratique", "not_practical"],
      ] as const;
      reasons.forEach(([label, value]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", async () => {
          const payload = buildFeedbackPayload(block, -1, value);
          await postFeedback(payload);
          row.remove();
          markFeedbackSent(actions);
        });
        row.appendChild(button);
      });
      actions.insertAdjacentElement("afterend", row);
    }

    function smartButton(label: string, className: string, onClick: () => void) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      button.addEventListener("click", onClick);
      return button;
    }

    function decorateAnswers() {
      document.querySelectorAll<HTMLElement>(".answerActions").forEach((actions) => {
        if (actions.dataset.v144 === "1") return;
        const block = actions.closest<HTMLElement>(".answerBlock");
        if (!block) return;
        actions.dataset.v144 = "1";

        const answer = () => answerTextFromBlock(block);
        const divider = document.createElement("span");
        divider.className = "v144-action-divider";
        actions.appendChild(divider);

        actions.appendChild(
          smartButton("Approfondir", "v144-smart-action", () => queueFollowup("analyse", answer()))
        );
        actions.appendChild(
          smartButton("Plan d’action", "v144-smart-action", () => queueFollowup("action", answer()))
        );

        const feedbackLabel = document.createElement("span");
        feedbackLabel.className = "v144-feedback-label";
        feedbackLabel.textContent = "Utile ?";
        actions.appendChild(feedbackLabel);

        const up = smartButton("👍", "v144-feedback-btn", async () => {
          const payload = buildFeedbackPayload(block, 1, null);
          await postFeedback(payload);
          block.querySelector(".v144-feedback-reasons")?.remove();
          markFeedbackSent(actions);
        });
        up.title = "Réponse utile";
        up.setAttribute("aria-label", "Réponse utile");
        actions.appendChild(up);

        const down = smartButton("👎", "v144-feedback-btn", () => showNegativeReasons(actions, block));
        down.title = "Réponse à améliorer";
        down.setAttribute("aria-label", "Réponse à améliorer");
        actions.appendChild(down);
      });
      decorateMemoryBadge();
      scheduleSync();
    }

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const target =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : String(input);

      if (!target.includes("/api/tutor")) return originalFetch(input, init);

      const augmented = cloneAndAugmentRequest(input, init, memoryCache);
      const response = await originalFetch(augmented.input, augmented.init);
      if (response.ok) {
        window.setTimeout(() => scheduleSync(400), 850);
      }
      return response;
    };

    window.fetch = patchedFetch;

    const textareaInputListener = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.classList.contains("chatTextarea")) return;
      const pending = readPendingFollowup();
      if (pending && normalizeText(target.value) !== pending.expectedMessage) {
        window.sessionStorage.removeItem(PENDING_FOLLOWUP_KEY);
      }
    };
    document.addEventListener("input", textareaInputListener, true);

    const observer = new MutationObserver(() => decorateAnswers());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void loadMemories();
        void flushFeedbackQueue();
        scheduleSync(500);
      }
    });

    decorateAnswers();
    void loadMemories();
    void flushFeedbackQueue();
    scheduleSync(650);

    return () => {
      disposed = true;
      if (syncTimer) window.clearTimeout(syncTimer);
      observer.disconnect();
      document.removeEventListener("input", textareaInputListener, true);
      authSubscription.subscription.unsubscribe();
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
