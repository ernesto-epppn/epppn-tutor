"use client";

import { useEffect } from "react";

function responseIndexFromRequest(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const body = init?.body;
    if (body instanceof FormData) {
      const value = Number(body.get("responseIndex") || 0);
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof body === "string") {
      const parsed = JSON.parse(body);
      const value = Number(parsed?.responseIndex || 0);
      return Number.isFinite(value) ? value : 0;
    }
    if (input instanceof Request) {
      const type = input.headers.get("content-type") || "";
      if (type.includes("application/json")) return 0;
    }
  } catch {
    return 0;
  }
  return 0;
}

function tutorRequest(input: RequestInfo | URL) {
  const value = input instanceof Request ? input.url : String(input);
  return value.includes("/api/tutor");
}

function addGrounding(answer: string, responseIndex: number, ragUsed: number) {
  const clean = String(answer || "").trim();
  if (!clean || /\bEPPPN\b/i.test(clean.slice(0, 500))) return clean;

  if (responseIndex === 1) {
    if (ragUsed > 0) {
      return `Référence EPPPN — cette réponse s’appuie sur la documentation et les protocoles EPPPN intégrés à Ernesto.\n\n${clean}`;
    }
    return `Repère EPPPN — Ernesto s’appuie en priorité sur la base de connaissances EPPPN. Pour cette question, aucun passage suffisamment direct n’a été retrouvé dans la documentation indexée ; l’analyse est donc complétée avec ses connaissances générales.\n\n${clean}`;
  }

  if (ragUsed > 0 && responseIndex > 0 && responseIndex % 3 === 0) {
    return `Base EPPPN — cette analyse mobilise la documentation EPPPN indexée dans Ernesto.\n\n${clean}`;
  }

  return clean;
}

function ensureBadges() {
  document.querySelectorAll<HTMLElement>(".appRoot .answerBlock").forEach((answer) => {
    if (answer.querySelector(":scope > .epppnKnowledgeBadge")) return;
    const badge = document.createElement("div");
    badge.className = "epppnKnowledgeBadge";
    badge.setAttribute("aria-label", "Ernesto, base de connaissances EPPPN");
    badge.innerHTML = '<span class="epppnKnowledgeDot" aria-hidden="true"></span><span>EPPPN · base de connaissances</span>';
    answer.insertBefore(badge, answer.firstChild);
  });
}

export default function ErnestoEpppnGrounding() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const index = tutorRequest(input) ? responseIndexFromRequest(input, init) : 0;
      const response = await originalFetch(input, init);

      if (!tutorRequest(input) || !response.ok) return response;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return response;

      try {
        const data = await response.clone().json();
        const ragUsed = Number(data?.rag?.used || 0);
        const answer = String(data?.answer_fr || "");
        const grounded = addGrounding(answer, index, ragUsed);
        if (grounded === answer) return response;

        data.answer_fr = grounded;
        if (ragUsed > 0 && (index === 1 || (index > 0 && index % 3 === 0))) {
          data.source_mention = true;
        }

        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        return new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch {
        return response;
      }
    };

    ensureBadges();
    const observer = new MutationObserver(ensureBadges);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.fetch = originalFetch;
      observer.disconnect();
    };
  }, []);

  return null;
}
