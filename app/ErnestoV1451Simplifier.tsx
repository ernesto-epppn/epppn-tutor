"use client";

import { useEffect } from "react";

const PENDING_FOLLOWUP_KEY = "ernesto_v144_pending_followup";

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pendingFollowupKind(): "analyse" | "action" | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_FOLLOWUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.kind === "analyse" || parsed?.kind === "action" ? parsed.kind : null;
  } catch {
    return null;
  }
}

function isActionSpeed(value: unknown) {
  const speed = normalizeText(value).toUpperCase();
  return speed !== "ECOLE" && speed !== "APPROFONDIE" && speed !== "ANALYSE";
}

function forceAutomaticActionPlan(input: RequestInfo | URL, init?: RequestInit) {
  if (!init?.body) return { input, init };

  // An explicit Analyse follow-up may be sent before React has visually updated
  // the mode switch. Never turn that request into an Action flowchart.
  if (pendingFollowupKind() === "analyse") return { input, init };

  if (init.body instanceof FormData) {
    const copy = new FormData();
    init.body.forEach((value, key) => copy.append(key, value));
    if (isActionSpeed(copy.get("speed"))) {
      copy.set("presentation", "flowchart");
    }
    return { input, init: { ...init, body: copy } };
  }

  if (typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body);
      if (isActionSpeed(parsed?.speed)) {
        parsed.presentation = "flowchart";
      }
      return { input, init: { ...init, body: JSON.stringify(parsed) } };
    } catch {
      return { input, init };
    }
  }

  return { input, init };
}

function removeLegacyPlanButtons() {
  document.querySelectorAll<HTMLButtonElement>(".answerActions .v144-smart-action").forEach((button) => {
    const label = normalizeText(button.textContent).toLowerCase();
    if (label === "plan d’action" || label === "plan d'action" || label.includes("transformer")) {
      button.remove();
    }
  });
}

/**
 * v14.5.1 — Action is a result format, not a second workflow.
 * - every normal Action request asks the tutor for the visual plan directly;
 * - the legacy “Plan d’action” transformation button is removed;
 * - Analyse stays unchanged.
 */
export default function ErnestoV1451Simplifier() {
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

      const adjusted = forceAutomaticActionPlan(input, init);
      return previousFetch(adjusted.input, adjusted.init);
    };

    window.fetch = patchedFetch;
    removeLegacyPlanButtons();

    const observer = new MutationObserver(() => removeLegacyPlanButtons());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (window.fetch === patchedFetch) window.fetch = previousFetch;
    };
  }, []);

  return null;
}
