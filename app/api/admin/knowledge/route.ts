import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 180_000;
const CHUNK_SIZE = 2_200;
const CHUNK_OVERLAP = 200;

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

function serverSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return { response: NextResponse.json({ error: "server_not_configured" }, { status: 500 }) };

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer) return { response: NextResponse.json({ error: "auth_required" }, { status: 401 }) };

  const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
  const user = userData?.user;
  if (userError || !user) {
    return { response: NextResponse.json({ error: "invalid_session" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin" || envAdminEmails().includes(normalizeEmail(user.email));
  if (!isAdmin) return { response: NextResponse.json({ error: "admin_required" }, { status: 403 }) };

  return { supabase, user };
}

function normalizeDocumentText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function chunkDocument(value: string) {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + CHUNK_SIZE);
    if (end < value.length) {
      const paragraphBreak = value.lastIndexOf("\n\n", end);
      const sentenceBreak = value.lastIndexOf(". ", end);
      const bestBreak = Math.max(paragraphBreak, sentenceBreak);
      if (bestBreak > start + Math.floor(CHUNK_SIZE * 0.58)) end = bestBreak + 1;
    }
    const chunk = value.slice(start, end).trim();
    if (chunk.length >= 80) chunks.push(chunk);
    if (end >= value.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

async function extractFileText(file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error("file_too_large");
  const extension = file.name.toLowerCase().split(".").pop() || "";
  const isPdf = file.type === "application/pdf" || extension === "pdf";
  const isText = ["text/plain", "text/markdown", "application/octet-stream", ""].includes(file.type)
    && ["txt", "md", "markdown"].includes(extension);

  if (!isPdf && !isText) throw new Error("unsupported_file_type");
  const buffer = await file.arrayBuffer();
  if (!isPdf) return new TextDecoder("utf-8").decode(buffer);

  // pdf-parse v2 uses PDF.js, which needs the Node canvas implementation in
  // serverless environments. Loading the worker first provides CanvasFactory
  // and avoids the "DOMMatrix is not defined" crash seen on Vercel.
  const { CanvasFactory } = await import("pdf-parse/worker");
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    CanvasFactory,
  });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;

  const { data, error } = await auth.supabase
    .from("documents")
    .select("id,title,source,url,created_at,document_chunks(count)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const documents = (data || []).map((document) => {
    const relation = Array.isArray(document.document_chunks) ? document.document_chunks[0] : null;
    return {
      id: document.id,
      title: document.title,
      source: document.source,
      url: document.url,
      created_at: document.created_at,
      chunks: Number(relation?.count || 0),
    };
  });
  return NextResponse.json({ documents });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "openai_not_configured" }, { status: 500 });
  }

  try {
    const form = await req.formData();
    const title = cleanText(form.get("title"), 180);
    const source = cleanText(form.get("source"), 260);
    const url = cleanText(form.get("url"), 500);
    const pastedText = String(form.get("content") || "");
    const confirmedOfficial = form.get("confirmedOfficial") === "true";
    const fileValue = form.get("file");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

    if (!confirmedOfficial) {
      return NextResponse.json({ error: "official_confirmation_required" }, { status: 400 });
    }
    if (!title || !source || (!file && !pastedText.trim())) {
      return NextResponse.json({ error: "title_source_and_content_required" }, { status: 400 });
    }

    const { data: duplicate } = await auth.supabase
      .from("documents")
      .select("id")
      .eq("title", title)
      .eq("source", source)
      .maybeSingle();
    if (duplicate) return NextResponse.json({ error: "document_already_exists" }, { status: 409 });

    const rawText = file ? await extractFileText(file) : pastedText;
    const content = normalizeDocumentText(rawText);
    const chunks = chunkDocument(content);
    if (content.length < 120 || !chunks.length) {
      return NextResponse.json({ error: "document_content_too_short" }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunks,
    });
    if (embeddingResponse.data.length !== chunks.length) {
      return NextResponse.json({ error: "embedding_count_mismatch" }, { status: 502 });
    }

    const { data: document, error: documentError } = await auth.supabase
      .from("documents")
      .insert({
        title,
        source,
        url: url || null,
        storage_path: null,
      })
      .select("id,title,source,url,created_at")
      .single();
    if (documentError || !document) {
      return NextResponse.json({ error: documentError?.message || "document_insert_failed" }, { status: 500 });
    }

    const rows = chunks.map((chunk, index) => ({
      document_id: document.id,
      chunk_index: index,
      content: chunk,
      embedding: embeddingResponse.data[index].embedding,
      metadata: {
        official_epppn: true,
        title,
        source,
        file_name: file?.name || null,
        uploaded_by: auth.user.id,
      },
    }));

    for (let index = 0; index < rows.length; index += 40) {
      const { error } = await auth.supabase.from("document_chunks").insert(rows.slice(index, index + 40));
      if (error) {
        await auth.supabase.from("documents").delete().eq("id", document.id);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ document: { ...document, chunks: chunks.length } }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "knowledge_ingestion_failed";
    const status = code === "file_too_large" ? 413 : code === "unsupported_file_type" ? 415 : 500;
    console.error("Admin knowledge ingestion failed:", error);
    return NextResponse.json({ error: code }, { status });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid_document_id" }, { status: 400 });
  }

  const { error } = await auth.supabase.from("documents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
