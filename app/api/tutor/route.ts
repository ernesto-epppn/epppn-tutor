import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // --- 0) Parse request: support JSON + multipart/form-data (image) ---
    const ct = req.headers.get("content-type") || "";

    let message = "";
    let contextText: string | undefined = undefined;
    let imageDataUrl: string | null = null;

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      message = ((form.get("message") as string | null) ?? "").trim();
      contextText = ((form.get("contextText") as string | null) ?? undefined) || undefined;

      const file = form.get("image") as File | null;
      if (file) {
        const buf = Buffer.from(await file.arrayBuffer());
        const base64 = buf.toString("base64");
        const mime = file.type || "image/jpeg";
        imageDataUrl = `data:${mime};base64,${base64}`;
      }
    } else {
      const body = (await req.json()) as { message: string; contextText?: string };
      message = (body.message ?? "").trim();
      contextText = body.contextText;
    }

    // --- 1) Env checks ---
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }
    if (!message) {
      return NextResponse.json({ error: "Empty message" }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Supabase (server)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

        // --- 1bis) Paywall gate (trial + quota + abonnement) ---
    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!bearer) {
      return NextResponse.json(
        { error: "auth_required", paywall: true, reason: "login_required" },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(bearer);
    const user = userData?.user;

    if (userErr || !user) {
      return NextResponse.json(
        { error: "invalid_session", paywall: true, reason: "invalid_session" },
        { status: 401 }
      );
    }

    const userId = user.id;
    const now = new Date();

    // 1) entitlement (Pro)
    const { data: ent } = await supabase
      .from("user_entitlements")
      .select("status,current_period_end")
      .eq("user_id", userId)
      .maybeSingle();

    const isPro =
      ent?.status === "active" &&
      (!ent.current_period_end || new Date(ent.current_period_end) > now);

    // 2) free gate
    const FREE_LIMIT = 10;
    const TRIAL_DAYS = 4;

    let usageMeta:
      | { used: number; remaining: number; trial_started_at: string; trial_ends_at: string; is_pro: boolean }
      | undefined = undefined;

    if (!isPro) {
      // get or create usage row
      let { data: usage } = await supabase
        .from("user_usage")
        .select("trial_started_at, free_queries_used")
        .eq("user_id", userId)
        .maybeSingle();

      if (!usage) {
        const ins = await supabase
          .from("user_usage")
          .insert({ user_id: userId })
          .select("trial_started_at, free_queries_used")
          .single();
        usage = ins.data ?? null;
      }

      const trialStartedAt = usage?.trial_started_at ? new Date(usage.trial_started_at) : now;
      const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

      const used = usage?.free_queries_used ?? 0;
      const remaining = Math.max(0, FREE_LIMIT - used);

      const trialOk = now <= trialEndsAt;
      const quotaOk = used < FREE_LIMIT;

      usageMeta = {
        used,
        remaining,
        trial_started_at: trialStartedAt.toISOString(),
        trial_ends_at: trialEndsAt.toISOString(),
        is_pro: false,
      };

      if (!trialOk || !quotaOk) {
        return NextResponse.json(
          {
            paywall: true,
            reason: !trialOk ? "trial_ended" : "quota_reached",
            usage: usageMeta,
          },
          { status: 402 }
        );
      }

      // count THIS request
      const nextUsed = used + 1;
      const nextRemaining = Math.max(0, FREE_LIMIT - nextUsed);

      await supabase.from("user_usage").update({ free_queries_used: nextUsed }).eq("user_id", userId);

      usageMeta = {
        used: nextUsed,
        remaining: nextRemaining,
        trial_started_at: usageMeta.trial_started_at,
        trial_ends_at: usageMeta.trial_ends_at,
        is_pro: false,
      };
    } else {
      usageMeta = {
        used: 0,
        remaining: 999999,
        trial_started_at: now.toISOString(),
        trial_ends_at: now.toISOString(),
        is_pro: true,
      };
    }

    // --- 2) Embed della domanda (solo sul testo) ---
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });
    const queryEmbedding = emb.data[0].embedding;

    // --- 3) Recupera i chunk più pertinenti (RAG) ---
    const { data: matches, error: matchErr } = await supabase.rpc("match_chunks", {
      query_embedding: queryEmbedding,
      match_count: 6,
    });

    if (matchErr) {
      // non blocchiamo: Ernesto risponde comunque
      console.warn("match_chunks error:", matchErr);
    }

    const retrieved = (matches ?? [])
      .filter((m: any) => (m.similarity ?? 0) >= 0.2) // soglia morbida
      .slice(0, 6);

    const retrievedContext =
      retrieved.length > 0
        ? retrieved
            .map(
              (m: any, i: number) =>
                `EXTRAIT #${i + 1} (sim=${(m.similarity ?? 0).toFixed(2)}):\n${m.content}`
            )
            .join("\n\n---\n\n")
        : "(Aucun extrait pertinent trouvé dans les documents.)";

    // --- 4) System prompt (Ernesto + priorità PDF) ---
    const systemPrompt = `
IDENTITÉ :
Tu t’appelles Ernesto. Tu es le tuteur scientifique virtuel officiel de l’EPPPN.

RÈGLE D’OR :
- Priorité absolue aux extraits "DOCUMENTS EPPPN / LIVRES" fournis ci-dessous.
- Si les documents répondent : base ta réponse dessus.
- Si les documents sont partiels : complète avec tes connaissances générales en le signalant.
- Ne copie jamais de longs passages : résume et cite brièvement.
- Ne contredis jamais un extrait ; en cas de tension, propose une hypothèse + un test.

STYLE :
Collaboratif, rigoureux, très actionnable, pédagogique.

STRUCTURE (en français) :
A) Diagnostic (4–10 lignes, plus “puissant”, avec hypothèses et variables)
B) Checklist (3–7 actions : action → effet attendu)
C) Tableau récapitulatif (3–8 lignes)
D) Questions (0–2) si infos manquent
E) Clôture: “Est-ce que tu veux que je t’aide sur autre chose…?”

MODE GRAPHIQUE :
Si la demande implique des paramètres/valeurs/comparaisons, produis des graphiques JSON (table/bar/timeline/radar).

PHOTO (si fournie) :
- Analyse la photo comme une observation expérimentale (cornicione, alveolatura, cuisson, coloration, hydratation apparente).
- Ne fais pas de suppositions “certaines” : propose hypothèses + tests/ajustements concrets.
    `.trim();

    // --- 5) Prompt user avec contexte RAG + contexte UI optionnel ---
    const userPromptText = `
DOCUMENTS EPPPN / LIVRES (extraits) :
${retrievedContext}

Contexte utilisateur (optionnel) :
${contextText ?? "(non fourni)"}

Question :
${message}
`.trim();

    // --- 6) Build content: testo + (opzionale) immagine ---
    const userContent: any[] = [{ type: "input_text", text: userPromptText }];

    if (imageDataUrl) {
      userContent.push({
        type: "input_text",
        text: "PHOTO FOURNIE : analyse-la en priorité pour le diagnostic (en respectant les règles ci-dessus).",
      });
      userContent.push({ type: "input_image", image_url: imageDataUrl });
    }

    const r = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content: userContent },
      ],
    });

    return NextResponse.json({
      usage: usageMeta,
      answer_fr: r.output_text ?? "",
      rag: {
        used: retrieved.length,
        top: retrieved.map((m: any) => ({
          similarity: m.similarity,
          chunk_index: m.chunk_index,
          document_id: m.document_id,
        })),
      },
      vision: {
        received_image: Boolean(imageDataUrl),
      },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: "Server error", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
