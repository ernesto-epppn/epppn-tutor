"use client";

import { useEffect } from "react";

const TEXT_REPLACEMENTS: Array<[string, string]> = [
  [
    "Votre essai gratuit a atteint sa limite de sécurité.",
    "Votre accès pédagogique EPPPN a atteint sa limite d’utilisation.",
  ],
  [
    "Votre essai gratuit de 10 jours est terminé.",
    "Votre accès pédagogique EPPPN est arrivé à son terme.",
  ],
  [
    "L’essai gratuit de 10 jours est inclus.",
    "L’accès à Ernesto est réservé aux comptes autorisés par l’EPPPN.",
  ],
  ["Version actuelle : V14.1 · juin 2026", "Version actuelle : V14.5.3"],
  ["Version actuelle : V14.2.1 · août 2026", "Version actuelle : V14.5.3"],
  ["Version actuelle : V14.4 · août 2026", "Version actuelle : V14.5.3"],
  ["Version actuelle : V14.5 · août 2026", "Version actuelle : V14.5.3"],
  ["Version actuelle : V14.5.2", "Version actuelle : V14.5.3"],
];

const EPPPN_SOURCE_TEXT =
  "Cette réponse s’appuie en priorité sur les connaissances et protocoles transmis à l’EPPPN.";

function patchTextNode(node: Node) {
  if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue) return;

  let nextValue = node.nodeValue;
  for (const [from, to] of TEXT_REPLACEMENTS) {
    if (nextValue.includes(from)) {
      nextValue = nextValue.replaceAll(from, to);
    }
  }

  if (nextValue !== node.nodeValue) {
    node.nodeValue = nextValue;
  }
}

function ensureEpppnSourceLabels(root: Node) {
  const bubbles: Element[] = [];

  if (root instanceof Element && root.matches(".bubble.ernesto")) {
    bubbles.push(root);
  }

  if (root instanceof Element || root instanceof Document || root instanceof DocumentFragment) {
    bubbles.push(...Array.from(root.querySelectorAll(".bubble.ernesto")));
  }

  for (const bubble of bubbles) {
    if (!bubble.querySelector(".answerText")) continue;
    if (bubble.querySelector(":scope > .epppnSourceLabel")) continue;

    const label = document.createElement("div");
    label.className = "epppnSourceLabel";
    label.setAttribute("role", "note");
    label.setAttribute("aria-label", "Base de connaissances EPPPN");
    label.textContent = EPPPN_SOURCE_TEXT;
    label.setAttribute(
      "style",
      [
        "margin-top:12px",
        "padding-top:9px",
        "border-top:1px solid rgba(52,68,34,.12)",
        "font-size:11px",
        "line-height:1.4",
        "color:#425233",
        "opacity:.76",
      ].join(";")
    );
    bubble.appendChild(label);
  }
}

function patchTree(root: Node) {
  patchTextNode(root);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    patchTextNode(current);
    current = walker.nextNode();
  }

  ensureEpppnSourceLabels(root);
}

/**
 * Transitional cleanup for the historical monolithic Ernesto page.
 * The authenticated app already redirects visitors to /connexion; this keeps
 * obsolete trial/version wording out of the rendered UI while the large tutor
 * component is progressively decomposed into smaller modules.
 */
export default function ErnestoUiCleanup() {
  useEffect(() => {
    patchTree(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          patchTextNode(mutation.target);
          continue;
        }

        mutation.addedNodes.forEach((node) => patchTree(node));
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
