"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

type LargeJob = {
  id: string;
  document_id: number;
  title: string;
  source: string;
  file_name?: string | null;
  file_size_bytes?: number | null;
  category?: string | null;
  version_label?: string | null;
  status: "preparing" | "extracting" | "embedding" | "indexed" | "failed" | "cancelled";
  stage_label?: string | null;
  pages_total?: number | null;
  pages_done?: number | null;
  chunks_done?: number | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
};

type PendingChunk = {
  index: number;
  content: string;
  page_start: number;
  page_end: number;
};

const BATCH_SIZE = 20;
const CHUNK_SIZE = 1_850;
const CHUNK_OVERLAP = 170;
const MAX_CHUNKS = 7_500;

function humanSize(bytes?: number | null) {
  const value = Number(bytes || 0);
  if (!value) return "—";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} Go`;
  return `${(value / 1024 ** 2).toFixed(value >= 100 * 1024 ** 2 ? 0 : 1)} Mo`;
}

function fileTitle(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanPageText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitPageText(text: string, page: number, startIndex: number) {
  const chunks: PendingChunk[] = [];
  let start = 0;
  let index = startIndex;

  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_SIZE);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const sentence = Math.max(
        text.lastIndexOf(". ", end),
        text.lastIndexOf("? ", end),
        text.lastIndexOf("! ", end)
      );
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

function stageLabel(job: LargeJob) {
  if (job.status === "indexed") return "Indexé ✓";
  if (job.status === "failed") return "Échec";
  if (job.status === "cancelled") return "Annulé";
  return job.stage_label || "En cours";
}

export default function AdminLargePdfPanel() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("EPPPN — document officiel");
  const [category, setCategory] = useState("Général");
  const [versionLabel, setVersionLabel] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("Prêt");
  const [pagesDone, setPagesDone] = useState(0);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [chunksDone, setChunksDone] = useState(0);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<LargeJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const currentJobRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function accessToken() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function api(body: Record<string, unknown>) {
    const token = await accessToken();
    if (!token) throw new Error("Session administrateur introuvable.");
    const response = await fetch("/api/admin/knowledge-large", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const labels: Record<string, string> = {
        document_already_exists: "Ce document est déjà indexé.",
        invalid_document_metadata: "Les informations du document sont incomplètes.",
        file_too_large: "Ce fichier dépasse la limite de sécurité de 2 Go.",
        no_indexed_chunks: "Aucun texte exploitable n’a pu être indexé.",
        openai_not_configured: "Le service d’indexation n’est pas configuré.",
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
      const response = await fetch("/api/admin/knowledge-large", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) setJobs(Array.isArray(result?.jobs) ? result.jobs : []);
    } finally {
      setLoadingJobs(false);
    }
  }

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function markFailed(jobId: string, message: string) {
    try {
      await api({ action: "fail", job_id: jobId, error: message });
    } catch {
      // The local error remains visible even if the status update itself fails.
    }
  }

  async function indexLargePdf(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("Cette zone est réservée aux PDF.");
      return;
    }

    setBusy(true);
    setError("");
    setPagesDone(0);
    setPagesTotal(0);
    setChunksDone(0);
    setStage("Préparation");
    currentJobRef.current = null;

    let pdfDocument: any = null;
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
      pdfjs.GlobalWorkerOptions.workerSrc =
        `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/legacy/build/pdf.worker.min.mjs`;

      const buffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
      pdfDocument = await loadingTask.promise;
      const totalPages = Number(pdfDocument.numPages || 0);
      if (!totalPages) throw new Error("Le PDF ne contient aucune page lisible.");

      setPagesTotal(totalPages);
      await api({
        action: "progress",
        job_id: jobId,
        pages_total: totalPages,
        pages_done: 0,
        stage_label: "Extraction du texte dans le navigateur",
      });

      let pending: PendingChunk[] = [];
      let nextChunkIndex = 0;
      let totalTextChars = 0;

      const flush = async (pageNumber: number) => {
        if (!pending.length) return;
        setStage(`Indexation EPPPN · ${nextChunkIndex} fragments préparés`);
        for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
          const batch = pending.slice(offset, offset + BATCH_SIZE);
          const result = await api({
            action: "batch",
            job_id: jobId,
            pages_done: pageNumber,
            chunks: batch,
          });
          setChunksDone(Number(result?.chunks_done || batch[batch.length - 1].index + 1));
        }
        pending = [];
      };

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        setStage(`Extraction du texte · page ${pageNumber}/${totalPages}`);
        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = cleanPageText(
          (textContent.items || [])
            .map((item: any) => `${String(item?.str || "")}${item?.hasEOL ? "\n" : " "}`)
            .join("")
        );
        page.cleanup?.();

        totalTextChars += pageText.length;
        const pageChunks = splitPageText(pageText, pageNumber, nextChunkIndex);
        if (pageChunks.length) {
          pending.push(...pageChunks);
          nextChunkIndex += pageChunks.length;
        }

        if (nextChunkIndex > MAX_CHUNKS) {
          throw new Error(`Ce PDF produit plus de ${MAX_CHUNKS} fragments. Il est préférable de le séparer en volumes ou chapitres.`);
        }

        setPagesDone(pageNumber);
        if (pending.length >= BATCH_SIZE || pageNumber === totalPages) {
          await flush(pageNumber);
        } else if (pageNumber % 12 === 0) {
          await api({
            action: "progress",
            job_id: jobId,
            pages_total: totalPages,
            pages_done: pageNumber,
            stage_label: `Extraction du texte · page ${pageNumber}/${totalPages}`,
          });
        }

        if (pageNumber >= Math.min(60, totalPages) && totalTextChars < 800) {
          throw new Error("Le PDF semble principalement composé d’images et ne contient pas de couche texte exploitable. Une version OCR est nécessaire.");
        }
      }

      if (totalTextChars < 800 || nextChunkIndex === 0) {
        throw new Error("Le PDF ne contient pas assez de texte exploitable pour le RAG.");
      }

      setStage("Finalisation de la base EPPPN");
      const finished = await api({ action: "finish", job_id: jobId, pages_total: totalPages });
      setChunksDone(Number(finished?.chunks || nextChunkIndex));
      setPagesDone(totalPages);
      setStage("Indexé dans Ernesto ✓");
      await loadJobs();

      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Indexation impossible.";
      setError(message);
      setStage("Indexation interrompue");
      if (jobId) await markFailed(jobId, message);
      await loadJobs();
    } finally {
      try {
        await pdfDocument?.destroy?.();
      } catch {
        // no-op
      }
      setBusy(false);
      currentJobRef.current = null;
    }
  }

  async function clearFailed(job: LargeJob) {
    if (!window.confirm(`Nettoyer l’import interrompu « ${job.title} » ?`)) return;
    try {
      await api({ action: "cancel", job_id: job.id });
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nettoyage impossible.");
    }
  }

  const percent = pagesTotal > 0 ? Math.min(100, Math.round((pagesDone / pagesTotal) * 100)) : 0;

  return (
    <section className="largePdfShell">
      <style>{largePdfCss}</style>
      <div className="largePdfCard">
        <div className="largePdfHead">
          <div>
            <div className="largePdfEyebrow">Connaissances · grands PDF</div>
            <h2>Import intelligent des manuels volumineux</h2>
            <p>
              Pour les gros PDF, Ernesto lit le document localement dans votre navigateur et envoie uniquement le texte utile à l’indexation. Le fichier original de plusieurs centaines de Mo n’a donc pas besoin de transiter par Vercel ou Supabase Storage.
            </p>
          </div>
          <div className="localBadge">Extraction locale</div>
        </div>

        <form className="largePdfForm" onSubmit={indexLargePdf}>
          <label className={`largeDrop ${file ? "selected" : ""}`}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0] || null;
                setFile(selected);
                setError("");
                if (selected && !title.trim()) setTitle(fileTitle(selected.name));
              }}
            />
            <span className="largePdfIcon">PDF</span>
            <div>
              <strong>{file ? file.name : "Choisir un grand PDF"}</strong>
              <small>{file ? humanSize(file.size) : "Manuels et ouvrages volumineux · jusqu’à 2 Go côté Ernesto"}</small>
            </div>
          </label>

          <div className="largeMeta">
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titre du document" disabled={busy} />
            <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Source" disabled={busy} />
            <select value={category} onChange={(event) => setCategory(event.target.value)} disabled={busy}>
              <option>Général</option>
              <option>Pâte</option>
              <option>Levain</option>
              <option>Farines</option>
              <option>Fermentation</option>
              <option>Cuisson</option>
              <option>Organisation</option>
              <option>Recettes</option>
              <option>Science & technique</option>
            </select>
            <input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} placeholder="Version / édition — facultatif" disabled={busy} />
            <input type="url" value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} placeholder="Lien de référence — facultatif" disabled={busy} />
            <button className="largePrimary" disabled={!file || busy}>
              {busy ? "Indexation en cours…" : "Indexer dans Ernesto"}
            </button>
          </div>
        </form>

        {busy || stage !== "Prêt" ? (
          <div className={`largeProgress ${error ? "failed" : stage.includes("✓") ? "done" : ""}`}>
            <div className="largeProgressTop">
              <strong>{stage}</strong>
              <span>{pagesTotal ? `${pagesDone}/${pagesTotal} pages` : "Préparation"} · {chunksDone} fragments</span>
            </div>
            <div className="largeProgressTrack"><span style={{ width: `${stage.includes("✓") ? 100 : percent}%` }} /></div>
            <small>{busy ? "Gardez cet onglet ouvert jusqu’à « Indexé ✓ ». L’opération peut durer plusieurs minutes pour un ouvrage très volumineux." : ""}</small>
          </div>
        ) : null}

        {error ? <div className="largeError">{error}</div> : null}

        <div className="largeNotes">
          <span>✓ Pas de limite à 8 Mo</span>
          <span>✓ Indexation par lots</span>
          <span>✓ Progression page par page</span>
          <span>✓ Détection des PDF scannés sans OCR</span>
        </div>

        <div className="largeJobsHead">
          <strong>Imports volumineux récents</strong>
          <button type="button" onClick={() => void loadJobs()} disabled={loadingJobs}>{loadingJobs ? "…" : "Actualiser"}</button>
        </div>
        <div className="largeJobs">
          {jobs.slice(0, 6).map((job) => {
            const jobPercent = job.pages_total ? Math.min(100, Math.round((Number(job.pages_done || 0) / job.pages_total) * 100)) : 0;
            return (
              <div className={`largeJob status-${job.status}`} key={job.id}>
                <div>
                  <strong>{job.title}</strong>
                  <span>{job.category || "Général"} · {humanSize(job.file_size_bytes)} · {job.chunks_done || 0} fragments</span>
                </div>
                <div className="largeJobState">
                  <span>{stageLabel(job)}{job.status !== "indexed" && job.pages_total ? ` · ${jobPercent}%` : ""}</span>
                  {job.status === "failed" ? <button type="button" onClick={() => void clearFailed(job)}>Nettoyer</button> : null}
                </div>
              </div>
            );
          })}
          {!loadingJobs && !jobs.length ? <div className="largeEmpty">Aucun import volumineux pour le moment.</div> : null}
        </div>
      </div>
    </section>
  );
}

const largePdfCss = `
  .largePdfShell{background:#f6f7f4;padding:0 clamp(18px,4vw,58px) 22px;font-family:var(--font-geist-sans),system-ui,sans-serif;color:#172132}
  .largePdfCard{max-width:1380px;margin:0 auto;background:#fff;border:1px solid #e3e7df;border-radius:21px;box-shadow:0 10px 32px rgba(23,33,50,.045);padding:22px}
  .largePdfHead{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.largePdfEyebrow{font-size:11px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#6f7d3c}.largePdfHead h2{margin:5px 0 6px;font-size:25px;letter-spacing:-.035em}.largePdfHead p{margin:0;max-width:900px;color:#64748b;line-height:1.55;font-size:14px}.localBadge{white-space:nowrap;border:1px solid #dbe4d2;background:#f3f7ef;color:#53653d;padding:8px 11px;border-radius:999px;font-size:11px;font-weight:850}
  .largePdfForm{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(420px,1.2fr);gap:16px;margin-top:18px}.largeDrop{min-height:190px;border:1.5px dashed #8d9d66;border-radius:18px;background:#f5f8f1;padding:20px;display:flex;align-items:center;gap:16px;cursor:pointer}.largeDrop input{display:none}.largeDrop.selected{border-style:solid;background:#f2f6ed}.largePdfIcon{width:52px;height:52px;border-radius:15px;background:#435331;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:950;flex:0 0 auto}.largeDrop strong{display:block;font-size:14px;line-height:1.4;overflow-wrap:anywhere}.largeDrop small{display:block;margin-top:5px;color:#7e887b;font-size:11px}
  .largeMeta{display:grid;grid-template-columns:1fr 1fr;gap:10px}.largeMeta input,.largeMeta select{border:1px solid #dde3d9;background:#fbfcfa;border-radius:12px;padding:11px 13px;min-width:0;color:#172132;font:inherit}.largeMeta input[type=url]{grid-column:1 / -1}.largeMeta input:focus,.largeMeta select:focus{outline:2px solid rgba(111,125,60,.15);border-color:#8a9a65}.largePrimary{grid-column:1 / -1;border:0;border-radius:13px;padding:12px 16px;background:#435331;color:#fff;font-weight:900;cursor:pointer;box-shadow:0 6px 16px rgba(67,83,49,.18)}.largePrimary:disabled{opacity:.5;cursor:not-allowed}
  .largeProgress{margin-top:14px;border:1px solid #dfe5d9;background:#f8faf6;border-radius:15px;padding:13px}.largeProgress.failed{border-color:#f3cec2;background:#fff5f1}.largeProgress.done{border-color:#cddcbd;background:#f4f8ef}.largeProgressTop{display:flex;justify-content:space-between;gap:12px;align-items:center;font-size:12px}.largeProgressTop span{color:#6d786a}.largeProgressTrack{height:7px;border-radius:999px;background:#e8ece4;overflow:hidden;margin-top:9px}.largeProgressTrack span{height:100%;display:block;background:#6f7d3c;border-radius:999px;transition:width .28s ease}.largeProgress small{display:block;margin-top:8px;color:#7b8578;font-size:10px}.largeError{margin-top:12px;padding:11px 13px;border-radius:12px;background:#fff0eb;border:1px solid #f4d2c7;color:#9a503b;font-size:12px;font-weight:750}
  .largeNotes{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.largeNotes span{font-size:10px;font-weight:800;color:#65715f;background:#f3f6f0;padding:5px 8px;border-radius:999px}.largeJobsHead{display:flex;justify-content:space-between;align-items:center;margin-top:19px;padding-top:16px;border-top:1px solid #e8ebe6}.largeJobsHead strong{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#687362}.largeJobsHead button{border:0;background:transparent;color:#52633f;font-weight:800;font-size:11px;cursor:pointer}.largeJobs{display:grid;gap:8px;margin-top:9px}.largeJob{border:1px solid #e6e9e4;border-radius:13px;padding:11px 12px;display:flex;justify-content:space-between;gap:14px;align-items:center}.largeJob>div:first-child{display:grid;gap:3px}.largeJob strong{font-size:12px}.largeJob span{font-size:10px;color:#778174}.largeJobState{display:flex;gap:8px;align-items:center}.largeJobState>span{font-weight:850;color:#53604f;white-space:nowrap}.largeJob.status-failed .largeJobState>span{color:#a0543c}.largeJobState button{border:1px solid #f1d4ca;background:#fff6f3;color:#9a513d;border-radius:9px;padding:5px 8px;font-size:10px;font-weight:850;cursor:pointer}.largeEmpty{border:1px dashed #d8ddd5;border-radius:12px;padding:18px;text-align:center;color:#818a7e;font-size:12px}
  @media(max-width:860px){.largePdfShell{padding:0 12px 18px}.largePdfCard{padding:16px;border-radius:18px}.largePdfHead{display:grid}.localBadge{justify-self:start}.largePdfForm{grid-template-columns:1fr}.largeDrop{min-height:130px}.largeMeta{grid-template-columns:1fr}.largeMeta input[type=url],.largePrimary{grid-column:auto}.largeProgressTop,.largeJob{align-items:flex-start;display:grid}.largeJobState{justify-content:space-between}.largeJobState>span{white-space:normal}}
`;
