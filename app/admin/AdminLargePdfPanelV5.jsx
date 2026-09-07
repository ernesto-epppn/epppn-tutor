"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

const BATCH_SIZE = 16;
const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 160;
const MAX_CHUNKS = 7500;
const OCR_ENGINE = "v5-direct-scan";
const OCR_SCRIPT_ID = "ernesto-tesseract-runtime-v5";
const OCR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

function humanSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "—";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} Go`;
  return `${(value / 1024 ** 2).toFixed(value >= 100 * 1024 ** 2 ? 0 : 1)} Mo`;
}

function fileTitle(name) {
  return String(name || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textStats(text) {
  const compact = String(text || "").replace(/\s/g, "");
  const words = String(text || "").match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]*/g) || [];
  const alnum = String(text || "").match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]/g) || [];
  return { compact: compact.length, words: words.length, alnum: alnum.length };
}

function usefulText(text, minCompact = 30) {
  const s = textStats(text);
  return s.compact >= minCompact && s.words >= 3 && s.alnum >= Math.max(20, Math.floor(s.compact * 0.22));
}

function scoreText(text, confidence = 0) {
  const s = textStats(text);
  return s.alnum + s.words * 6 + Math.max(0, Number(confidence || 0));
}

function nativeNeedsOcr(text) {
  const s = textStats(text);
  return s.compact < 160 || s.words < 14;
}

function splitText(text, pageStart, pageEnd, startIndex) {
  const chunks = [];
  let start = 0;
  let index = startIndex;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_SIZE);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const sentence = Math.max(text.lastIndexOf(". ", end), text.lastIndexOf("? ", end), text.lastIndexOf("! ", end));
      const best = Math.max(paragraph, sentence);
      if (best > start + Math.floor(CHUNK_SIZE * 0.58)) end = best + 1;
    }
    const content = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (content.length >= 70) chunks.push({ index: index++, content, page_start: pageStart, page_end: pageEnd });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function loadTesseract() {
  if (typeof window === "undefined") return Promise.reject(new Error("ocr_browser_only"));
  if (window.Tesseract?.createWorker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(OCR_SCRIPT_ID);
    if (existing) {
      if (window.Tesseract?.createWorker) return resolve();
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("ocr_runtime_unavailable")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = OCR_SCRIPT_ID;
    script.src = OCR_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => window.Tesseract?.createWorker ? resolve() : reject(new Error("ocr_runtime_unavailable"));
    script.onerror = () => reject(new Error("ocr_runtime_unavailable"));
    document.head.appendChild(script);
  });
}

function renderScale(page, targetPixels) {
  const base = page.getViewport({ scale: 1 });
  const area = Math.max(1, Number(base.width || 1) * Number(base.height || 1));
  return Math.max(2.2, Math.min(4.8, Math.sqrt(targetPixels / area)));
}

async function renderPdfPage(page, targetPixels = 12_000_000) {
  const viewport = page.getViewport({ scale: renderScale(page, targetPixels) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("ocr_canvas_unavailable");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, background: "white" }).promise;
  return canvas;
}

function canvasInkRatio(source) {
  if (!source?.width || !source?.height) return 0;
  const side = 72;
  const sample = document.createElement("canvas");
  sample.width = side;
  sample.height = side;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, side, side);
  ctx.drawImage(source, 0, 0, side, side);
  const data = ctx.getImageData(0, 0, side, side).data;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    if (lum < 246) ink += 1;
  }
  sample.width = 1;
  sample.height = 1;
  return ink / (side * side);
}

function enhancedCopy(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("ocr_canvas_unavailable");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = "grayscale(1) contrast(1.5) brightness(1.03)";
  ctx.drawImage(source, 0, 0);
  ctx.filter = "none";
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("scan_image_decode_failed"));
    image.src = src;
  });
}

async function pdfObject(page, name) {
  const stores = [page.objs, page.commonObjs].filter(Boolean);
  for (const store of stores) {
    try {
      if (store.has?.(name)) {
        const value = store.get(name);
        if (value) return value;
      }
    } catch {}
  }
  for (const store of stores) {
    const value = await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result || null);
      };
      const timer = window.setTimeout(() => finish(null), 1600);
      try {
        store.get(name, (result) => {
          window.clearTimeout(timer);
          finish(result);
        });
      } catch {
        window.clearTimeout(timer);
        finish(null);
      }
    });
    if (value) return value;
  }
  return null;
}

async function imageObjectToCanvas(image) {
  if (!image) return null;
  const width = Number(image.width || image.bitmap?.width || image.naturalWidth || 0);
  const height = Number(image.height || image.bitmap?.height || image.naturalHeight || 0);
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    const drawable = image.bitmap || image;
    if (drawable && !image.data) {
      ctx.drawImage(drawable, 0, 0, width, height);
      return canvas;
    }
  } catch {}

  if (image.src && typeof image.src === "string") {
    try {
      const decoded = await loadImage(image.src);
      ctx.drawImage(decoded, 0, 0, width, height);
      return canvas;
    } catch {}
  }

  const raw = image.data;
  if (!raw || !raw.length) {
    canvas.width = 1; canvas.height = 1;
    return null;
  }

  const pixels = width * height;
  const out = new Uint8ClampedArray(pixels * 4);
  if (raw.length >= pixels * 4) {
    for (let i = 0; i < pixels * 4; i += 1) out[i] = raw[i];
  } else if (raw.length >= pixels * 3) {
    for (let p = 0, i = 0, j = 0; p < pixels; p += 1, i += 3, j += 4) {
      out[j] = raw[i]; out[j + 1] = raw[i + 1]; out[j + 2] = raw[i + 2]; out[j + 3] = 255;
    }
  } else if (raw.length >= pixels) {
    for (let p = 0, j = 0; p < pixels; p += 1, j += 4) {
      const v = raw[p]; out[j] = v; out[j + 1] = v; out[j + 2] = v; out[j + 3] = 255;
    }
  } else {
    const rowBytes = Math.ceil(width / 8);
    if (raw.length < rowBytes * height) {
      canvas.width = 1; canvas.height = 1;
      return null;
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = raw[y * rowBytes + (x >> 3)];
        const bit = (byte >> (7 - (x & 7))) & 1;
        const v = bit ? 0 : 255;
        const j = (y * width + x) * 4;
        out[j] = v; out[j + 1] = v; out[j + 2] = v; out[j + 3] = 255;
      }
    }
  }
  ctx.putImageData(new ImageData(out, width, height), 0, 0);
  return canvas;
}

async function extractLargestEmbeddedScan(page, pdfjs) {
  const ops = await page.getOperatorList();
  const candidates = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] || [];
    if (fn === pdfjs.OPS.paintInlineImageXObject && args[0]) {
      candidates.push({ image: args[0] });
    } else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintJpegXObject || fn === pdfjs.OPS.paintImageXObjectRepeat) {
      const id = args[0];
      if (id && !candidates.some((item) => item.id === id)) candidates.push({ id });
    }
  }

  let best = null;
  let bestArea = 0;
  for (const candidate of candidates) {
    const image = candidate.image || await pdfObject(page, candidate.id);
    const area = Number(image?.width || image?.bitmap?.width || 0) * Number(image?.height || image?.bitmap?.height || 0);
    if (area <= bestArea) continue;
    const canvas = await imageObjectToCanvas(image);
    if (!canvas) continue;
    if (best) { best.width = 1; best.height = 1; }
    best = canvas;
    bestArea = area;
  }
  return best;
}

async function bestPageCanvas(page, pdfjs, targetPixels = 12_000_000) {
  const rendered = await renderPdfPage(page, targetPixels);
  const renderedInk = canvasInkRatio(rendered);
  if (renderedInk >= 0.004) return { canvas: rendered, direct: false, ink: renderedInk };

  try {
    const embedded = await extractLargestEmbeddedScan(page, pdfjs);
    if (embedded) {
      const embeddedInk = canvasInkRatio(embedded);
      if (embeddedInk > renderedInk + 0.002 || embedded.width * embedded.height > rendered.width * rendered.height) {
        rendered.width = 1; rendered.height = 1;
        return { canvas: embedded, direct: true, ink: embeddedInk };
      }
      embedded.width = 1; embedded.height = 1;
    }
  } catch (error) {
    console.warn("Direct scan extraction unavailable", error);
  }
  return { canvas: rendered, direct: false, ink: renderedInk };
}

function cropToJpeg(source, sx, sy, sw, sh) {
  const maxSide = 1700;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ocr_canvas_unavailable");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  let data = canvas.toDataURL("image/jpeg", 0.9);
  if (data.length > 1_350_000) data = canvas.toDataURL("image/jpeg", 0.74);
  canvas.width = 1; canvas.height = 1;
  return data;
}

function makeVisionTiles(source) {
  const w = source.width;
  const h = source.height;
  if (!w || !h) return [];
  const cropW = Math.round(w * 0.58);
  const cropH = Math.round(h * 0.42);
  const xs = [0, Math.max(0, w - cropW)];
  const ys = [0, Math.max(0, Math.round((h - cropH) / 2)), Math.max(0, h - cropH)];
  const tiles = [];
  for (const y of ys) for (const x of xs) tiles.push(cropToJpeg(source, x, y, cropW, cropH));
  return tiles;
}

function previewDataUrl(source) {
  const maxSide = 760;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.78);
  canvas.width = 1; canvas.height = 1;
  return data;
}

function diagnosticPages(total) {
  return [...new Set([
    Math.min(total, 12),
    Math.min(total, 32),
    Math.max(1, Math.min(total, Math.round(total * 0.25))),
  ])];
}

function jobLabel(job) {
  if (job.status === "indexed") return "Indexé ✓";
  if (job.status === "failed") return "Échec";
  return job.stage_label || "En cours";
}

export default function AdminLargePdfPanelV5() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("Référence externe validée par l’EPPPN");
  const [category, setCategory] = useState("Général");
  const [versionLabel, setVersionLabel] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [ocrLanguage, setOcrLanguage] = useState("eng");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("Prêt");
  const [pagesDone, setPagesDone] = useState(0);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [chunksDone, setChunksDone] = useState(0);
  const [localOcrPages, setLocalOcrPages] = useState(0);
  const [aiOcrPages, setAiOcrPages] = useState(0);
  const [directScanPages, setDirectScanPages] = useState(0);
  const [textPages, setTextPages] = useState(0);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const abortRef = useRef(false);
  const currentJobRef = useRef(null);

  async function accessToken() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function postKnowledge(body) {
    const token = await accessToken();
    if (!token) throw new Error("Session administrateur introuvable.");
    const response = await fetch("/api/admin/knowledge-large", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || "Indexation impossible.");
    return result;
  }

  async function aiOcr(imageDataUrls, pageNumber) {
    const token = await accessToken();
    if (!token) throw new Error("Session administrateur introuvable.");
    const response = await fetch("/api/admin/ocr-page", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image_data_urls: imageDataUrls, page_number: pageNumber, language: ocrLanguage, engine_version: OCR_ENGINE }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || "ocr_ai_failed");
    return result?.usable ? cleanText(result.text) : "";
  }

  async function loadJobs() {
    if (!supabase) return;
    setLoadingJobs(true);
    try {
      const token = await accessToken();
      if (!token) return;
      const response = await fetch("/api/admin/knowledge-large", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (response.ok) setJobs(Array.isArray(result.jobs) ? result.jobs : []);
    } finally {
      setLoadingJobs(false);
    }
  }

  useEffect(() => { void loadJobs(); }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function indexLargePdf(event) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(""); setPreview(""); setStage("Préparation");
    setPagesDone(0); setPagesTotal(0); setChunksDone(0); setLocalOcrPages(0); setAiOcrPages(0); setDirectScanPages(0); setTextPages(0);
    abortRef.current = false;

    let pdfDocument = null;
    let worker = null;
    let jobId = "";
    try {
      const started = await postKnowledge({
        action: "start",
        title: title.trim() || fileTitle(file.name) || "Document",
        source: source.trim() || "Référence externe validée par l’EPPPN",
        category: category.trim() || "Général",
        version_label: versionLabel.trim(),
        url: referenceUrl.trim(),
        file_name: file.name,
        file_size_bytes: file.size,
      });
      jobId = String(started.job_id || "");
      currentJobRef.current = jobId;

      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/legacy/build/pdf.worker.min.mjs";
      setStage("Lecture locale du PDF");
      const buffer = await file.arrayBuffer();
      pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
      const totalPages = Number(pdfDocument.numPages || 0);
      if (!totalPages) throw new Error("Le PDF ne contient aucune page lisible.");
      setPagesTotal(totalPages);
      await postKnowledge({ action: "progress", job_id: jobId, pages_total: totalPages, pages_done: 0, stage_label: `Diagnostic OCR ${OCR_ENGINE}` });

      const ensureWorker = async () => {
        if (worker) return worker;
        setStage("Activation OCR local");
        await loadTesseract();
        if (!window.Tesseract?.createWorker) throw new Error("ocr_runtime_unavailable");
        worker = await window.Tesseract.createWorker(ocrLanguage, 1, { logger: () => {} });
        if (worker.setParameters) await worker.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1", user_defined_dpi: "300" });
        return worker;
      };

      const readPage = async (pageNumber, allowAi = true, diagnostic = false) => {
        const page = await pdfDocument.getPage(pageNumber);
        let sourceCanvas = null;
        let enhanced = null;
        try {
          const textContent = await page.getTextContent();
          const nativeText = cleanText((textContent.items || []).map((item) => `${String(item?.str || "")}${item?.hasEOL ? "\n" : " "}`).join(""));
          if (!nativeNeedsOcr(nativeText) && usefulText(nativeText, 34)) return { text: nativeText, method: "native" };

          const pageCanvas = await bestPageCanvas(page, pdfjs, diagnostic ? 14_000_000 : 11_000_000);
          sourceCanvas = pageCanvas.canvas;
          if (pageCanvas.direct) setDirectScanPages((n) => n + 1);
          if (diagnostic) setPreview(previewDataUrl(sourceCanvas));

          enhanced = enhancedCopy(sourceCanvas);
          const w = await ensureWorker();
          const localResult = await w.recognize(enhanced);
          const localText = cleanText(localResult?.data?.text || "");
          setLocalOcrPages((n) => n + 1);
          let bestText = scoreText(localText, Number(localResult?.data?.confidence || 0)) > scoreText(nativeText, 0) ? localText : nativeText;
          if (usefulText(bestText, 38) || !allowAi) return { text: bestText, method: pageCanvas.direct ? "scan-direct" : "local" };

          const tiles = makeVisionTiles(sourceCanvas);
          if (!tiles.length) return { text: bestText, method: pageCanvas.direct ? "scan-direct" : "local" };
          setStage(`Secours IA · page ${pageNumber}/${totalPages}`);
          const visionText = await aiOcr(tiles, pageNumber).catch(() => "");
          setAiOcrPages((n) => n + 1);
          if (scoreText(visionText, 90) > scoreText(bestText, 0)) bestText = visionText;
          return { text: bestText, method: pageCanvas.direct ? "scan-direct+ia" : "ia" };
        } finally {
          if (enhanced) { enhanced.width = 1; enhanced.height = 1; }
          if (sourceCanvas) { sourceCanvas.width = 1; sourceCanvas.height = 1; }
          page.cleanup?.();
        }
      };

      let diagnosticOk = false;
      for (const pageNumber of diagnosticPages(totalPages)) {
        if (abortRef.current) throw new Error("indexation_cancelled");
        setStage(`Diagnostic scan · page ${pageNumber}/${totalPages}`);
        const result = await readPage(pageNumber, true, true);
        if (usefulText(result.text, 30)) { diagnosticOk = true; break; }
      }
      if (!diagnosticOk) {
        throw new Error("Le moteur OCR V5 ne récupère toujours aucun texte sur plusieurs pages réparties dans le livre. L’aperçu ci-dessous montre exactement l’image reçue par l’OCR : s’il est blanc ou incorrect, le PDF encode ses scans d’une manière particulière.");
      }

      let pending = [];
      let nextChunkIndex = 0;
      let textBuffer = "";
      let bufferPageStart = 1;
      let totalUsefulChars = 0;
      let pagesWithText = 0;

      const flushChunks = async (pageNumber) => {
        if (!pending.length) return;
        for (let i = 0; i < pending.length; i += BATCH_SIZE) {
          if (abortRef.current) throw new Error("indexation_cancelled");
          const batch = pending.slice(i, i + BATCH_SIZE);
          setStage(`Embeddings EPPPN · page ${pageNumber}/${totalPages}`);
          const result = await postKnowledge({ action: "batch", job_id: jobId, pages_done: pageNumber, chunks: batch });
          setChunksDone(Number(result?.chunks_done || 0));
        }
        pending = [];
      };

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        if (abortRef.current) throw new Error("indexation_cancelled");
        setStage(`Lecture · page ${pageNumber}/${totalPages}`);
        const result = await readPage(pageNumber, true, false);
        const cleaned = cleanText(result.text);
        if (usefulText(cleaned, 26)) {
          if (!textBuffer) bufferPageStart = pageNumber;
          textBuffer += `${textBuffer ? "\n\n" : ""}[Page ${pageNumber}]\n${cleaned}`;
          totalUsefulChars += cleaned.length;
          pagesWithText += 1;
          setTextPages(pagesWithText);
        }

        if (textBuffer.length >= 1000 || pageNumber === totalPages) {
          const chunks = splitText(textBuffer, bufferPageStart, pageNumber, nextChunkIndex);
          if (chunks.length) { pending.push(...chunks); nextChunkIndex += chunks.length; }
          textBuffer = "";
        }
        if (pending.length >= BATCH_SIZE) await flushChunks(pageNumber);
        if (nextChunkIndex > MAX_CHUNKS) throw new Error(`Ce PDF produit plus de ${MAX_CHUNKS} fragments. Séparez-le en volumes ou chapitres.`);

        setPagesDone(pageNumber);
        if (pageNumber % 4 === 0 || pageNumber === totalPages) {
          await postKnowledge({ action: "progress", job_id: jobId, pages_total: totalPages, pages_done: pageNumber, stage_label: `OCR V5 · ${pagesWithText} pages texte · ${nextChunkIndex} fragments` });
        }
      }

      if (pending.length) await flushChunks(totalPages);
      if (totalUsefulChars < 400 || nextChunkIndex === 0) throw new Error("Aucun corpus suffisamment exploitable n’a pu être construit à partir de ce PDF.");

      setStage("Finalisation de la base EPPPN");
      const finished = await postKnowledge({ action: "finish", job_id: jobId, pages_total: totalPages });
      setChunksDone(Number(finished?.chunks || nextChunkIndex));
      setPagesDone(totalPages);
      setStage("Indexé dans Ernesto ✓");
      await loadJobs();
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Indexation impossible.";
      if (message === "indexation_cancelled") {
        setStage("Import annulé");
        if (jobId) { try { await postKnowledge({ action: "cancel", job_id: jobId }); } catch {} }
      } else {
        setError(message);
        setStage("Indexation interrompue");
        if (jobId) { try { await postKnowledge({ action: "fail", job_id: jobId, error: message }); } catch {} }
      }
      await loadJobs();
    } finally {
      try { if (worker) await worker.terminate(); } catch {}
      try { if (pdfDocument) await pdfDocument.destroy(); } catch {}
      setBusy(false);
      abortRef.current = false;
      currentJobRef.current = null;
    }
  }

  function abortCurrent() {
    if (!busy || !currentJobRef.current) return;
    if (!window.confirm("Abandonner l’indexation en cours ? Les fragments temporaires seront supprimés.")) return;
    abortRef.current = true;
    setStage("Annulation en cours…");
  }

  async function clearJob(job) {
    if (!["failed", "extracting", "embedding", "preparing"].includes(job.status)) return;
    if (!window.confirm(`${job.status === "failed" ? "Nettoyer" : "Abandonner"} l’import « ${job.title} » ?`)) return;
    try { await postKnowledge({ action: "cancel", job_id: job.id }); await loadJobs(); }
    catch (err) { setError(err instanceof Error ? err.message : "Nettoyage impossible."); }
  }

  const percent = pagesTotal ? Math.min(100, Math.round((pagesDone / pagesTotal) * 100)) : 0;

  return (
    <section className="hybridOcrShell">
      <style>{css}</style>
      <div className="hybridCard">
        <div className="hybridHead">
          <div>
            <div className="eyebrow">Connaissances · grands PDF</div>
            <h2>Import OCR V5</h2>
            <p>Ernesto vérifie d’abord plusieurs pages réparties dans le livre. Si le rendu PDF est vide, il tente d’extraire directement la grande image scannée intégrée à la page, avant Tesseract et la vision IA.</p>
          </div>
          <div className="badge">V5 · extraction du scan</div>
        </div>

        <form className="hybridForm" onSubmit={indexLargePdf}>
          <label className={`drop ${file ? "selected" : ""}`}>
            <input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(e) => { const selected = e.target.files?.[0] || null; setFile(selected); setError(""); setPreview(""); if (selected && !title.trim()) setTitle(fileTitle(selected.name)); }} />
            <span className="pdfIcon">PDF</span>
            <div><strong>{file ? file.name : "Choisir un grand PDF"}</strong><small>{file ? humanSize(file.size) : "Manuels scannés et PDF volumineux"}</small></div>
          </label>
          <div className="meta">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre du document" disabled={busy} />
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source / provenance" disabled={busy} />
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}><option>Général</option><option>Pâte</option><option>Levain</option><option>Farines</option><option>Fermentation</option><option>Cuisson</option><option>Organisation</option><option>Recettes</option><option>Science & technique</option></select>
            <select value={ocrLanguage} onChange={(e) => setOcrLanguage(e.target.value)} disabled={busy}><option value="eng">OCR · Anglais</option><option value="fra">OCR · Français</option><option value="ita">OCR · Italien</option><option value="eng+fra">OCR · Anglais + français</option></select>
            <input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="Version / édition — facultatif" disabled={busy} />
            <input type="url" value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="Lien de référence — facultatif" disabled={busy} />
            <button className="primary" disabled={!file || busy}>{busy ? "Indexation en cours…" : "Indexer dans Ernesto"}</button>
          </div>
        </form>

        {busy || stage !== "Prêt" ? <div className={`progress ${error ? "failed" : stage.includes("✓") ? "done" : ""}`}>
          <div className="progressTop"><strong>{stage}</strong><span>{pagesTotal ? `${pagesDone}/${pagesTotal} pages` : "Préparation"} · {chunksDone} fragments · {textPages} pages texte · {localOcrPages} OCR local · {aiOcrPages} secours IA · {directScanPages} scans directs</span></div>
          <div className="track"><span style={{ width: `${stage.includes("✓") ? 100 : percent}%` }} /></div>
          <div className="progressFoot"><small>Le diagnostic V5 teste aussi des pages plus loin dans le livre : il ne suppose plus que les premières pages contiennent du texte.</small>{busy ? <button type="button" onClick={abortCurrent}>Abandonner</button> : null}</div>
        </div> : null}

        {error ? <div className="errorBox">{error}</div> : null}
        {preview ? <div className="previewBox"><div><strong>Aperçu réellement utilisé par l’OCR</strong><span>Diagnostic local — cet aperçu reste dans votre navigateur.</span></div><img src={preview} alt="Aperçu de la page utilisée pour le diagnostic OCR" /></div> : null}
        <div className="notes"><span>✓ Diagnostic réparti</span><span>✓ Extraction image intégrée</span><span>✓ OCR local</span><span>✓ Vision IA en dernier recours</span><span>✓ Aperçu diagnostic</span></div>

        <div className="jobsHead"><strong>Imports volumineux récents</strong><button type="button" onClick={() => void loadJobs()} disabled={loadingJobs}>{loadingJobs ? "…" : "Actualiser"}</button></div>
        <div className="jobs">
          {jobs.slice(0, 8).map((job) => {
            const jobPercent = job.pages_total ? Math.min(100, Math.round((Number(job.pages_done || 0) / job.pages_total) * 100)) : 0;
            const cleanable = ["failed", "extracting", "embedding", "preparing"].includes(job.status);
            return <div className="job" key={job.id}><div><strong>{job.title}</strong><span>{job.category || "Général"} · {humanSize(job.file_size_bytes)} · {job.chunks_done || 0} fragments</span></div><div className="jobState"><span>{jobLabel(job)}{job.status !== "indexed" && job.pages_total ? ` · ${jobPercent}%` : ""}</span>{cleanable ? <button type="button" onClick={() => void clearJob(job)}>{job.status === "failed" ? "Nettoyer" : "Abandonner"}</button> : null}</div></div>;
          })}
          {!loadingJobs && !jobs.length ? <div className="empty">Aucun import volumineux pour le moment.</div> : null}
        </div>
      </div>
    </section>
  );
}

const css = `
.hybridOcrShell{background:#f6f7f4;padding:0 clamp(18px,4vw,58px) 22px;font-family:var(--font-geist-sans),system-ui,sans-serif;color:#172132}.hybridCard{max-width:1380px;margin:0 auto;background:#fff;border:1px solid #e3e7df;border-radius:21px;box-shadow:0 10px 32px rgba(23,33,50,.045);padding:22px}.hybridHead{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.eyebrow{font-size:11px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#6f7d3c}.hybridHead h2{margin:5px 0 6px;font-size:25px;letter-spacing:-.035em}.hybridHead p{margin:0;max-width:900px;color:#64748b;line-height:1.55;font-size:14px}.badge{white-space:nowrap;border:1px solid #dbe4d2;background:#f3f7ef;color:#53653d;padding:8px 11px;border-radius:999px;font-size:11px;font-weight:850}.hybridForm{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(420px,1.2fr);gap:16px;margin-top:18px}.drop{min-height:165px;border:1.5px dashed #8d9d66;border-radius:18px;background:#f5f8f1;padding:20px;display:flex;align-items:center;gap:16px;cursor:pointer}.drop input{display:none}.drop.selected{border-style:solid}.pdfIcon{width:52px;height:52px;border-radius:15px;background:#435331;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:950;flex:0 0 auto}.drop strong{display:block;font-size:14px;line-height:1.4;overflow-wrap:anywhere}.drop small{display:block;margin-top:5px;color:#7e887b;font-size:11px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px}.meta input,.meta select{border:1px solid #dde3d9;background:#fbfcfa;border-radius:12px;padding:11px 13px;min-width:0;color:#172132;font:inherit}.meta input[type=url]{grid-column:1/-1}.primary{grid-column:1/-1;border:0;border-radius:13px;padding:12px 16px;background:#435331;color:#fff;font-weight:900;cursor:pointer}.primary:disabled{opacity:.5;cursor:not-allowed}.progress{margin-top:14px;border:1px solid #dfe5d9;background:#f8faf6;border-radius:15px;padding:13px}.progress.failed{border-color:#f3cec2;background:#fff5f1}.progress.done{border-color:#cddcbd;background:#f4f8ef}.progressTop{display:flex;justify-content:space-between;gap:12px;align-items:center;font-size:12px}.progressTop span{color:#6d786a}.track{height:7px;border-radius:999px;background:#e8ece4;overflow:hidden;margin-top:9px}.track span{height:100%;display:block;background:#6f7d3c;border-radius:999px;transition:width .28s ease}.progressFoot{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:8px}.progressFoot small{color:#7b8578;font-size:10px}.progressFoot button,.jobState button{border:1px solid #efcfc6;background:#fff6f3;color:#9a513d;border-radius:9px;padding:6px 9px;font-size:10px;font-weight:850;cursor:pointer}.errorBox{margin-top:12px;padding:11px 13px;border-radius:12px;background:#fff0eb;border:1px solid #f4d2c7;color:#9a503b;font-size:12px;font-weight:750}.previewBox{margin-top:12px;border:1px solid #dfe5d9;background:#fafbf9;border-radius:14px;padding:12px;display:grid;grid-template-columns:220px minmax(0,1fr);gap:14px;align-items:start}.previewBox div{display:grid;gap:4px}.previewBox strong{font-size:12px}.previewBox span{font-size:10px;color:#7a8477;line-height:1.45}.previewBox img{display:block;max-width:100%;max-height:430px;object-fit:contain;border-radius:10px;border:1px solid #e1e5df;background:white}.notes{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.notes span{font-size:10px;font-weight:800;color:#65715f;background:#f3f6f0;padding:5px 8px;border-radius:999px}.jobsHead{display:flex;justify-content:space-between;align-items:center;margin-top:19px;padding-top:16px;border-top:1px solid #e8ebe6}.jobsHead strong{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#687362}.jobsHead button{border:0;background:transparent;color:#52633f;font-weight:800;font-size:11px;cursor:pointer}.jobs{display:grid;gap:8px;margin-top:9px}.job{border:1px solid #e6e9e4;border-radius:13px;padding:11px 12px;display:flex;justify-content:space-between;gap:14px;align-items:center}.job>div:first-child{display:grid;gap:3px}.job strong{font-size:12px}.job span{font-size:10px;color:#778174}.jobState{display:flex;gap:8px;align-items:center}.jobState>span{font-weight:850;color:#53604f;white-space:nowrap}.empty{border:1px dashed #d8ddd5;border-radius:12px;padding:18px;text-align:center;color:#818a7e;font-size:12px}@media(max-width:860px){.hybridOcrShell{padding:0 12px 18px}.hybridCard{padding:16px;border-radius:18px}.hybridHead{display:grid}.badge{justify-self:start}.hybridForm{grid-template-columns:1fr}.drop{min-height:120px}.meta{grid-template-columns:1fr}.meta input[type=url],.primary{grid-column:auto}.progressTop,.job,.previewBox{align-items:flex-start;display:grid;grid-template-columns:1fr}.jobState{justify-content:space-between}.jobState>span{white-space:normal}}
`;