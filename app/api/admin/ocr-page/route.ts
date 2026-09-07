import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const MAX_IMAGES = 4;
const MAX_IMAGE_DATA_URL_CHARS = 2_200_000;
const MAX_TOTAL_IMAGE_CHARS = 7_200_000;

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
    .slice(0, 40_000);
}

function validImageDataUrl(value: string) {
  return /^data:image\/(jpeg|jpg|webp|png);base64,/i.test(value);
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

    const content: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text:
          `OCR transcription task. Page ${pageNumber}. Expected language hint: ${language}. ` +
          (images.length > 1
            ? "The following images are overlapping crops from the SAME printed page. Reconstruct the page text across all crops, using the visual layout to determine reading order and removing duplicated lines caused by overlap. "
            : "The following image is the printed page to transcribe. ") +
          "Transcribe every readable heading, paragraph, caption, label, table entry and technical value faithfully. Preserve headings and paragraph order when possible. " +
          "Do not summarize, explain, translate, infer missing wording, or describe photographs. Return only the transcription. " +
          "If there is genuinely no readable printed text in any supplied image, return exactly [NO_TEXT].",
      },
      ...images.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "high" })),
    ];

    const response = await openai.responses.create({
      model: "gpt-5.6-terra",
      reasoning: { effort: "none" },
      max_output_tokens: 9000,
      input: [{ role: "user", content: content as any }],
    });

    const text = cleanOcrText(response.output_text);
    const compactLength = text.replace(/\s/g, "").length;
    const usable = Boolean(text && text !== "[NO_TEXT]" && compactLength >= 35);

    // Diagnostic only: never log the OCR text itself. This lets the admin pipeline
    // distinguish a genuinely blank/visual page from a transport or rendering issue.
    console.info(
      "ERNESTO_OCR_DIAG",
      JSON.stringify({
        page: pageNumber,
        images: images.length,
        image_chars: totalChars,
        output_chars: text.length,
        compact_chars: compactLength,
        no_text: text === "[NO_TEXT]",
        usable,
        model: "gpt-5.6-terra",
        input_tokens: Number((response.usage as any)?.input_tokens || 0),
        output_tokens: Number((response.usage as any)?.output_tokens || 0),
      })
    );

    return NextResponse.json({
      ok: true,
      page_number: pageNumber,
      usable,
      text: usable ? text : "",
      model: "gpt-5.6-terra",
      image_count: images.length,
      text_chars: usable ? text.length : 0,
      usage: response.usage || null,
    });
  } catch (error) {
    console.error("Admin AI OCR fallback failed:", error);
    return NextResponse.json({ error: "ocr_ai_failed" }, { status: 500 });
  }
}
