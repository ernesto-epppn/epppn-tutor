"use client";

import { useEffect } from "react";

const APPROVED_ERNESTO_LOGO = "/logo-ernesto-approved.png?v=20260828-2";

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

function patchBranding(root: Node) {
  const images: HTMLImageElement[] = [];

  if (
    root instanceof HTMLImageElement &&
    (root.classList.contains("sidebarLogoErnesto") || root.classList.contains("brandLogoErnesto"))
  ) {
    images.push(root);
  }

  if (root instanceof Element || root instanceof Document || root instanceof DocumentFragment) {
    images.push(
      ...Array.from(
        root.querySelectorAll<HTMLImageElement>("img.sidebarLogoErnesto, img.brandLogoErnesto")
      )
    );
  }

  for (const image of images) {
    image.style.display = "block";
    image.src = APPROVED_ERNESTO_LOGO;
    image.alt = "Logo Ernesto";
  }
}

function patchFavicon() {
  const iconLinks = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="shortcut icon"]')
  );

  if (iconLinks.length === 0) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.href = APPROVED_ERNESTO_LOGO;
    document.head.appendChild(link);
  } else {
    for (const link of iconLinks) {
      link.type = "image/png";
      link.href = APPROVED_ERNESTO_LOGO;
    }
  }

  let appleIcon = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!appleIcon) {
    appleIcon = document.createElement("link");
    appleIcon.rel = "apple-touch-icon";
    document.head.appendChild(appleIcon);
  }
  appleIcon.href = APPROVED_ERNESTO_LOGO;
}

function patchTree(root: Node) {
  patchTextNode(root);
  patchBranding(root);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    patchTextNode(current);
    current = walker.nextNode();
  }
}

/**
 * Transitional cleanup for the historical monolithic Ernesto page.
 * The authenticated app already redirects visitors to /connexion; this keeps
 * obsolete trial/version wording out of the rendered UI while the large tutor
 * component is progressively decomposed into smaller modules.
 */
export default function ErnestoUiCleanup() {
  useEffect(() => {
    patchFavicon();
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
