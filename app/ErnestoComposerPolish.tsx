"use client";

import { useEffect } from "react";

const COMPOSER_PLACEHOLDER =
  "Décrivez ce que vous observez : pâte, température, durée, farine, cuisson…";

function contextQuality(text: string, hasWorkContext: boolean) {
  const value = text.trim();
  let score = hasWorkContext ? 1 : 0;

  if (value.length >= 35) score += 1;
  if (value.length >= 90) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/(?:°\s*c|\b\d{1,3}\s*c\b|temp[eé]rature)/i.test(value)) score += 1;
  if (/\b\d+(?:[.,]\d+)?\s*(?:h|heures?|min|minutes?|j|jours?)\b/i.test(value)) score += 1;
  if (/%|hydrat(?:ation|é|ee)?/i.test(value)) score += 1;
  if (/\bfarine\b|\bw\s*\d{2,3}\b|\bt\s*\d{2,3}\b/i.test(value)) score += 1;
  if (/(service|froid|frigo|ouverture|cuisson|appr[eê]t|fermentation|p[eé]trissage|boulage|four)/i.test(value)) score += 1;
  if (/(collant|collante|d[eé]chir|p[aâ]le|acide|faible|molle|sec|s[eè]che|irr[eé]gulier|alv[eé]ol)/i.test(value)) score += 1;

  if (!value) {
    return { level: "limited", label: "Contexte à préciser" };
  }
  if (score >= 6) {
    return { level: "strong", label: "Contexte bien renseigné ✓" };
  }
  if (score >= 3) {
    return { level: "useful", label: "Contexte utile" };
  }
  return { level: "limited", label: "Contexte à préciser" };
}

export default function ErnestoComposerPolish() {
  useEffect(() => {
    let currentTextarea: HTMLTextAreaElement | null = null;

    const updateQuality = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".appRoot textarea.chatTextarea");
      const composerBox = document.querySelector<HTMLElement>(".appRoot .composerBox");
      if (!textarea || !composerBox) return;

      if (textarea.placeholder !== COMPOSER_PLACEHOLDER) {
        textarea.placeholder = COMPOSER_PLACEHOLDER;
      }

      const contextSummary = document.querySelector<HTMLElement>(".appRoot .contextSummary");
      const hasWorkContext = Boolean(
        contextSummary?.textContent?.trim() &&
          !/Aucun contexte renseign[eé]/i.test(contextSummary.textContent)
      );

      const quality = contextQuality(textarea.value, hasWorkContext);
      composerBox.dataset.contextLevel = quality.level;
      composerBox.dataset.contextLabel = quality.label;
    };

    const attach = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".appRoot textarea.chatTextarea");
      if (!textarea) return;

      if (currentTextarea !== textarea) {
        currentTextarea?.removeEventListener("input", updateQuality);
        currentTextarea = textarea;
        currentTextarea.addEventListener("input", updateQuality);
      }
      updateQuality();
    };

    attach();

    const observer = new MutationObserver(() => attach());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["placeholder"],
    });

    return () => {
      observer.disconnect();
      currentTextarea?.removeEventListener("input", updateQuality);
    };
  }, []);

  return null;
}
