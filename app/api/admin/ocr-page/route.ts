import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const MAX_IMAGES = 6;
const MAX_IMAGE_DATA_URL_CHARS = 1_600_000;
const MAX_TOTAL_IMAGE_CHARS = 8_500_000;

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
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
  if (error || !user) return { response: NextResponse.json({ error: "invalid_session" }, { status: 401 }) };

  const email = normalizeEmail(user.email);
  const [{ data: profile }, { data: allowed }] = await Promise.all([
    supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.from("epppn_allowed_emails").select("app_role").eq("email", email).maybeSingle(),
  ]);

  const isAdmin = profile?.role === "admin" || allowed?.app_role === "admin" || envAdminEmails().includes(email);
  if (!isAdmin) return { response: NextResponse.json({ error: "admin_required" }, { status: 403 }) };

  return { user };
}

function cleanOcrText(value: unknown) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 45_000);
}

function validImageDataUrl(value: string) {
  return /^data:image\/(jpeg|jpg|webp|png);base64,/i.test(value);
}

async function transcribe(openai: OpenAI, model: string, images: string[], pageNumber: number, language: string) {
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text:
        `OCR transcription task. Page ${pageNumber}. Expected language hint: ${language}. ` +
        "The images are overlapping high-resolution crops from the SAME printed page, ordered from top to bottom and left to right. " +
        "Inspect each crop closely and reconstruct all readable printed text, removing only duplicate lines caused by overlap. " +
        "Transcribe headings, paragraphs, captions, labels, table cells, formulas and technical values faithfully. " +
        "Do not summarize, translate, explain, infer missing wording, or describe photographs. Return only the transcription. " +
        "A page may contain small typography over photographs or coloured backgrounds: inspect carefully before deciding it contains no text. " +
        "If there is genuinely no readable printed text in any supplied crop, return exactly [NO_TEXT].",
    },
    ...images.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "high" })),
  ];

  const response = await openai.responses.create({
    model,
    reasoning: { effort: "none" },
    max_output_tokens: 10000,
    input: [{ role: "user", content: content as any }],
  });

  const text = cleanOcrText(response.output_text);
  const compactLength = text.replace(/\s/g, "").length;
  const usable = Boolean(text && text !== "[NO_TEXT]" && compactLength >= 28);
  return { response, text, compactLength, usable };
}

export async function POST(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });

    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "openai_not_configured" }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      image_data_url?: string;
      image_data_urls?: string[];
      page_number?: number;
      language?: string;
    };

    const legacy = String(body.image_data_url || "");
    const supplied = Array.isArray(body.image_data_urls)
      ? body.image_data_urls.map((value) => String(value || "")).filter(Boolean)
      : [];
    const images = (supplied.length ? supplied : legacy ? [legacy] : []).slice(0, MAX_IMAGES);

    if (!images.length || images.some((value) => !validImageDataUrl(value))) {
      return NextResponse.json({ error: "invalid_image" }, { status: 400 });
    }
    if (images.some((value) => value.length > MAX_IMAGE_DATA_URL_CHARS)) {
      return NextResponse.json({ error: "image_too_large" }, { status: 413 });
    }
    const totalChars = images.reduce((sum, value) => sum + value.length, 0);
    if (totalChars > MAX_TOTAL_IMAGE_CHARS) {
      return NextResponse.json({ error: "images_too_large" }, { status: 413 });
    }

    const pageNumber = Math.max(1, Math.floor(Number(body.page_number || 1)));
    const language = String(body.language || "eng").slice(0, 40);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let attempt = await transcribe(openai, "gpt-5.6-terra", images, pageNumber, language);
    let model = "gpt-5.6-terra";

    // Dense scans are unusual enough to justify one stronger pass, but only when
    // Terra explicitly fails to recover text from high-resolution page crops.
    if (!attempt.usable && images.length >= 4) {
      const stronger = await transcribe(openai, "gpt-5.6-sol", images, pageNumber, language);
      if (stronger.usable || stronger.compactLength > attempt.compactLength) {
        attempt = stronger;
        model = "gpt-5.6-sol";
      }
    }

    console.info(
      "ERNESTO_OCR_DIAG",
      JSON.stringify({
        page: pageNumber,
        images: images.length,
        image_chars: totalChars,
        output_chars: attempt.text.length,
        compact_chars: attempt.compactLength,
        no_text: attempt.text === "[NO_TEXT]",
        usable: attempt.usable,
        model,
        input_tokens: Number((attempt.response.usage as any)?.input_tokens || 0),
        output_tokens: Number((attempt.response.usage as any)?.output_tokens || 0),
      })
    );

    return NextResponse.json({
      ok: true,
      page_number: pageNumber,
      usable: attempt.usable,
      text: attempt.usable ? attempt.text : "",
      model,
      image_count: images.length,
      text_chars: attempt.usable ? attempt.text.length : 0,
      usage: attempt.response.usage || null,
    });
  } catch (error) {
    console.error("Admin AI OCR fallback failed:", error);
    return NextResponse.json({ error: "ocr_ai_failed" }, { status: 500 });
  }
}
