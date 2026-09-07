"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

const BATCH_SIZE = 20;
const CHUNK_SIZE = 1850;
const CHUNK_OVERLAP = 170;
const MAX_CHUNKS = 7500;
const OCR_SCRIPT_ID = "ernesto-tesseract-runtime-v3";
const OCR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const EARLY_DIAGNOSTIC_PAGES = 14;

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
  const compact = text.replace(/\s/g, "");
  const words = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]*/g) || [];
  const alnum = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]/g) || [];
  return { compact: compact.length, words: words.length, alnum: alnum.length };
}

function usefulText(text, minCompact = 45) {
  const s = textStats(text);
  return s.compact >= minCompact && s.words >= 4 && s.alnum >= Math.max(28, Math.floor(s.compact * 0.28));
}

function nativeNeedsOcr(text) {
  const s = textStats(text);
  return s.compact < 140 || s.words < 12;
}

function scoreText(text, confidence = 0) {
  const s = textStats(text);
  return s.alnum + s.words * 6 + Math.max(0, Number(confidence || 0)) * 1.5;
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
    if (content.length >= 80) chunks.push({ index: index++, content, page_start: pageStart, page_end: pageEnd });
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

function pageScale(page, enhanced) {
  const base = page.getViewport({ scale: 1 });
  let scale = enhanced ? 3.5 : 2.7;
  const maxPixels = enhanced ? 9_000_000 : 6_000_000;
  const projected = Number(base.width || 0) * Number(base.height || 0) * scale * scale;
  if (projected > maxPixels && projected > 0) scale *= Math.sqrt(maxPixels / projected);
  return Math.max(enhanced ? 2.5 : 2.0, Math.min(enhanced ? 3.7 : 2.9, scale));
}

async function renderPage(page, enhanced) {
  const viewport = page.getViewport({ scale: pageScale(page, enhanced) });
  const raw = document.createElement("canvas");
  raw.width = Math.max(1, Math.ceil(viewport.width));
  raw.height = Math.max(1, Math.ceil(viewport.height));
  const rc = raw.getContext("2d", { willReadFrequently: true });
  if (!rc) throw new Error("ocr_canvas_unavailable");
  rc.fillStyle = "white";
  rc.fillRect(0, 0, raw.width, raw.height);
  await page.render({ canvasContext: rc, viewport, background: "white" }).promise;
  if (!enhanced) return raw;

  const tuned = document.createElement("canvas");
  tuned.width = raw.width;
  tuned.height = raw.height;
  const tc = tuned.getContext("2d", { willReadFrequently: true });
  if (!tc) throw new Error("ocr_canvas_unavailable");
  tc.fillStyle = "white";
  tc.fillRect(0, 0, tuned.width, tuned.height);
  tc.filter = "grayscale(1) contrast(1.8) brightness(1.08)";
  tc.drawImage(raw, 0, 0);
  tc.filter = "none";
  raw.width = 1;
  raw.height = 1;
  return tuned;
}

function canvasToCompactJpeg(canvas) {
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("ocr_canvas_unavailable");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  const data = out.toDataURL("image/jpeg", 0.78);
  out.width = 1;
  out.height = 1;
  return data;
}

function jobLabel(job) {
  if (job.status === "indexed") return "Indexé ✓";
  if (job.status === "failed") return "Échec";
  return job.stage_label || "En cours";
}

export default function AdminLargePdfPanelV3() {
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
  const [ocrLanguage, setOcrLanguage] = useState("eng");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("Prêt");
  const [pagesDone, setPagesDone] = useState(0);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [chunksDone, setChunksDone] = useState(0);
  const [localOcrPages, setLocalOcrPages] = useState(0);
  const [aiOcrPages, setAiOcrPages] = useState(0);
  const [textPages, setTextPages] = useState(0);
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

  async function knowledgeApi(body) {
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

  async function aiOcr(imageDataUrl, pageNumber) {
    const token = await accessToken();
    if (!token) throw new Error("Session administrateur introuvable.");
    const response = await fetch("/api/admin/ocr-page", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image_data_url: imageDataUrl, page_number: pageNumber, language: ocrLanguage }),
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
    setError("");
    setStage("Préparation");
    setPagesDone(0); setPagesTotal(0); setChunksDone(0); setLocalOcrPages(0); setAiOcrPages(0); setTextPages(0);
    abortRef.current = false;

    let pdfDocument = null;
    let worker = null;
    let jobId = "";

    try {
      const start = await knowledgeApi({
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

      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/legacy/build/pdf.worker.min.mjs";
      setStage("Lecture locale du PDF");
      const buffer = await file.arrayBuffer();
      pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
      const totalPages = Number(pdfDocument.numPages || 0);
      if (!totalPages) throw new Error("Le PDF ne contient aucune page lisible.");
      setPagesTotal(totalPages);
      await knowledgeApi({ action: "progress", job_id: jobId, pages_total: totalPages, pages_done: 0, stage_label: "Analyse OCR hybride" });

      let pending = [];
      let nextChunkIndex = 0;
      let bufferText = "";
      let bufferPageStart = 1;
      let totalUsefulChars = 0;
      let pagesWithText = 0;
      let localCount = 0;
      let aiCount = 0;

      const flushChunks = async (pageNumber) => {
        if (!pending.length) return;
        for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
          if (abortRef.current) throw new Error("indexation_cancelled");
          const batch = pending.slice(offset, offset + BATCH_SIZE);
          setStage(`Embeddings EPPPN · page ${pageNumber}/${totalPages}`);
          const result = await knowledgeApi({ action: "batch", job_id: jobId, pages_done: pageNumber, chunks: batch });
          setChunksDone(Number(result?.chunks_done || 0));
        }
        pending = [];
      };

      const pushPageText = async (pageText, pageNumber) => {
        const cleaned = cleanText(pageText);
        if (!usefulText(cleaned, 28)) return;
        if (!bufferText) bufferPageStart = pageNumber;
        bufferText += `${bufferText ? "\n\n" : ""}[Page ${pageNumber}]\n${cleaned}`;
        totalUsefulChars += cleaned.length;
        pagesWithText += 1;
        setTextPages(pagesWithText);

        if (bufferText.length >= 1250 || pageNumber === totalPages) {
          const chunks = splitText(bufferText, bufferPageStart, pageNumber, nextChunkIndex);
          if (chunks.length) {
            pending.push(...chunks);
            nextChunkIndex += chunks.length;
          }
          bufferText = "";
        }
        if (pending.length >= BATCH_SIZE) await flushChunks(pageNumber);
      };

      const ensureWorker = async () => {
        if (worker) return worker;
        setStage("Activation OCR local");
        await loadTesseract();
        if (!window.Tesseract?.createWorker) throw new Error("ocr_runtime_unavailable");
        worker = await window.Tesseract.createWorker(ocrLanguage, 1, { logger: () => {} });
        return worker;
      };

      const localRecognize = async (page, pageNumber, enhanced) => {
        const w = await ensureWorker();
        if (w.setParameters) {
          await w.setParameters({
            tessedit_pageseg_mode: enhanced ? "11" : "3",
            preserve_interword_spaces: "1",
            user_defined_dpi: enhanced ? "300" : "240",
          });
        }
        setStage(`${enhanced ? "OCR local · texte dispersé" : "OCR local"} · ${pageNumber}/${totalPages}`);
        const canvas = await renderPage(page, enhanced);
        try {
          const result = await w.recognize(canvas);
          return { text: cleanText(result?.data?.text || ""), confidence: Number(result?.data?.confidence || 0), canvas };
        } catch (err) {
          canvas.width = 1; canvas.height = 1;
          throw err;
        }
      };

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        if (abortRef.current) throw new Error("indexation_cancelled");
        setStage(`Analyse · page ${pageNumber}/${totalPages}`);
        const page = await pdfDocument.getPage(pageNumber);
        try {
          const textContent = await page.getTextContent();
          const nativeText = cleanText((textContent.items || []).map((item) => `${String(item?.str || "")}${item?.hasEOL ? "\n" : " "}`).join(""));
          let bestText = nativeText;

          if (nativeNeedsOcr(nativeText)) {
            localCount += 1;
            setLocalOcrPages(localCount);

            const first = await localRecognize(page, pageNumber, false);
            const firstScore = scoreText(first.text, first.confidence);
            first.canvas.width = 1; first.canvas.height = 1;
            if (firstScore > scoreText(bestText, 0)) bestText = first.text;

            if (!usefulText(bestText, 55)) {
              const second = await localRecognize(page, pageNumber, true);
              const secondScore = scoreText(second.text, second.confidence);
              const secondCanvas = second.canvas;
              if (secondScore > scoreText(bestText, 0)) bestText = second.text;

              if (!usefulText(bestText, 55)) {
                setStage(`Secours IA · page ${pageNumber}/${totalPages}`);
                const dataUrl = canvasToCompactJpeg(secondCanvas);
                try {
                  const visionText = await aiOcr(dataUrl, pageNumber);
                  aiCount += 1;
                  setAiOcrPages(aiCount);
                  if (scoreText(visionText, 80) > scoreText(bestText, 0)) bestText = visionText;
                } catch (visionError) {
                  console.warn("AI OCR fallback failed on page", pageNumber, visionError);
                }
              }
              secondCanvas.width = 1; secondCanvas.height = 1;
            }
          }

          await pushPageText(bestText, pageNumber);
          setPagesDone(pageNumber);

          if (pageNumber === EARLY_DIAGNOSTIC_PAGES && pagesWithText === 0) {
            throw new Error("Même le secours OCR par vision n’a extrait aucun texte sur les premières pages. L’import a été arrêté automatiquement pour éviter de traiter inutilement tout le livre.");
          }

          if (pageNumber % 5 === 0 || pageNumber === totalPages) {
            await knowledgeApi({
              action: "progress",
              job_id: jobId,
              pages_total: totalPages,
              pages_done: pageNumber,
              stage_label: `OCR hybride · ${pagesWithText} pages texte · ${aiCount} secours IA`,
            });
          }
        } finally {
          page.cleanup?.();
        }
      }

      if (bufferText) {
        const chunks = splitText(bufferText, bufferPageStart, totalPages, nextChunkIndex);
        if (chunks.length) { pending.push(...chunks); nextChunkIndex += chunks.length; }
      }
      if (pending.length) await flushChunks(totalPages);

      if (nextChunkIndex > MAX_CHUNKS) throw new Error(`Ce PDF produit plus de ${MAX_CHUNKS} fragments. Séparez-le en volumes ou chapitres.`);
      if (totalUsefulChars < 500 || nextChunkIndex === 0) throw new Error("Aucun corpus suffisamment exploitable n’a pu être construit à partir de ce PDF.");

      setStage("Finalisation de la base EPPPN");
      const finished = await knowledgeApi({ action: "finish", job_id: jobId, pages_total: totalPages });
      setChunksDone(Number(finished?.chunks || nextChunkIndex));
      setPagesDone(totalPages);
      setStage("Indexé dans Ernesto ✓");
      await loadJobs();
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Indexation impossible.";
      if (message === "indexation_cancelled") {
        setStage("Import annulé");
        if (jobId) { try { await knowledgeApi({ action: "cancel", job_id: jobId }); } catch {} }
      } else {
        setError(message);
        setStage("Indexation interrompue");
        if (jobId) { try { await knowledgeApi({ action: "fail", job_id: jobId, error: message }); } catch {} }
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
    const running = ["extracting", "embedding", "preparing"].includes(job.status);
    if (!window.confirm(`${running ? "Abandonner" : "Nettoyer"} l’import « ${job.title} » ?`)) return;
    try {
      await knowledgeApi({ action: "cancel", job_id: job.id });
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nettoyage impossible.");
    }
  }

  const percent = pagesTotal ? Math.min(100, Math.round((pagesDone / pagesTotal) * 100)) : 0;

  return (
    <section className="hybridOcrShell">
      <style>{css}</style>
      <div className="hybridCard">
        <div className="hybridHead">
          <div>
            <div className="eyebrow">Connaissances · grands PDF</div>
            <h2>Import OCR hybride</h2>
            <p>Ernesto essaie d’abord le texte natif et l’OCR local. Si une page reste illisible, seule cette page passe automatiquement au secours visuel OpenAI, puis le texte est indexé dans le RAG EPPPN.</p>
          </div>
          <div className="badge">Local + secours IA</div>
        </div>

        <form className="hybridForm" onSubmit={indexLargePdf}>
          <label className={`drop ${file ? "selected" : ""}`}>
            <input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(e) => {
              const selected = e.target.files?.[0] || null;
              setFile(selected); setError("");
              if (selected && !title.trim()) setTitle(fileTitle(selected.name));
            }} />
            <span className="pdfIcon">PDF</span>
            <div><strong>{file ? file.name : "Choisir un grand PDF"}</strong><small>{file ? humanSize(file.size) : "Manuels scannés et PDF volumineux"}</small></div>
          </label>
          <div className="meta">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre du document" disabled={busy} />
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source" disabled={busy} />
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}><option>Général</option><option>Pâte</option><option>Levain</option><option>Farines</option><option>Fermentation</option><option>Cuisson</option><option>Organisation</option><option>Recettes</option><option>Science & technique</option></select>
            <select value={ocrLanguage} onChange={(e) => setOcrLanguage(e.target.value)} disabled={busy}><option value="eng">OCR · Anglais</option><option value="fra">OCR · Français</option><option value="ita">OCR · Italien</option><option value="eng+fra">OCR · Anglais + français</option></select>
            <input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="Version / édition — facultatif" disabled={busy} />
            <input type="url" value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="Lien de référence — facultatif" disabled={busy} />
            <button className="primary" disabled={!file || busy}>{busy ? "Indexation en cours…" : "Indexer dans Ernesto"}</button>
          </div>
        </form>

        {busy || stage !== "Prêt" ? <div className={`progress ${error ? "failed" : stage.includes("✓") ? "done" : ""}`}>
          <div className="progressTop"><strong>{stage}</strong><span>{pagesTotal ? `${pagesDone}/${pagesTotal} pages` : "Préparation"} · {chunksDone} fragments · {textPages} pages texte · {localOcrPages} OCR local · {aiOcrPages} secours IA</span></div>
          <div className="track"><span style={{ width: `${stage.includes("✓") ? 100 : percent}%` }} /></div>
          <div className="progressFoot"><small>Le secours IA n’est utilisé que lorsqu’une page résiste à l’OCR local.</small>{busy ? <button type="button" onClick={abortCurrent}>Abandonner</button> : null}</div>
        </div> : null}

        {error ? <div className="errorBox">{error}</div> : null}
        <div className="notes"><span>✓ Détection automatique</span><span>✓ OCR local</span><span>✓ Vision IA en dernier recours</span><span>✓ Regroupement des pages peu textuelles</span><span>✓ Arrêt diagnostic précoce</span></div>

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
.hybridOcrShell{background:#f6f7f4;padding:0 clamp(18px,4vw,58px) 22px;font-family:var(--font-geist-sans),system-ui,sans-serif;color:#172132}.hybridCard{max-width:1380px;margin:0 auto;background:#fff;border:1px solid #e3e7df;border-radius:21px;box-shadow:0 10px 32px rgba(23,33,50,.045);padding:22px}.hybridHead{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.eyebrow{font-size:11px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#6f7d3c}.hybridHead h2{margin:5px 0 6px;font-size:25px;letter-spacing:-.035em}.hybridHead p{margin:0;max-width:900px;color:#64748b;line-height:1.55;font-size:14px}.badge{white-space:nowrap;border:1px solid #dbe4d2;background:#f3f7ef;color:#53653d;padding:8px 11px;border-radius:999px;font-size:11px;font-weight:850}.hybridForm{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(420px,1.2fr);gap:16px;margin-top:18px}.drop{min-height:165px;border:1.5px dashed #8d9d66;border-radius:18px;background:#f5f8f1;padding:20px;display:flex;align-items:center;gap:16px;cursor:pointer}.drop input{display:none}.drop.selected{border-style:solid}.pdfIcon{width:52px;height:52px;border-radius:15px;background:#435331;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:950;flex:0 0 auto}.drop strong{display:block;font-size:14px;line-height:1.4;overflow-wrap:anywhere}.drop small{display:block;margin-top:5px;color:#7e887b;font-size:11px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px}.meta input,.meta select{border:1px solid #dde3d9;background:#fbfcfa;border-radius:12px;padding:11px 13px;min-width:0;color:#172132;font:inherit}.meta input[type=url]{grid-column:1/-1}.primary{grid-column:1/-1;border:0;border-radius:13px;padding:12px 16px;background:#435331;color:#fff;font-weight:900;cursor:pointer}.primary:disabled{opacity:.5;cursor:not-allowed}.progress{margin-top:14px;border:1px solid #dfe5d9;background:#f8faf6;border-radius:15px;padding:13px}.progress.failed{border-color:#f3cec2;background:#fff5f1}.progress.done{border-color:#cddcbd;background:#f4f8ef}.progressTop{display:flex;justify-content:space-between;gap:12px;align-items:center;font-size:12px}.progressTop span{color:#6d786a}.track{height:7px;border-radius:999px;background:#e8ece4;overflow:hidden;margin-top:9px}.track span{height:100%;display:block;background:#6f7d3c;border-radius:999px;transition:width .28s ease}.progressFoot{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:8px}.progressFoot small{color:#7b8578;font-size:10px}.progressFoot button,.jobState button{border:1px solid #efcfc6;background:#fff6f3;color:#9a513d;border-radius:9px;padding:6px 9px;font-size:10px;font-weight:850;cursor:pointer}.errorBox{margin-top:12px;padding:11px 13px;border-radius:12px;background:#fff0eb;border:1px solid #f4d2c7;color:#9a503b;font-size:12px;font-weight:750}.notes{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.notes span{font-size:10px;font-weight:800;color:#65715f;background:#f3f6f0;padding:5px 8px;border-radius:999px}.jobsHead{display:flex;justify-content:space-between;align-items:center;margin-top:19px;padding-top:16px;border-top:1px solid #e8ebe6}.jobsHead strong{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#687362}.jobsHead button{border:0;background:transparent;color:#52633f;font-weight:800;font-size:11px;cursor:pointer}.jobs{display:grid;gap:8px;margin-top:9px}.job{border:1px solid #e6e9e4;border-radius:13px;padding:11px 12px;display:flex;justify-content:space-between;gap:14px;align-items:center}.job>div:first-child{display:grid;gap:3px}.job strong{font-size:12px}.job span{font-size:10px;color:#778174}.jobState{display:flex;gap:8px;align-items:center}.jobState>span{font-weight:850;color:#53604f;white-space:nowrap}.empty{border:1px dashed #d8ddd5;border-radius:12px;padding:18px;text-align:center;color:#818a7e;font-size:12px}@media(max-width:860px){.hybridOcrShell{padding:0 12px 18px}.hybridCard{padding:16px;border-radius:18px}.hybridHead{display:grid}.badge{justify-self:start}.hybridForm{grid-template-columns:1fr}.drop{min-height:120px}.meta{grid-template-columns:1fr}.meta input[type=url],.primary{grid-column:auto}.progressTop,.job{align-items:flex-start;display:grid}.jobState{justify-content:space-between}.jobState>span{white-space:normal}}
`;
