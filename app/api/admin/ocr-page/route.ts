import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const MAX_IMAGE_DATA_URL_CHARS = 3_800_000;

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
    .slice(0, 28_000);
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
      page_number?: number;
      language?: string;
    };

    const imageDataUrl = String(body.image_data_url || "");
    if (!/^data:image\/(jpeg|jpg|webp|png);base64,/i.test(imageDataUrl)) {
      return NextResponse.json({ error: "invalid_image" }, { status: 400 });
    }
    if (imageDataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
      return NextResponse.json({ error: "image_too_large" }, { status: 413 });
    }

    const pageNumber = Math.max(1, Math.floor(Number(body.page_number || 1)));
    const language = String(body.language || "eng").slice(0, 40);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.responses.create({
      model: "gpt-5.6-luna",
      reasoning: { effort: "none" },
      max_output_tokens: 6000,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `OCR transcription task. Page ${pageNumber}. Expected language hint: ${language}. ` +
                "Transcribe all readable printed text on the page faithfully. Preserve headings and paragraph order when possible. " +
                "Ignore photographs and decorative elements unless they contain readable text. Do not summarize, explain, translate, or add commentary. " +
                "Return only the transcribed text. If there is genuinely no readable text, return exactly [NO_TEXT].",
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "high",
            },
          ],
        },
      ],
    });

    const text = cleanOcrText(response.output_text);
    const usable = Boolean(text && text !== "[NO_TEXT]" && text.replace(/\s/g, "").length >= 45);

    return NextResponse.json({
      ok: true,
      page_number: pageNumber,
      usable,
      text: usable ? text : "",
      model: "gpt-5.6-luna",
      usage: response.usage || null,
    });
  } catch (error) {
    console.error("Admin AI OCR fallback failed:", error);
    return NextResponse.json({ error: "ocr_ai_failed" }, { status: 500 });
  }
}
