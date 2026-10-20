import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGES = 7;
const MAX_IMAGE_DATA_URL_CHARS = 1_600_000;
const MAX_TOTAL_IMAGE_CHARS = 10_500_000;

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

function ocrQuality(text: string) {
  const value = String(text || "").trim();
  if (!value || value === "[NO_TEXT]") {
    return { score: 0, suspicious: true, words: 0, alpha_ratio: 0, noise_ratio: 1 };
  }

  const chars = [...value];
  const compact = chars.filter((char) => !/\s/.test(char));
  const alpha = compact.filter((char) => /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(char)).length;
  const digits = compact.filter((char) => /\d/.test(char)).length;
  const normalPunctuation = compact.filter((char) => /[.,;:!?'"’“”()/%°+\-–—]/.test(char)).length;
  const noise = compact.filter(
    (char) => !/[A-Za-zÀ-ÖØ-öø-ÿ0-9.,;:!?'"’“”()/%°+\-–—\[\]{}]/.test(char)
  ).length;
  const words = value.match(/[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’\-]{1,}/g) || [];
  const singletons = value.match(/(?:^|\s)[A-Za-z](?=\s|$)/g) || [];
  const weirdRuns = value.match(/[|_~=<>\\^]{2,}|[^\w\s]{4,}/g) || [];
  const replacement = (value.match(/[�]/g) || []).length;
  const mojibake = (value.match(/(?:Ã.|Â.|â€|â€™|â€œ|â€)/g) || []).length;

  const compactLength = Math.max(1, compact.length);
  const alphaRatio = alpha / compactLength;
  const noiseRatio = (noise + replacement * 3 + mojibake * 2) / compactLength;
  const singletonRatio = singletons.length / Math.max(1, words.length);

  let score = 100;
  if (words.length < 5) score -= 35;
  else if (words.length < 15) score -= 16;
  if (alphaRatio < 0.55) score -= Math.round((0.55 - alphaRatio) * 80);
  if (noiseRatio > 0.015) score -= Math.min(35, Math.round(noiseRatio * 260));
  if (singletonRatio > 0.10) score -= Math.min(22, Math.round(singletonRatio * 80));
  score -= Math.min(18, weirdRuns.length * 4);
  if (replacement) score -= Math.min(20, replacement * 4);
  if (mojibake) score -= Math.min(20, mojibake * 3);

  if (words.length >= 35 && alphaRatio >= 0.68 && noiseRatio < 0.01) score += 5;
  if (normalPunctuation + digits > 0 && words.length >= 20) score += 2;

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    suspicious: score < 72,
    words: words.length,
    alpha_ratio: Number(alphaRatio.toFixed(3)),
    noise_ratio: Number(noiseRatio.toFixed(3)),
  };
}

function normalizeDraft(value: unknown) {
  return cleanOcrText(value).slice(0, 18_000);
}

async function transcribe(
  openai: OpenAI,
  model: string,
  images: string[],
  pageNumber: number,
  language: string,
  draftText = ""
) {
  const draftBlock = draftText
    ? "\n\nUNTRUSTED OCR DRAFT:\n" +
      draftText +
      "\n\nUse this draft only as an aid. Correct it against the page images. Never preserve a word, number or symbol merely because it appears in the draft."
    : "";

  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text:
        "High-accuracy OCR transcription task. Page " +
        pageNumber +
        ". Expected language hint: " +
        language +
        ". The FIRST image may be a full-page overview; the remaining images are overlapping high-resolution crops of the SAME printed page in reading order. " +
        "Reconstruct all readable printed text faithfully. Preserve headings, paragraph order, captions, table cells, formulas, units, percentages, temperatures, times, ingredient quantities and other technical values exactly as printed. " +
        "Resolve line-break hyphenation when a word is visibly split across two lines, but preserve genuine hyphens. " +
        "Remove only duplicate wording caused by overlapping crops. " +
        "Do not summarize, translate, explain, modernize spelling, infer missing wording, or describe photographs. " +
        "Do not invent text hidden by glare, binding, cropping or low resolution. " +
        "When characters are genuinely unreadable, write [illegible] only for the unreadable fragment rather than guessing. " +
        "If there is genuinely no readable printed text in any supplied image, return exactly [NO_TEXT]." +
        draftBlock,
    },
    ...images.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "high" })),
  ];

  const response = await openai.responses.create({
    model,
    reasoning: { effort: "none" },
    max_output_tokens: 10000,
    input: [{ role: "user", content: content as any }],
  });

  const text = cleanOcrText(response.output_text)
    .replace(/\u00ad/g, "")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl");
  const compactLength = text.replace(/\s/g, "").length;
  const quality = ocrQuality(text);
  const usable = Boolean(
    text &&
      text !== "[NO_TEXT]" &&
      compactLength >= 28 &&
      quality.score >= 35
  );
  return { response, text, compactLength, usable, quality };
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
      draft_text?: string;
      quality_mode?: "high" | "balanced";
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
    const draftText = normalizeDraft(body.draft_text);
    const qualityMode = body.quality_mode === "balanced" ? "balanced" : "high";
    const draftQuality = ocrQuality(draftText);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let attempt = await transcribe(
      openai,
      "gpt-5.6-terra",
      images,
      pageNumber,
      language,
      draftText
    );
    let model = "gpt-5.6-terra";

    const needsStrongerPass =
      images.length >= 4 &&
      (
        !attempt.usable ||
        attempt.quality.score < (qualityMode === "high" ? 82 : 66) ||
        (draftText.length >= 500 && attempt.text.length < draftText.length * 0.45)
      );

    if (needsStrongerPass) {
      const strongerDraft =
        attempt.quality.score >= draftQuality.score ? attempt.text : draftText;
      const stronger = await transcribe(
        openai,
        "gpt-5.6-sol",
        images,
        pageNumber,
        language,
        strongerDraft
      );
      if (
        stronger.usable &&
        (
          !attempt.usable ||
          stronger.quality.score > attempt.quality.score ||
          (
            stronger.quality.score === attempt.quality.score &&
            stronger.compactLength > attempt.compactLength
          )
        )
      ) {
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
        quality_score: attempt.quality.score,
        quality_suspicious: attempt.quality.suspicious,
        draft_quality: draftQuality.score,
        quality_mode: qualityMode,
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
      quality: attempt.quality,
      draft_quality: draftQuality,
      usage: attempt.response.usage || null,
    });
  } catch (error) {
    console.error("Admin AI OCR fallback failed:", error);
    return NextResponse.json({ error: "ocr_ai_failed" }, { status: 500 });
  }
}
