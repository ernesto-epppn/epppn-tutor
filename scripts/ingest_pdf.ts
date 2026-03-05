import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  throw new Error("Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

type ChunkRow = {
  document_id: number;
  chunk_index: number;
  content: string;
  metadata: any;
  embedding: number[];
};

function normalizePiece(s: string) {
  return s
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Estrai PDF -> file .txt (evita stringona in memoria)
function pdfToTextFile(pdfPath: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "epppn-pdf-"));
  const outTxt = path.join(tmpDir, path.basename(pdfPath).replace(/\.pdf$/i, "") + ".txt");

  // -layout per mantenere struttura, output su file
  execFileSync("pdftotext", ["-layout", pdfPath, outTxt], { stdio: "ignore" });

  return { outTxt, tmpDir };
}

async function embed(text: string) {
  const r = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return r.data[0].embedding;
}

// Inserimento batch per non fare 1000 insert singoli
async function insertChunkBatch(rows: ChunkRow[]) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("document_chunks").insert(rows);
  if (error) throw error;
}

async function main() {
  const pdfPath = process.argv[2];
  const title = process.argv[3] ?? (pdfPath ? path.basename(pdfPath) : "document.pdf");

  if (!pdfPath) {
    console.error('Usage: npx ts-node scripts/ingest_pdf.ts "/path/to/file.pdf" "Titre"');
    process.exit(1);
  }
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`File not found: ${pdfPath}`);
  }

  // 1) crea record documents
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({ title, source: "pdf", storage_path: null, url: null })
    .select("*")
    .single();

  if (docErr) throw docErr;

  console.log(`📘 Document created: id=${doc.id} title="${title}"`);

  // 2) PDF -> TXT su disco (zero RAM enorme)
  const { outTxt, tmpDir } = pdfToTextFile(pdfPath);

  // 3) Stream del file di testo e chunking incrementale
  const MAX_CHARS = 2200;
  const OVERLAP = 200;

  let buffer = "";
  let chunkIndex = 0;

  const BATCH_SIZE = 20;
  let batch: ChunkRow[] = [];

  // read file as stream
  const stream = fs.createReadStream(outTxt, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  for await (const piece of stream) {
    buffer += piece;

    // se il buffer cresce troppo, produci chunks
    while (buffer.length >= MAX_CHARS + OVERLAP) {
      const slice = buffer.slice(0, MAX_CHARS);
      const content = normalizePiece(slice);

      // prepara prossimo buffer con overlap
      buffer = buffer.slice(MAX_CHARS - OVERLAP);

      if (content.length >= 200) {
        const embedding = await embed(content);
        batch.push({
          document_id: doc.id,
          chunk_index: chunkIndex++,
          content,
          metadata: { kind: "pdf", title, file: path.basename(pdfPath) },
          embedding,
        });

        if (batch.length >= BATCH_SIZE) {
          await insertChunkBatch(batch);
          console.log(`Inserted ${chunkIndex} chunks...`);
          batch = [];
        }
      }
    }
  }

  // flush finale
  const tail = normalizePiece(buffer);
  if (tail.length >= 200) {
    const embedding = await embed(tail);
    batch.push({
      document_id: doc.id,
      chunk_index: chunkIndex++,
      content: tail,
      metadata: { kind: "pdf", title, file: path.basename(pdfPath) },
      embedding,
    });
  }

  await insertChunkBatch(batch);

  console.log(`✅ Ingested "${title}" (${chunkIndex} chunks) into Supabase`);

  // cleanup file temporanei
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

main().catch((e) => {
  console.error("❌ Ingest failed:", e);
  process.exit(1);
});
