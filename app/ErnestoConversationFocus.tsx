"use client";

import { useEffect } from "react";

function hasConversation() {
  return Boolean(document.querySelector(".bubbleWrap.user"));
}

function applyConversationFocus() {
  const root = document.querySelector<HTMLElement>(".appRoot");
  if (!root) return;
  root.classList.toggle("conversationFocus", hasConversation());
}

/**
 * v14.5.3 — once a conversation starts, reduce landing-page chrome and let the
 * exchange become the primary interface. No tutor/data behavior is changed.
 */
export default function ErnestoConversationFocus() {
  useEffect(() => {
    applyConversationFocus();

    const observer = new MutationObserver(() => applyConversationFocus());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
