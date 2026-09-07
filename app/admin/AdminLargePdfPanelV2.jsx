"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

const BATCH_SIZE = 20;
const CHUNK_SIZE = 1850;
const CHUNK_OVERLAP = 170;
const MAX_CHUNKS = 7500;
const MIN_NATIVE_TEXT_CHARS = 120;
const OCR_SCRIPT_ID = "ernesto-tesseract-runtime";
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

function cleanPageText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textStats(text) {
  const compact = text.replace(/\s/g, "");
  const words = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]*/g) || [];
  const alnum = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]/g) || [];
  const suspicious = text.match(/[�□■◆◇]/g) || [];
  return { compact: compact.length, words: words.length, alnum: alnum.length, suspicious: suspicious.length };
}

function nativeTextNeedsOcr(text) {
  const s = textStats(text);
  return s.compact < MIN_NATIVE_TEXT_CHARS || (s.words < 12 && s.compact < 320);
}

function ocrQuality(text, confidence) {
  const s = textStats(text);
  const useful = s.compact >= 70 && s.words >= 7 && s.alnum >= Math.max(35, Math.floor(s.compact * 0.34));
  const score = s.alnum + s.words * 5 + Math.max(0, Number(confidence || 0)) * 2 - s.suspicious * 18;
  return { useful, score };
}

function splitPageText(text, page, startIndex) {
  const chunks = [];
  let start = 0;
  let index = startIndex;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_SIZE);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const sentence = Math.max(text.lastIndexOf(". ", end), text.lastIndexOf("? ", end), text.lastIndexOf("! ", end));
      const best = Math.max(paragraph, sentence);
      if (best > start + Math.floor(CHUNK_SIZE * 0.6)) end = best + 1;
    }
    const content = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (content.length >= 80) {
      chunks.push({ index, content, page_start: page, page_end: page });
      index += 1;
    }
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function loadTesseractRuntime() {
  if (typeof window === "undefined") return Promise.reject(new Error("ocr_browser_only"));
  if (window.Tesseract?.createWorker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(OCR_SCRIPT_ID);
    if (existing) {
      if (window.Tesseract?.createWorker) return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
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

function renderScale(page, enhanced) {
  const base = page.getViewport({ scale: 1 });
  let scale = enhanced ? 4.05 : 2.9;
  const maxPixels = enhanced ? 11000000 : 6500000;
  const projected = Number(base.width || 0) * Number(base.height || 0) * scale * scale;
  if (projected > maxPixels && projected > 0) scale *= Math.sqrt(maxPixels / projected);
  return enhanced ? Math.max(2.65, Math.min(4.15, scale)) : Math.max(2.15, Math.min(3.05, scale));
}

async function renderForOcr(page, enhanced) {
  const viewport = page.getViewport({ scale: renderScale(page, enhanced) });
  const raw = document.createElement("canvas");
  raw.width = Math.max(1, Math.ceil(viewport.width));
  raw.height = Math.max(1, Math.ceil(viewport.height));
  const rawContext = raw.getContext("2d", { willReadFrequently: true });
  if (!rawContext) throw new Error("ocr_canvas_unavailable");
  rawContext.fillStyle = "#fff";
  rawContext.fillRect(0, 0, raw.width, raw.height);
  await page.render({ canvasContext: rawContext, viewport, background: "white" }).promise;

  if (!enhanced) {
    return { canvas: raw, cleanup: () => { raw.width = 1; raw.height = 1; } };
  }

  const tuned = document.createElement("canvas");
  tuned.width = raw.width;
  tuned.height = raw.height;
  const ctx = tuned.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("ocr_canvas_unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, tuned.width, tuned.height);
  ctx.filter = "grayscale(1) contrast(1.55) brightness(1.04)";
  ctx.drawImage(raw, 0, 0);
  ctx.filter = "none";
  raw.width = 1;
  raw.height = 1;
  return { canvas: tuned, cleanup: () => { tuned.width = 1; tuned.height = 1; } };
}

function jobLabel(job) {
  if (job.status === "indexed") return "Indexé ✓";
  if (job.status === "failed") return "Échec";
  return job.stage_label || "En cours";
}

export default function AdminLargePdfPanelV2() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("EPPPN — document officiel");
  const [category, setCategory] = useState("Général");
  const [versionLabel, setVersionLabel] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [ocrLanguage, setOcrLanguage] = useState("eng+fra");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("Prêt");
  const [pagesDone, setPagesDone] = useState(0);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [chunksDone, setChunksDone] = useState(0);
  const [ocrPages, setOcrPages] = useState(0);
  const [enhancedPages, setEnhancedPages] = useState(0);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const currentJobRef = useRef(null);
  const abortRef = useRef(false);

  async function accessToken() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function api(body) {
    const token = await accessToken();
    if (!token) throw new Error("Session administrateur introuvable.");
    const response = await fetch("/api/admin/knowledge-large", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const labels = {
        document_already_exists: "Ce document est déjà indexé.",
        invalid_document_metadata: "Les informations du document sont incomplètes.",
        file_too_large: "Ce fichier dépasse la limite de sécurité de 2 Go.",
        no_indexed_chunks: "Aucun texte exploitable n’a pu être indexé.",
        openai_not_configured: "Le service d’indexation n’est pas configuré.",
        job_not_writable: "Cet import a été interrompu ou annulé.",
      };
      throw new Error(labels[result?.error] || result?.error || "Indexation impossible.");
    }
    return result;
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
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("Cette zone est réservée aux PDF.");
      return;
    }

    setBusy(true);
    setError("");
    setStage("Préparation");
    setPagesDone(0);
    setPagesTotal(0);
    setChunksDone(0);
    setOcrPages(0);
    setEnhancedPages(0);
    setOcrProgress(0);
    abortRef.current = false;

    let pdfDocument = null;
    let ocrWorker = null;
    let jobId = "";

    try {
      const start = await api({
        action: "start",
        title: title.trim() || fileTitle(file.name) || "Document EPPPN",
        source: source.trim() || "EPPPN — document officiel",
        category: category.trim() || "Général",
        version_label: versionLabel.trim(),
        url: referenceUrl.trim(),
        file_name: file.name,
        file_size_bytes: file.size,
      });
      jobId = String(start.job_id || "");
      currentJobRef.current = jobId;

      setStage("Lecture locale du PDF");
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/legacy/build/pdf.worker.min.mjs";
      const buffer = await file.arrayBuffer();
      pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
      const totalPages = Number(pdfDocument.numPages || 0);
      if (!totalPages) throw new Error("Le PDF ne contient aucune page lisible.");
      setPagesTotal(totalPages);
      await api({ action: "progress", job_id: jobId, pages_total: totalPages, pages_done: 0, stage_label: "Analyse du PDF et détection OCR" });

      let pending = [];
      let nextChunkIndex = 0;
      let totalTextChars = 0;
      let ocrCount = 0;
      let enhancedCount = 0;

      const flush = async (pageNumber) => {
        if (!pending.length) return;
        setStage(`Indexation EPPPN · ${nextChunkIndex} fragments préparés`);
        for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
          if (abortRef.current) throw new Error("indexation_cancelled");
          const batch = pending.slice(offset, offset + BATCH_SIZE);
          const result = await api({ action: "batch", job_id: jobId, pages_done: pageNumber, chunks: batch });
          setChunksDone(Number(result?.chunks_done || 0));
        }
        pending = [];
      };

      const getWorker = async () => {
        if (ocrWorker) return ocrWorker;
        setStage("Activation de l’OCR haute définition");
        await loadTesseractRuntime();
        if (!window.Tesseract?.createWorker) throw new Error("ocr_runtime_unavailable");
        ocrWorker = await window.Tesseract.createWorker(ocrLanguage, 1, {
          logger: (message) => {
            if (message.status === "recognizing text" && Number.isFinite(message.progress)) {
              setOcrProgress(Math.max(0, Math.min(1, Number(message.progress || 0))));
            }
          },
        });
        if (ocrWorker.setParameters) {
          await ocrWorker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1", user_defined_dpi: "300" });
        }
        return ocrWorker;
      };

      const recognizePass = async (page, pageNumber, enhanced) => {
        const worker = await getWorker();
        setOcrProgress(0);
        setStage(`${enhanced ? "OCR renforcé" : "OCR haute définition"} · page ${pageNumber}/${totalPages}`);
        const rendered = await renderForOcr(page, enhanced);
        try {
          const result = await worker.recognize(rendered.canvas);
          const text = cleanPageText(result?.data?.text || "");
          const confidence = Number(result?.data?.confidence || 0);
          return { text, confidence, quality: ocrQuality(text, confidence) };
        } finally {
          rendered.cleanup();
        }
      };

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        if (abortRef.current) throw new Error("indexation_cancelled");
        setStage(`Analyse · page ${pageNumber}/${totalPages}`);
        const page = await pdfDocument.getPage(pageNumber);
        try {
          const textContent = await page.getTextContent();
          const nativeText = cleanPageText((textContent.items || []).map((item) => `${String(item?.str || "")}${item?.hasEOL ? "\n" : " "}`).join(""));
          let pageText = nativeText;

          if (nativeTextNeedsOcr(nativeText)) {
            let first = await recognizePass(page, pageNumber, false);
            let best = first;
            let retried = false;
            const retryNeeded = !first.quality.useful || first.text.length < 180 || (first.confidence < 30 && first.text.length < 600);
            if (retryNeeded) {
              retried = true;
              const second = await recognizePass(page, pageNumber, true);
              if (second.quality.score > best.quality.score) best = second;
            }
            if (best.quality.useful && best.text.length > pageText.length) pageText = best.text;
            ocrCount += 1;
            setOcrPages(ocrCount);
            if (retried) {
              enhancedCount += 1;
              setEnhancedPages(enhancedCount);
            }
          }

          const stats = textStats(pageText);
          if (stats.compact >= 70) {
            totalTextChars += pageText.length;
            const pageChunks = splitPageText(pageText, pageNumber, nextChunkIndex);
            if (pageChunks.length) {
              pending.push(...pageChunks);
              nextChunkIndex += pageChunks.length;
            }
          }

          if (nextChunkIndex > MAX_CHUNKS) throw new Error(`Ce PDF produit plus de ${MAX_CHUNKS} fragments. Séparez-le en volumes ou chapitres.`);
          setPagesDone(pageNumber);
          if (pending.length >= BATCH_SIZE || pageNumber === totalPages) await flush(pageNumber);

          if (pageNumber % 5 === 0 || pageNumber === totalPages) {
            await api({
              action: "progress",
              job_id: jobId,
              pages_total: totalPages,
              pages_done: pageNumber,
              stage_label: ocrCount ? `OCR HD · ${pageNumber}/${totalPages} pages · ${enhancedCount} renforcées` : `Extraction du texte · ${pageNumber}/${totalPages} pages`,
            });
          }
        } finally {
          page.cleanup?.();
        }
      }

      if (totalTextChars < 800 || nextChunkIndex === 0) {
        throw new Error(ocrCount ? "L’OCR haute définition n’a pas retrouvé assez de texte exploitable. Essayez une autre langue OCR." : "Le PDF ne contient pas assez de texte exploitable pour le RAG.");
      }

      setStage("Finalisation de la base EPPPN");
      const finished = await api({ action: "finish", job_id: jobId, pages_total: totalPages });
      setChunksDone(Number(finished?.chunks || nextChunkIndex));
      setPagesDone(totalPages);
      setOcrProgress(1);
      setStage("Indexé dans Ernesto ✓");
      await loadJobs();
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Indexation impossible.";
      if (message === "indexation_cancelled") {
        setStage("Import annulé");
        if (jobId) { try { await api({ action: "cancel", job_id: jobId }); } catch {} }
      } else {
        setError(message);
        setStage("Indexation interrompue");
        if (jobId) { try { await api({ action: "fail", job_id: jobId, error: message }); } catch {} }
      }
      await loadJobs();
    } finally {
      try { if (ocrWorker) await ocrWorker.terminate(); } catch {}
      try { if (pdfDocument) await pdfDocument.destroy(); } catch {}
      setBusy(false);
      currentJobRef.current = null;
      abortRef.current = false;
    }
  }

  function abortCurrent() {
    if (!busy || !currentJobRef.current) return;
    if (!window.confirm("Abandonner l’indexation en cours ? Les fragments temporaires seront supprimés.")) return;
    abortRef.current = true;
    setStage("Annulation en cours…");
  }

  async function clearJob(job) {
    const running = ["extracting", "embedding", "preparing"].includes(job.status);
    if (!window.confirm(`${running ? "Abandonner" : "Nettoyer"} l’import « ${job.title} » ?`)) return;
    try {
      await api({ action: "cancel", job_id: job.id });
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nettoyage impossible.");
    }
  }

  const percent = pagesTotal ? Math.min(100, Math.round((pagesDone / pagesTotal) * 100)) : 0;

  return (
    <section className="largePdfShell">
      <style>{css}</style>
      <div className="largePdfCard">
        <div className="largePdfHead">
          <div>
            <div className="largePdfEyebrow">Connaissances · grands PDF</div>
            <h2>Import OCR haute définition</h2>
            <p>Les pages scannées sont rendues à une résolution nettement supérieure. Si la première lecture reste faible, Ernesto relance automatiquement la page avec contraste renforcé avant de créer les fragments RAG.</p>
          </div>
          <div className="localBadge">OCR local · 2 passes</div>
        </div>

        <form className="largePdfForm" onSubmit={indexLargePdf}>
          <label className={`largeDrop ${file ? "selected" : ""}`}>
            <input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(e) => {
              const selected = e.target.files?.[0] || null;
              setFile(selected);
              setError("");
              if (selected && !title.trim()) setTitle(fileTitle(selected.name));
            }} />
            <span className="largePdfIcon">PDF</span>
            <div><strong>{file ? file.name : "Choisir un grand PDF"}</strong><small>{file ? humanSize(file.size) : "Manuels et ouvrages volumineux · traitement local"}</small></div>
          </label>

          <div className="largeMeta">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre du document" disabled={busy} />
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source" disabled={busy} />
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}><option>Général</option><option>Pâte</option><option>Levain</option><option>Farines</option><option>Fermentation</option><option>Cuisson</option><option>Organisation</option><option>Recettes</option><option>Science & technique</option></select>
            <select value={ocrLanguage} onChange={(e) => setOcrLanguage(e.target.value)} disabled={busy}><option value="eng+fra">OCR · Français + anglais</option><option value="fra">OCR · Français</option><option value="eng">OCR · Anglais</option><option value="ita">OCR · Italien</option><option value="fra+eng+ita">OCR · FR + EN + IT</option></select>
            <input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="Version / édition — facultatif" disabled={busy} />
            <input type="url" value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="Lien de référence — facultatif" disabled={busy} />
            <button className="largePrimary" disabled={!file || busy}>{busy ? "Indexation en cours…" : "Indexer dans Ernesto"}</button>
          </div>
        </form>

        {busy || stage !== "Prêt" ? <div className={`largeProgress ${error ? "failed" : stage.includes("✓") ? "done" : ""}`}>
          <div className="largeProgressTop"><strong>{stage}</strong><span>{pagesTotal ? `${pagesDone}/${pagesTotal} pages` : "Préparation"} · {chunksDone} fragments{ocrPages ? ` · ${ocrPages} OCR` : ""}{enhancedPages ? ` · ${enhancedPages} renforcées` : ""}</span></div>
          <div className="largeProgressTrack"><span style={{ width: `${stage.includes("✓") ? 100 : percent}%` }} /></div>
          {stage.startsWith("OCR") ? <div className="ocrMiniTrack"><span style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div> : null}
          <div className="progressFoot"><small>{busy ? "Gardez cet onglet ouvert. Un scan dense peut demander plusieurs secondes par page." : ""}</small>{busy ? <button type="button" className="abortButton" onClick={abortCurrent}>Abandonner</button> : null}</div>
        </div> : null}

        {error ? <div className="largeError">{error}</div> : null}

        <div className="largeNotes"><span>✓ OCR ~200–300 dpi</span><span>✓ Seconde passe automatique</span><span>✓ Contraste renforcé</span><span>✓ Indexation par lots</span></div>

        <div className="largeJobsHead"><strong>Imports volumineux récents</strong><button type="button" onClick={() => void loadJobs()} disabled={loadingJobs}>{loadingJobs ? "…" : "Actualiser"}</button></div>
        <div className="largeJobs">
          {jobs.slice(0, 8).map((job) => {
            const jobPercent = job.pages_total ? Math.min(100, Math.round((Number(job.pages_done || 0) / job.pages_total) * 100)) : 0;
            const cleanable = ["failed", "extracting", "embedding", "preparing"].includes(job.status);
            return <div className={`largeJob status-${job.status}`} key={job.id}><div><strong>{job.title}</strong><span>{job.category || "Général"} · {humanSize(job.file_size_bytes)} · {job.chunks_done || 0} fragments</span></div><div className="largeJobState"><span>{jobLabel(job)}{job.status !== "indexed" && job.pages_total ? ` · ${jobPercent}%` : ""}</span>{cleanable ? <button type="button" onClick={() => void clearJob(job)}>{job.status === "failed" ? "Nettoyer" : "Abandonner"}</button> : null}</div></div>;
          })}
          {!loadingJobs && !jobs.length ? <div className="largeEmpty">Aucun import volumineux pour le moment.</div> : null}
        </div>
      </div>
    </section>
  );
}

const css = `
.largePdfShell{background:#f6f7f4;padding:0 clamp(18px,4vw,58px) 22px;font-family:var(--font-geist-sans),system-ui,sans-serif;color:#172132}.largePdfCard{max-width:1380px;margin:0 auto;background:#fff;border:1px solid #e3e7df;border-radius:21px;box-shadow:0 10px 32px rgba(23,33,50,.045);padding:22px}.largePdfHead{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.largePdfEyebrow{font-size:11px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#6f7d3c}.largePdfHead h2{margin:5px 0 6px;font-size:25px;letter-spacing:-.035em}.largePdfHead p{margin:0;max-width:900px;color:#64748b;line-height:1.55;font-size:14px}.localBadge{white-space:nowrap;border:1px solid #dbe4d2;background:#f3f7ef;color:#53653d;padding:8px 11px;border-radius:999px;font-size:11px;font-weight:850}.largePdfForm{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(420px,1.2fr);gap:16px;margin-top:18px}.largeDrop{min-height:165px;border:1.5px dashed #8d9d66;border-radius:18px;background:#f5f8f1;padding:20px;display:flex;align-items:center;gap:16px;cursor:pointer}.largeDrop input{display:none}.largeDrop.selected{border-style:solid;background:#f2f6ed}.largePdfIcon{width:52px;height:52px;border-radius:15px;background:#435331;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:950;flex:0 0 auto}.largeDrop strong{display:block;font-size:14px;line-height:1.4;overflow-wrap:anywhere}.largeDrop small{display:block;margin-top:5px;color:#7e887b;font-size:11px}.largeMeta{display:grid;grid-template-columns:1fr 1fr;gap:10px}.largeMeta input,.largeMeta select{border:1px solid #dde3d9;background:#fbfcfa;border-radius:12px;padding:11px 13px;min-width:0;color:#172132;font:inherit}.largeMeta input[type=url]{grid-column:1/-1}.largePrimary{grid-column:1/-1;border:0;border-radius:13px;padding:12px 16px;background:#435331;color:#fff;font-weight:900;cursor:pointer}.largePrimary:disabled{opacity:.5;cursor:not-allowed}.largeProgress{margin-top:14px;border:1px solid #dfe5d9;background:#f8faf6;border-radius:15px;padding:13px}.largeProgress.failed{border-color:#f3cec2;background:#fff5f1}.largeProgress.done{border-color:#cddcbd;background:#f4f8ef}.largeProgressTop{display:flex;justify-content:space-between;gap:12px;align-items:center;font-size:12px}.largeProgressTop span{color:#6d786a}.largeProgressTrack,.ocrMiniTrack{height:7px;border-radius:999px;background:#e8ece4;overflow:hidden;margin-top:9px}.largeProgressTrack span,.ocrMiniTrack span{height:100%;display:block;background:#6f7d3c;border-radius:999px;transition:width .28s ease}.ocrMiniTrack{height:4px}.ocrMiniTrack span{background:#455b6d}.progressFoot{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:8px}.progressFoot small{color:#7b8578;font-size:10px}.abortButton{border:1px solid #efcfc6;background:#fff6f3;color:#9a513d;border-radius:9px;padding:6px 9px;font-size:10px;font-weight:850;cursor:pointer}.largeError{margin-top:12px;padding:11px 13px;border-radius:12px;background:#fff0eb;border:1px solid #f4d2c7;color:#9a503b;font-size:12px;font-weight:750}.largeNotes{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.largeNotes span{font-size:10px;font-weight:800;color:#65715f;background:#f3f6f0;padding:5px 8px;border-radius:999px}.largeJobsHead{display:flex;justify-content:space-between;align-items:center;margin-top:19px;padding-top:16px;border-top:1px solid #e8ebe6}.largeJobsHead strong{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#687362}.largeJobsHead button{border:0;background:transparent;color:#52633f;font-weight:800;font-size:11px;cursor:pointer}.largeJobs{display:grid;gap:8px;margin-top:9px}.largeJob{border:1px solid #e6e9e4;border-radius:13px;padding:11px 12px;display:flex;justify-content:space-between;gap:14px;align-items:center}.largeJob>div:first-child{display:grid;gap:3px}.largeJob strong{font-size:12px}.largeJob span{font-size:10px;color:#778174}.largeJobState{display:flex;gap:8px;align-items:center}.largeJobState>span{font-weight:850;color:#53604f;white-space:nowrap}.largeJobState button{border:1px solid #f1d4ca;background:#fff6f3;color:#9a513d;border-radius:9px;padding:5px 8px;font-size:10px;font-weight:850;cursor:pointer}.largeEmpty{border:1px dashed #d8ddd5;border-radius:12px;padding:18px;text-align:center;color:#818a7e;font-size:12px}@media(max-width:860px){.largePdfShell{padding:0 12px 18px}.largePdfCard{padding:16px;border-radius:18px}.largePdfHead{display:grid}.localBadge{justify-self:start}.largePdfForm{grid-template-columns:1fr}.largeDrop{min-height:120px}.largeMeta{grid-template-columns:1fr}.largeMeta input[type=url],.largePrimary{grid-column:auto}.largeProgressTop,.largeJob{align-items:flex-start;display:grid}.largeJobState{justify-content:space-between}.largeJobState>span{white-space:normal}}
`;
