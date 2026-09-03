"use client";

import { useEffect } from "react";

function requestDetails(init?: RequestInit) {
  let question = "";
  let responseIndex = 0;
  let mode = "";

  try {
    const body = init?.body;
    if (body instanceof FormData) {
      question = String(body.get("message") || "").trim();
      responseIndex = Number(body.get("responseIndex") || 0);
      mode = String(body.get("speed") || "").trim();
    } else if (typeof body === "string") {
      const parsed = JSON.parse(body);
      question = String(parsed?.message || "").trim();
      responseIndex = Number(parsed?.responseIndex || 0);
      mode = String(parsed?.speed || "").trim();
    }
  } catch {
    // Telemetry must never interfere with the tutor request.
  }

  return { question, responseIndex, mode };
}

function projectTitle() {
  return String(document.querySelector<HTMLElement>(".activeProjectTitleText")?.innerText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

export default function ErnestoRagUsageTracker() {
  useEffect(() => {
    const previousFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = requestUrl(input);
      if (!target.includes("/api/tutor")) return previousFetch(input, init);

      const details = requestDetails(init);
      const dossier = projectTitle();
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const authorization = headers.get("authorization") || "";
      const response = await previousFetch(input, init);

      if (response.ok && details.question && authorization) {
        const clone = response.clone();
        void clone
          .json()
          .then((data) => {
            const rag = data?.rag || { used: 0, top: [] };
            return previousFetch("/api/rag-usage", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authorization,
              },
              body: JSON.stringify({
                question: details.question,
                responseIndex: details.responseIndex,
                projectTitle: dossier,
                mode: data?.mode || details.mode,
                rag,
              }),
              cache: "no-store",
            });
          })
          .catch(() => {
            // Silent by design: analytics must never affect Ernesto.
          });
      }

      return response;
    };

    return () => {
      window.fetch = previousFetch;
    };
  }, []);

  return null;
}
