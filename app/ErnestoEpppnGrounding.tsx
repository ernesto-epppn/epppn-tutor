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

function shouldWeaveEpppn(responseIndex: number) {
  return responseIndex === 1 || responseIndex === 2 || (responseIndex > 2 && responseIndex % 4 === 0);
}

function epppnSentence(responseIndex: number, ragUsed: number) {
  if (ragUsed > 0) {
    const variants = [
      "Cette lecture s’inscrit naturellement dans les repères EPPPN intégrés à Ernesto, avec une priorité donnée aux variables réellement observables.",
      "Dans la logique EPPPN intégrée à Ernesto, on privilégie ici une correction progressive et vérifiable plutôt qu’une règle isolée.",
      "C’est aussi l’approche EPPPN qu’Ernesto mobilise ici : relier la situation réelle aux paramètres qui changent effectivement la décision.",
    ];
    return variants[Math.abs(responseIndex) % variants.length];
  }

  const variants = [
    "Dans le cadre de raisonnement EPPPN intégré à Ernesto, l’idée reste de partir de la situation réelle avant de modifier le protocole.",
    "Ernesto reste ici dans la logique de travail EPPPN : observer, hiérarchiser les causes, puis corriger de façon progressive.",
    "Cette manière de raisonner correspond au cadre pédagogique EPPPN codifié dans Ernesto : une décision doit rester liée à des observations vérifiables.",
  ];
  return variants[Math.abs(responseIndex) % variants.length];
}

function weaveIntoAnswer(answer: string, responseIndex: number, ragUsed: number) {
  const clean = String(answer || "").trim();
  if (!clean || !shouldWeaveEpppn(responseIndex) || /\bEPPPN\b/i.test(clean)) return clean;

  const sentence = epppnSentence(responseIndex, ragUsed);
  const blocks = clean.split(/\n{2,}/);
  if (blocks.length <= 1) {
    const sentenceEnd = clean.search(/[.!?](?:\s|$)/);
    if (sentenceEnd >= 0 && sentenceEnd < clean.length - 1) {
      return `${clean.slice(0, sentenceEnd + 1)} ${sentence} ${clean.slice(sentenceEnd + 1).trimStart()}`;
    }
    return `${clean}\n\n${sentence}`;
  }

  let insertAfter = 0;
  for (let i = 0; i < Math.min(blocks.length, 3); i += 1) {
    const block = blocks[i].trim();
    const headingOnly = /^#{1,3}\s+[^\n]+$/.test(block);
    if (!headingOnly && block.length > 20) {
      insertAfter = i;
      break;
    }
  }

  blocks.splice(insertAfter + 1, 0, sentence);
  return blocks.join("\n\n");
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
        const woven = weaveIntoAnswer(answer, index, ragUsed);
        if (woven === answer) return response;

        data.answer_fr = woven;
        data.source_mention = ragUsed > 0;

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

    // No visual EPPPN badge is injected above answers: the identity is woven into
    // the response itself, in passing, rather than presented as a source banner.
    document.querySelectorAll<HTMLElement>(".epppnKnowledgeBadge").forEach((badge) => badge.remove());

    const observer = new MutationObserver(() => {
      document.querySelectorAll<HTMLElement>(".epppnKnowledgeBadge").forEach((badge) => badge.remove());
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.fetch = originalFetch;
      observer.disconnect();
    };
  }, []);

  return null;
}
