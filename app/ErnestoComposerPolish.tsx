"use client";

import { useEffect } from "react";

const COMPOSER_PLACEHOLDER =
  "Que se passe-t-il exactement ? Donnez à Ernesto les éléments qui peuvent faire la différence…";

const LEVELS = [
  { key: "limited", label: "Contexte à préciser", index: 0 },
  { key: "useful", label: "Contexte utile", index: 1 },
  { key: "strong", label: "Contexte bien renseigné ✓", index: 2 },
] as const;

type ContextLevel = (typeof LEVELS)[number];

function contextQuality(text: string, hasWorkContext: boolean): ContextLevel {
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

  if (!value || score < 3) return LEVELS[0];
  if (score >= 6) return LEVELS[2];
  return LEVELS[1];
}

function buildMeter() {
  const meter = document.createElement("div");
  meter.className = "ernestoContextMeter";
  meter.setAttribute("role", "status");
  meter.setAttribute("aria-live", "polite");

  const top = document.createElement("div");
  top.className = "ernestoContextMeterTop";

  const title = document.createElement("span");
  title.className = "ernestoContextMeterTitle";
  title.textContent = "Précision du contexte";

  top.append(title);

  const track = document.createElement("div");
  track.className = "ernestoContextMeterTrack";
  track.setAttribute("aria-hidden", "true");

  const fill = document.createElement("div");
  fill.className = "ernestoContextMeterFill";

  const thumb = document.createElement("div");
  thumb.className = "ernestoContextMeterThumb";

  ["8%", "50%", "92%"].forEach((left) => {
    const dot = document.createElement("span");
    dot.className = "ernestoContextMeterStepDot";
    dot.style.left = left;
    track.appendChild(dot);
  });

  track.append(fill, thumb);

  const labels = document.createElement("div");
  labels.className = "ernestoContextMeterLabels";
  LEVELS.forEach((item) => {
    const label = document.createElement("span");
    label.className = "ernestoContextMeterLabel";
    label.dataset.level = item.key;
    label.textContent = item.label;
    labels.appendChild(label);
  });

  meter.append(top, track, labels);
  return meter;
}

export default function ErnestoComposerPolish() {
  useEffect(() => {
    let currentTextarea: HTMLTextAreaElement | null = null;

    const ensureMeter = (composerBox: HTMLElement, textarea: HTMLTextAreaElement) => {
      let meter = composerBox.querySelector<HTMLElement>(".ernestoContextMeter");
      if (!meter) {
        meter = buildMeter();
        composerBox.insertBefore(meter, textarea);
      }
      return meter;
    };

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
      const meter = ensureMeter(composerBox, textarea);

      composerBox.dataset.contextLevel = quality.key;
      composerBox.dataset.contextLabel = quality.label;
      meter.dataset.contextLevel = quality.key;
      meter.dataset.contextIndex = String(quality.index);
      meter.setAttribute("aria-label", `Précision du contexte : ${quality.label}.`);

      meter.querySelectorAll<HTMLElement>(".ernestoContextMeterLabel").forEach((label) => {
        label.classList.toggle("isCurrent", label.dataset.level === quality.key);
      });
    };

    const attach = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".appRoot textarea.chatTextarea");
      if (!textarea) return;

      if (currentTextarea !== textarea) {
        currentTextarea?.removeEventListener("input", updateQuality);
        currentTextarea?.removeEventListener("change", updateQuality);
        currentTextarea = textarea;
        currentTextarea.addEventListener("input", updateQuality);
        currentTextarea.addEventListener("change", updateQuality);
      }
      updateQuality();
    };

    attach();

    const observer = new MutationObserver(() => attach());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder"],
    });

    return () => {
      observer.disconnect();
      currentTextarea?.removeEventListener("input", updateQuality);
      currentTextarea?.removeEventListener("change", updateQuality);
    };
  }, []);

  return null;
}
