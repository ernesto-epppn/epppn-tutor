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

function stripExplicitEpppnBanner(answer: string) {
  return String(answer || "")
    .trim()
    .replace(
      /^(?:Référence|Repère|Base)\s+EPPPN\s*[—:-]\s*[^\n]*(?:\n\n|\n|$)/i,
      ""
    )
    .replace(
      /^Ernesto s’appuie en priorité sur la base de connaissances EPPPN\.[^\n]*(?:\n\n|\n|$)/i,
      ""
    )
    .trim();
}

function stripLegacyEpppnPhrases(answer: string) {
  const legacy = [
    "Cette lecture s’inscrit naturellement dans les repères EPPPN intégrés à Ernesto, avec une priorité donnée aux variables réellement observables.",
    "Dans la logique EPPPN intégrée à Ernesto, on privilégie ici une correction progressive et vérifiable plutôt qu’une règle isolée.",
    "C’est aussi l’approche EPPPN qu’Ernesto mobilise ici : relier la situation réelle aux paramètres qui changent effectivement la décision.",
    "Dans le cadre de raisonnement EPPPN intégré à Ernesto, l’idée reste de partir de la situation réelle avant de modifier le protocole.",
    "Ernesto reste ici dans la logique de travail EPPPN : observer, hiérarchiser les causes, puis corriger de façon progressive.",
    "Cette manière de raisonner correspond au cadre pédagogique EPPPN codifié dans Ernesto : une décision doit rester liée à des observations vérifiables.",
  ];

  let clean = answer;
  legacy.forEach((phrase) => {
    clean = clean.replace(phrase, "");
  });
  return clean.replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

function shouldWeaveEpppn(responseIndex: number) {
  return responseIndex > 0;
}

function epppnSentence(responseIndex: number) {
  const variants = [
    "La réponse qui suit s’appuie sur les connaissances EPPPN codifiées dans Ernesto.",
    "Sur ce point, Ernesto mobilise le socle de connaissances EPPPN qu’il intègre.",
    "Le raisonnement présenté ici s’appuie sur les connaissances EPPPN intégrées et codifiées dans Ernesto.",
    "Cette réponse est construite à partir du socle de connaissances EPPPN intégré à Ernesto.",
    "L’analyse qui suit prend appui sur les connaissances EPPPN codifiées dans Ernesto.",
    "Pour cette situation, Ernesto s’appuie sur le socle de connaissances EPPPN codifié dans son environnement.",
    "Cette lecture repose sur les connaissances EPPPN intégrées à Ernesto, puis les adapte à la situation décrite.",
    "Ici, la réponse prend pour socle les connaissances EPPPN codifiées dans Ernesto.",
  ];
  return variants[Math.abs(responseIndex - 1) % variants.length];
}

function weaveIntoAnswer(answer: string, responseIndex: number) {
  const clean = stripLegacyEpppnPhrases(stripExplicitEpppnBanner(answer));
  if (!clean || !shouldWeaveEpppn(responseIndex)) return clean;

  // If the model already used the intended knowledge-grounding formulation,
  // do not repeat it. A generic EPPPN mention does not suppress the leitmotif.
  if (/connaissances\s+EPPPN/i.test(clean) || /socle\s+(?:de\s+connaissances\s+)?EPPPN/i.test(clean)) {
    return clean;
  }

  const sentence = epppnSentence(responseIndex);
  const blocks = clean.split(/\n{2,}/);

  if (blocks.length <= 1) {
    const sentenceEnd = clean.search(/[.!?](?:\s|$)/);
    if (sentenceEnd >= 0 && sentenceEnd < clean.length - 1) {
      return `${clean.slice(0, sentenceEnd + 1)} ${sentence} ${clean.slice(sentenceEnd + 1).trimStart()}`;
    }
    return `${clean}\n\n${sentence}`;
  }

  // Insert after the first substantive paragraph, never as a banner or heading.
  let insertAfter = 0;
  for (let i = 0; i < Math.min(blocks.length, 4); i += 1) {
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
        const answer = String(data?.answer_fr || "");
        const woven = weaveIntoAnswer(answer, index);
        if (woven === answer) return response;

        data.answer_fr = woven;

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
