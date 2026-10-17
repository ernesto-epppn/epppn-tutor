"use client";

import { useEffect } from "react";

const COMPOSER_PLACEHOLDER = "Posez votre question à Ernesto…";

const LEVELS = [
  { key: "limited", label: "Contexte à préciser", index: 0 },
  { key: "useful", label: "Contexte utile", index: 1 },
  { key: "strong", label: "Contexte bien renseigné ✓", index: 2 },
] as const;

type ContextLevel = (typeof LEVELS)[number];

function contextualSignals(text: string) {
  const value = text.toLowerCase().replace(/\s+/g, " ").trim();
  const signals = new Set<string>();
  if (!value) return signals;

  if (/(pizza|pain|p[aâ]te|focaccia|teglia|napolitaine|biga|poolish|levain|p[aâ]ton|cornicione)/i.test(value)) {
    signals.add("product");
  }
  if (/(p[eé]triss|pointage|boulage|appr[eê]t|fermentation|maturation|ouverture|fa[cç]onnage|cuisson|refroid|service|enfourn)/i.test(value)) {
    signals.add("stage");
  }
  if (/(farine|levure|levain|sel|eau|huile|semoule|gluten|w\s*\d{2,3}|p\s*\/\s*l)/i.test(value)) {
    signals.add("ingredients");
  }
  if (/(four|p[eé]trin|frigo|r[eé]frig[eé]rateur|chambre|bac|pierre|sole|vo[uû]te|plaque|spirale|mat[eé]riel)/i.test(value)) {
    signals.add("equipment");
  }
  if (/(je veux|je cherche|je souhaite|objectif|but|viser|obtenir|besoin|production vis[eé]e|pour le service|pour ce soir|pour demain)/i.test(value)) {
    signals.add("goal");
  }
  if (/(collant|collante|molle|rel[aâ]ch|d[eé]chir|p[aâ]le|br[uû]l|acide|faible|sec|s[eè]che|irr[eé]gulier|alv[eé]ol|gonfl|retombe|r[eé]tract|cro[uû]te|mie|coloration|probl[eè]me|r[eé]sultat|j'observe|je constate)/i.test(value)) {
    signals.add("observation");
  }
  if (/(apr[eè]s|avant|pendant|depuis|au bout de|ensuite|d'abord|la veille|le lendemain|aujourd'hui|hier|demain|matin|soir)/i.test(value)) {
    signals.add("timeline");
  }
  if (/(froid|chaud|ambiante|temp[eé]rature|humidit[eé]|frigo|r[eé]frig[eé]r)/i.test(value)) {
    signals.add("environment");
  }
  if (/(quantit[eé]|volume|p[aâ]tons?|pi[eè]ces?|couverts?|service|cadence|d[eé]lai|horaire|planning|production)/i.test(value)) {
    signals.add("constraints");
  }
  if (/(j'ai|nous avons|on a|essay[eé]|test[eé]|chang[eé]|modifi[eé]|augment[eé]|r[eé]duit|diminu[eé]|ajout[eé]|laiss[eé]|utilis[eé]|remplac[eé])/i.test(value)) {
    signals.add("history");
  }
  if (/(parce que|alors que|mais|cependant|quand|lorsque|si |avec |sans |malgr[eé]|contrairement)/i.test(value)) {
    signals.add("relation");
  }

  if (/\d/.test(value)) signals.add("measurement");
  if (/(?:°\s*c|\b\d{1,3}\s*c\b|temp[eé]rature)/i.test(value)) signals.add("temperature");
  if (/\b\d+(?:[.,]\d+)?\s*(?:h|heures?|min|minutes?|j|jours?)\b/i.test(value)) signals.add("duration");
  if (/%|hydrat(?:ation|é|ee)?/i.test(value)) signals.add("hydration");

  return signals;
}

function contextQuality(text: string, persistentContext: string): ContextLevel {
  const value = text.trim();
  const currentSignals = contextualSignals(value);
  const persistentSignals = contextualSignals(persistentContext);

  // Persistent profile/work context enriches the situation, but never makes a
  // vague question "strong" by itself.
  let score = Math.min(2, persistentSignals.size * 0.5);

  // Reward distinct contextual dimensions rather than raw length or numbers.
  score += Math.min(7, currentSignals.size);

  const words = value.split(/\s+/).filter(Boolean).length;
  if (words >= 8) score += 0.5;
  if (words >= 18) score += 0.5;

  // A relation between cause/condition/result is genuinely contextual.
  if (currentSignals.has("relation") && currentSignals.has("observation")) score += 1;
  if (currentSignals.has("history") && currentSignals.has("observation")) score += 1;
  if (currentSignals.has("goal") && (currentSignals.has("constraints") || currentSignals.has("stage"))) score += 1;

  if (!value || score < 3) return LEVELS[0];
  if (score >= 6 || currentSignals.size >= 5) return LEVELS[2];
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

  const automatic = document.createElement("span");
  automatic.className = "ernestoContextMeterAuto";
  automatic.innerHTML = '<span class="ernestoContextMeterAutoDot" aria-hidden="true"></span>Automatique';

  top.append(title, automatic);

  const track = document.createElement("div");
  track.className = "ernestoContextMeterTrack";
  track.setAttribute("aria-hidden", "true");

  const fill = document.createElement("div");
  fill.className = "ernestoContextMeterFill";

  track.append(fill);

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
      const persistentContext =
        contextSummary?.textContent?.trim() &&
        !/Aucun contexte renseign[eé]/i.test(contextSummary.textContent)
          ? contextSummary.textContent
          : "";

      const quality = contextQuality(textarea.value, persistentContext);
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
