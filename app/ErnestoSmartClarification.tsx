"use client";

import { useEffect } from "react";

const CLARIFICATION_POLICY = `
RÈGLE DE CLARIFICATION INTELLIGENTE — priorité élevée pour cet échange :
- Par défaut, réponds immédiatement à la question. Ne demande pas d'informations supplémentaires simplement pour être plus complet ou plus précis.
- Pose UNE SEULE question de clarification avant de donner le conseil uniquement si les trois conditions suivantes sont réunies :
  1. l'information décisive est absente de la question, du contexte du dossier, de la mémoire disponible et des images éventuelles ;
  2. au moins deux valeurs ou situations plausibles conduiraient à des diagnostics ou actions matériellement différents ;
  3. choisir une hypothèse sans cette information risquerait de conduire l'utilisateur vers une mauvaise action, un mauvais réglage ou une conclusion trompeuse.
- Si ces trois conditions ne sont pas réunies, ne pose pas de question : formule l'hypothèse utilisée de manière visible et donne la meilleure réponse prudente possible.
- Une clarification indispensable doit être courte, concrète et porter sur une seule variable. Ne pose jamais une série de questions.
- Si tu dois clarifier avant de répondre, la réponse doit se limiter à cette seule question, précédée au besoin d'une phrase très courte expliquant pourquoi ce point change réellement la décision. Ne donne pas encore un protocole complet.
- Ne termine jamais une réponse complète par des questions de routine du type « quelle est votre température ? » ou « pouvez-vous préciser ? ». Une question finale n'est acceptable que si elle est réellement nécessaire pour décider de la suite.
- Quand l'utilisateur répond à une clarification, exploite directement cette information avec le contexte déjà disponible et réponds normalement. Ne repose pas la même question.
- Cette règle vaut de la même manière en mode Action et en mode Analyse.
`.trim();

function appendPolicy(existing: string) {
  const clean = existing.trim();
  return clean ? `${clean}\n\n${CLARIFICATION_POLICY}` : CLARIFICATION_POLICY;
}

function augmentRequest(input: RequestInfo | URL, init?: RequestInit) {
  if (!init?.body) return { input, init };

  if (init.body instanceof FormData) {
    const copy = new FormData();
    init.body.forEach((value, key) => copy.append(key, value));
    const existing = String(copy.get("contextText") || "");
    copy.set("contextText", appendPolicy(existing));
    return { input, init: { ...init, body: copy } };
  }

  if (typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body);
      parsed.contextText = appendPolicy(String(parsed?.contextText || ""));
      return { input, init: { ...init, body: JSON.stringify(parsed) } };
    } catch {
      return { input, init };
    }
  }

  return { input, init };
}

/**
 * Adds one narrow behavioural rule to Ernesto without changing the tutor API:
 * clarify only when a missing variable genuinely blocks a safe/useful decision.
 */
export default function ErnestoSmartClarification() {
  useEffect(() => {
    const previousFetch = window.fetch.bind(window);

    const patchedFetch: typeof window.fetch = async (input, init) => {
      const target =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : String(input);

      if (!target.includes("/api/tutor")) {
        return previousFetch(input, init);
      }

      const augmented = augmentRequest(input, init);
      return previousFetch(augmented.input, augmented.init);
    };

    window.fetch = patchedFetch;

    return () => {
      if (window.fetch === patchedFetch) window.fetch = previousFetch;
    };
  }, []);

  return null;
}
