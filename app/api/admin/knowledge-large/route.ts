import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const MAX_BATCH_CHUNKS = 24;
const MAX_BATCH_CHARS = 80_000;
const MAX_CHUNK_CHARS = 3_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function envAdminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

function serverClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(req: Request, supabase: any) {
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer) return { response: NextResponse.json({ error: "auth_required" }, { status: 401 }) };

  const { data, error } = await supabase.auth.getUser(bearer);
  const user = data?.user;
  if (error || !user) {
    return { response: NextResponse.json({ error: "invalid_session" }, { status: 401 }) };
  }

  const email = normalizeEmail(user.email);
  const [{ data: profile }, { data: allowed }] = await Promise.all([
    supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.from("epppn_allowed_emails").select("app_role").eq("email", email).maybeSingle(),
  ]);

  const isAdmin =
    profile?.role === "admin" ||
    allowed?.app_role === "admin" ||
    envAdminEmails().includes(email);

  if (!isAdmin) {
    return { response: NextResponse.json({ error: "admin_required" }, { status: 403 }) };
  }

  return { user, email };
}

type LargeChunk = {
  index?: number;
  content?: string;
  page_start?: number;
  page_end?: number;
};

export async function GET(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });

    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;

    const { data, error } = await supabase
      .from("ernesto_knowledge_jobs")
      .select("id,document_id,title,source,file_name,file_size_bytes,category,version_label,status,stage_label,pages_total,pages_done,chunks_done,error,created_at,updated_at,completed_at")
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) return NextResponse.json({ error: "jobs_lookup_failed" }, { status: 500 });
    return NextResponse.json({ jobs: data || [] });
  } catch (error) {
    console.error("Large knowledge jobs GET failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });

    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "");
    const nowIso = new Date().toISOString();

    if (action === "start") {
      const title = cleanText(body.title, 180);
      const source = cleanText(body.source, 260) || "EPPPN — document officiel";
      const url = cleanText(body.url, 500);
      const fileName = cleanText(body.file_name, 260);
      const category = cleanText(body.category, 80) || "Général";
      const versionLabel = cleanText(body.version_label, 100);
      const fileSize = Math.max(0, Number(body.file_size_bytes || 0));

      if (!title || !fileName || !Number.isFinite(fileSize) || fileSize <= 0) {
        return NextResponse.json({ error: "invalid_document_metadata" }, { status: 400 });
      }
      if (fileSize > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "file_too_large", max_bytes: MAX_FILE_BYTES }, { status: 413 });
      }

      const { data: duplicate } = await supabase
        .from("documents")
        .select("id,status")
        .eq("title", title)
        .eq("source", source)
        .eq("status", "indexed")
        .maybeSingle();
      if (duplicate) return NextResponse.json({ error: "document_already_exists" }, { status: 409 });

      const { data: document, error: documentError } = await supabase
        .from("documents")
        .insert({
          title,
          source,
          url: url || null,
          storage_path: null,
          active: false,
          status: "extracting",
          category,
          version_label: versionLabel || null,
          file_name: fileName,
          file_size_bytes: Math.round(fileSize),
          indexed_at: null,
        })
        .select("id,title,source")
        .single();

      if (documentError || !document) {
        console.error("Large knowledge document insert failed:", documentError?.message);
        return NextResponse.json({ error: "document_insert_failed" }, { status: 500 });
      }

      const { data: job, error: jobError } = await supabase
        .from("ernesto_knowledge_jobs")
        .insert({
          document_id: document.id,
          created_by: auth.user.id,
          title,
          source,
          file_name: fileName,
          file_size_bytes: Math.round(fileSize),
          category,
          version_label: versionLabel || null,
          status: "extracting",
          stage_label: "Lecture locale du PDF",
          pages_done: 0,
          chunks_done: 0,
          updated_at: nowIso,
        })
        .select("id,document_id")
        .single();

      if (jobError || !job) {
        await supabase.from("documents").delete().eq("id", document.id);
        console.error("Large knowledge job insert failed:", jobError?.message);
        return NextResponse.json({ error: "job_insert_failed" }, { status: 500 });
      }

      return NextResponse.json({ job_id: job.id, document_id: document.id }, { status: 201 });
    }

    const jobId = cleanText(body.job_id, 80);
    if (!jobId) return NextResponse.json({ error: "job_id_required" }, { status: 400 });

    const { data: job, error: jobLookupError } = await supabase
      .from("ernesto_knowledge_jobs")
      .select("id,document_id,status,title,source,file_name")
      .eq("id", jobId)
      .maybeSingle();

    if (jobLookupError || !job) {
      return NextResponse.json({ error: "job_not_found" }, { status: 404 });
    }

    if (action === "progress") {
      const pagesTotal = Number(body.pages_total || 0);
      const pagesDone = Number(body.pages_done || 0);
      const stageLabel = cleanText(body.stage_label, 180);
      const payload: Record<string, unknown> = {
        updated_at: nowIso,
        stage_label: stageLabel || null,
      };
      if (Number.isFinite(pagesTotal) && pagesTotal > 0) payload.pages_total = Math.floor(pagesTotal);
      if (Number.isFinite(pagesDone) && pagesDone >= 0) payload.pages_done = Math.floor(pagesDone);
      const { error } = await supabase.from("ernesto_knowledge_jobs").update(payload).eq("id", jobId);
      if (error) return NextResponse.json({ error: "progress_update_failed" }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === "batch") {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json({ error: "openai_not_configured" }, { status: 500 });
      }
      if (["indexed", "failed", "cancelled"].includes(String(job.status))) {
        return NextResponse.json({ error: "job_not_writable" }, { status: 409 });
      }

      const rawChunks = Array.isArray(body.chunks) ? (body.chunks as LargeChunk[]) : [];
      if (!rawChunks.length || rawChunks.length > MAX_BATCH_CHUNKS) {
        return NextResponse.json({ error: "invalid_chunk_batch" }, { status: 400 });
      }

      const chunks = rawChunks.map((chunk) => ({
        index: Math.max(0, Math.floor(Number(chunk.index || 0))),
        content: String(chunk.content || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHUNK_CHARS),
        page_start: Math.max(1, Math.floor(Number(chunk.page_start || 1))),
        page_end: Math.max(1, Math.floor(Number(chunk.page_end || chunk.page_start || 1))),
      })).filter((chunk) => chunk.content.length >= 80);

      const totalChars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
      if (!chunks.length || totalChars > MAX_BATCH_CHARS) {
        return NextResponse.json({ error: "chunk_batch_too_large" }, { status: 413 });
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const embeddings = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: chunks.map((chunk) => chunk.content),
      });
      if (embeddings.data.length !== chunks.length) {
        return NextResponse.json({ error: "embedding_count_mismatch" }, { status: 502 });
      }

      const rows = chunks.map((chunk, idx) => ({
        document_id: job.document_id,
        chunk_index: chunk.index,
        content: chunk.content,
        embedding: embeddings.data[idx].embedding,
        metadata: {
          official_epppn: true,
          title: job.title,
          source: job.source,
          file_name: job.file_name || null,
          page_start: chunk.page_start,
          page_end: chunk.page_end,
          large_pdf_pipeline: true,
          uploaded_by: auth.user.id,
        },
      }));

      const { error: insertError } = await supabase
        .from("document_chunks")
        .upsert(rows, { onConflict: "document_id,chunk_index" });
      if (insertError) {
        console.error("Large knowledge batch insert failed:", insertError.message);
        return NextResponse.json({ error: "chunk_insert_failed" }, { status: 500 });
      }

      const pagesDone = Math.max(0, Math.floor(Number(body.pages_done || 0)));
      const chunksDone = Math.max(...chunks.map((chunk) => chunk.index)) + 1;
      await supabase
        .from("ernesto_knowledge_jobs")
        .update({
          status: "embedding",
          stage_label: "Création des embeddings EPPPN",
          pages_done: pagesDone,
          chunks_done: chunksDone,
          updated_at: nowIso,
        })
        .eq("id", jobId);

      return NextResponse.json({ ok: true, chunks_written: chunks.length, chunks_done: chunksDone });
    }

    if (action === "finish") {
      const { count, error: countError } = await supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("document_id", job.document_id);

      if (countError || !count) {
        return NextResponse.json({ error: "no_indexed_chunks" }, { status: 400 });
      }

      const pagesTotal = Math.max(0, Math.floor(Number(body.pages_total || 0)));
      const { error: documentError } = await supabase
        .from("documents")
        .update({
          active: true,
          status: "indexed",
          indexed_at: nowIso,
        })
        .eq("id", job.document_id);

      if (documentError) return NextResponse.json({ error: "document_finalize_failed" }, { status: 500 });

      await supabase
        .from("ernesto_knowledge_jobs")
        .update({
          status: "indexed",
          stage_label: "Indexé dans Ernesto",
          pages_total: pagesTotal || null,
          pages_done: pagesTotal || undefined,
          chunks_done: count,
          error: null,
          updated_at: nowIso,
          completed_at: nowIso,
        })
        .eq("id", jobId);

      return NextResponse.json({ ok: true, document_id: job.document_id, chunks: count });
    }

    if (action === "fail") {
      const message = cleanText(body.error, 500) || "indexation_interrompue";
      await Promise.all([
        supabase
          .from("ernesto_knowledge_jobs")
          .update({ status: "failed", stage_label: "Indexation interrompue", error: message, updated_at: nowIso })
          .eq("id", jobId),
        supabase
          .from("documents")
          .update({ active: false, status: "failed" })
          .eq("id", job.document_id),
      ]);
      return NextResponse.json({ ok: true });
    }

    if (action === "cancel") {
      await supabase.from("documents").delete().eq("id", job.document_id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  } catch (error) {
    console.error("Large knowledge pipeline failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "server_error" }, { status: 500 });
  }
}
