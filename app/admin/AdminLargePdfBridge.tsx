"use client";

import { useEffect } from "react";

const LEGACY_LIMIT = 8 * 1024 * 1024;

function loadDataImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("ocr_image_decode_failed"));
    image.src = dataUrl;
  });
}

function tileToJpeg(
  image: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
) {
  const maxSide = 1800;
  const scale = Math.min(2.2, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ocr_canvas_unavailable");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  let dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  if (dataUrl.length > 2_050_000) dataUrl = canvas.toDataURL("image/jpeg", 0.76);
  canvas.width = 1;
  canvas.height = 1;
  return dataUrl;
}

async function makeVisionTiles(dataUrl: string) {
  const image = await loadDataImage(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return [dataUrl];

  // Four overlapping quadrants. Cropping before OpenAI vision gives dense book text
  // substantially more effective pixels than sending the whole page at once.
  const cropWidth = Math.round(width * 0.58);
  const cropHeight = Math.round(height * 0.58);
  const rightX = Math.max(0, width - cropWidth);
  const bottomY = Math.max(0, height - cropHeight);

  return [
    tileToJpeg(image, 0, 0, cropWidth, cropHeight),
    tileToJpeg(image, rightX, 0, cropWidth, cropHeight),
    tileToJpeg(image, 0, bottomY, cropWidth, cropHeight),
    tileToJpeg(image, rightX, bottomY, cropWidth, cropHeight),
  ];
}

export default function AdminLargePdfBridge() {
  useEffect(() => {
    const legacy = document.getElementById("epppn-file-input") as HTMLInputElement | null;
    const form = legacy?.closest("form") || null;

    function openKnowledgeSection() {
      window.dispatchEvent(
        new CustomEvent("ernesto:admin-section", { detail: { section: "knowledge" } })
      );
    }

    function handoff(selected: File) {
      if (selected.size <= LEGACY_LIMIT) return false;
      const largeInput = document.querySelector<HTMLInputElement>(
        ".hybridOcrShell .drop input[type='file'], .largePdfShell .largeDrop input[type='file']"
      );
      const shell = document.querySelector<HTMLElement>(".hybridOcrShell, .largePdfShell");
      if (!largeInput || !shell) return false;

      try {
        const transfer = new DataTransfer();
        transfer.items.add(selected);
        largeInput.files = transfer.files;
        largeInput.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
        // Some browsers block programmatic FileList assignment.
      }

      openKnowledgeSection();
      window.setTimeout(() => shell.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      return true;
    }

    const onChange = () => {
      const selected = legacy?.files?.[0];
      if (selected) window.setTimeout(() => handoff(selected), 80);
    };

    const onSubmit = (event: Event) => {
      const selected = legacy?.files?.[0];
      if (!selected || selected.size <= LEGACY_LIMIT) return;
      event.preventDefault();
      event.stopPropagation();
      handoff(selected);
    };

    legacy?.addEventListener("change", onChange);
    form?.addEventListener("submit", onSubmit, true);

    // Improve only the difficult-page OCR request. The importer still decides when
    // AI vision is necessary; this bridge simply sends four enlarged overlapping
    // crops instead of one reduced full-page JPEG.
    const originalFetch = window.fetch.bind(window);
    const patchedFetch: typeof window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);

      if (!url.includes("/api/admin/ocr-page") || typeof init?.body !== "string") {
        return originalFetch(input, init);
      }

      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const imageDataUrl = String(body.image_data_url || "");
        if (imageDataUrl && !Array.isArray(body.image_data_urls)) {
          const tiles = await makeVisionTiles(imageDataUrl);
          return originalFetch(input, {
            ...init,
            body: JSON.stringify({ ...body, image_data_urls: tiles }),
          });
        }
      } catch (error) {
        console.warn("Ernesto OCR tiling fallback unavailable:", error);
      }

      return originalFetch(input, init);
    };

    window.fetch = patchedFetch;

    return () => {
      legacy?.removeEventListener("change", onChange);
      form?.removeEventListener("submit", onSubmit, true);
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
