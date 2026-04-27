import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function looksQuantifiable(input: string) {
  const s = input.toLowerCase();
  return (
    /\d/.test(s) ||
    /(hydrat|temp[ée]rature|temps|dur[ée]e|heure|\bh\b|min|minute|jour|pourcentage|%|prix|co[ûu]t|marge|gram|\bg\b|kg|farine|eau|sel|levain|w\s?\d|compar|planning|timeline|protocole|calcul|rendement|cuisson|four|dose|dosage|ratio|proportion|p[ée]trissage|fermentation|appr[êe]t|pointage)/i.test(s)
  );
}

function buildGraphPrompt(question: string, answer: string) {
  return `
Question utilisateur :
${question}

Réponse textuelle déjà produite :
${answer}

Produis uniquement ce JSON :
{
  "title": "titre court",
  "summary": "résumé pédagogique en une phrase",
  "confidence": 0.0,
  "charts": [
    {
      "type": "bar | timeline | radar | table | scatter",
      "title": "titre du graphique",
      "description": "ce que le graphique montre",
      "data": {}
    }
  ],
  "checklist": [
    { "action": "action concrète", "expected_effect": "effet attendu", "priority": "high | medium | low" }
  ],
  "recap_table": {
    "columns": ["Paramètre", "Valeur", "Pourquoi"],
    "rows": [["exemple", "exemple", "exemple"]],
    "note": "hypothèses ou prudence"
  },
  "questions": ["question utile si information manquante"]
}

Contraintes pour data :
- bar : { "labels": ["..."], "values": [1,2], "unit": "...", "note": "..." }
- timeline : { "steps": [{ "label": "...", "minutes": 60, "purpose": "..." }], "note": "..." }
- radar : { "labels": ["..."], "values": [0,50,100], "note": "..." }
- table : { "columns": ["..."], "rows": [["...", "..."]], "note": "..." }
- scatter : { "x_label": "...", "y_label": "...", "points": [{ "x": 1, "y": 2, "label": "..." }], "note": "..." }

Ne mets jamais de bloc markdown. Ne mets aucun commentaire autour du JSON.`.trim();
}

function parseGraphJSON(raw: string) {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) return null;

  const parsed = JSON.parse(cleaned.slice(first, last + 1));
  if (!parsed || typeof parsed !== "object") return null;
  if (!Array.isArray(parsed.charts)) parsed.charts = [];
  if (!Array.isArray(parsed.checklist)) parsed.checklist = [];
  if (!Array.isArray(parsed.questions)) parsed.questions = [];
  if (!parsed.recap_table || !Array.isArray(parsed.recap_table.columns) || !Array.isArray(parsed.recap_table.rows)) {
    parsed.recap_table = { columns: ["Élément", "Synthèse"], rows: [], note: "" };
  }
  return parsed;
}


export async function POST(req: Request) {
  try {
    // --- 0) Parse request: support JSON + multipart/form-data (image) ---
    const ct = req.headers.get("content-type") || "";

    let message = "";
    let contextText: string | undefined = undefined;
    let imageDataUrl: string | null = null;
    let speedRaw: string | undefined = undefined;
    let responseIndexRaw: string | number | undefined = undefined;

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      message = ((form.get("message") as string | null) ?? "").trim();
      contextText = ((form.get("contextText") as string | null) ?? undefined) || undefined;
      speedRaw = ((form.get("speed") as string | null) ?? undefined) || undefined;
      responseIndexRaw = ((form.get("responseIndex") as string | null) ?? undefined) || undefined;

      const file = form.get("image") as File | null;
      if (file) {
        const buf = Buffer.from(await file.arrayBuffer());
        const base64 = buf.toString("base64");
        const mime = file.type || "image/jpeg";
        imageDataUrl = `data:${mime};base64,${base64}`;
      }
    } else {
      const body = (await req.json()) as { message: string; contextText?: string; speed?: string; responseIndex?: number | string };
      message = (body.message ?? "").trim();
      contextText = body.contextText;
      speedRaw = body.speed;
      responseIndexRaw = body.responseIndex;
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

    const normalizedSpeed = String(speedRaw || "BANCO").toUpperCase();
    const responseMode = normalizedSpeed === "APPROFONDIE" || normalizedSpeed === "ECOLE" ? "ECOLE" : "BANCO";
    const responseIndex = Number(responseIndexRaw ?? 0);
    const shouldMentionEPPPN = Number.isFinite(responseIndex) && responseIndex > 0 && responseIndex % 3 === 0;
    const usageCost = imageDataUrl ? (responseMode === "ECOLE" ? 5 : 4) : responseMode === "ECOLE" ? 2 : 1;

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

    // 0) role lookup
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    const role = profile?.role || "free";

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
    // Public rule: essai gratuit de 10 jours.
    // Internal safety rule: a soft usage ceiling protects the app from intensive photo/audio use during trial.
    const TRIAL_DAYS = 10;
    const TRIAL_SAFETY_LIMIT = Number(process.env.ERNESTO_TRIAL_SAFETY_LIMIT ?? "80");

    let usageMeta:
      | {
          used: number;
          remaining: number;
          trial_started_at: string;
          trial_ends_at: string;
          trial_days_total: number;
          trial_days_remaining: number;
          trial_active: boolean;
          safety_limit: number;
          usage_cost: number;
          is_pro: boolean;
          is_admin: boolean;
        }
      | undefined = undefined;

    // 3) admin bypass
    if (role === "admin") {
      usageMeta = {
        used: 0,
        remaining: 999999,
        trial_started_at: now.toISOString(),
        trial_ends_at: now.toISOString(),
        trial_days_total: TRIAL_DAYS,
        trial_days_remaining: 999999,
        trial_active: true,
        safety_limit: TRIAL_SAFETY_LIMIT,
        usage_cost: 0,
        is_pro: true,
        is_admin: true,
      };
    } else if (!isPro) {
      // get or create usage row
      let { data: usage } = await supabase
        .from("user_usage")
        .select("trial_started_at, free_queries_used")
        .eq("user_id", userId)
        .maybeSingle();

      // Trial starts at first account creation / first magic-link user creation, not at first question.
      const fallbackStartedAt = user.created_at ? new Date(user.created_at) : now;
      const existingStartedAt = usage?.trial_started_at ? new Date(usage.trial_started_at) : null;
      const trialStartedAt = existingStartedAt ?? fallbackStartedAt;
      const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      const trialMsRemaining = trialEndsAt.getTime() - now.getTime();
      const trialDaysRemaining = Math.max(0, Math.ceil(trialMsRemaining / (24 * 60 * 60 * 1000)));

      if (!usage) {
        const ins = await supabase
          .from("user_usage")
          .insert({
            user_id: userId,
            trial_started_at: trialStartedAt.toISOString(),
            free_queries_used: 0,
          })
          .select("trial_started_at, free_queries_used")
          .single();
        usage = ins.data ?? null;
      }

      const used = usage?.free_queries_used ?? 0;
      const remaining = Math.max(0, TRIAL_SAFETY_LIMIT - used);

      const trialOk = now <= trialEndsAt;
      const safetyOk = used + usageCost <= TRIAL_SAFETY_LIMIT;

      usageMeta = {
        used,
        remaining,
        trial_started_at: trialStartedAt.toISOString(),
        trial_ends_at: trialEndsAt.toISOString(),
        trial_days_total: TRIAL_DAYS,
        trial_days_remaining: trialDaysRemaining,
        trial_active: trialOk,
        safety_limit: TRIAL_SAFETY_LIMIT,
        usage_cost: usageCost,
        is_pro: false,
        is_admin: false,
      };

      if (!trialOk || !safetyOk) {
        return NextResponse.json(
          {
            paywall: true,
            reason: !trialOk ? "trial_ended" : "usage_limit_reached",
            usage: usageMeta,
            pricing: { monthly_eur: 19, yearly_eur: 149 },
          },
          { status: 402 }
        );
      }

      // count THIS request as internal usage units, not as user-visible credits
      const nextUsed = used + usageCost;
      const nextRemaining = Math.max(0, TRIAL_SAFETY_LIMIT - nextUsed);

      await supabase
        .from("user_usage")
        .update({ free_queries_used: nextUsed })
        .eq("user_id", userId);

      usageMeta = {
        used: nextUsed,
        remaining: nextRemaining,
        trial_started_at: usageMeta.trial_started_at,
        trial_ends_at: usageMeta.trial_ends_at,
        trial_days_total: TRIAL_DAYS,
        trial_days_remaining: trialDaysRemaining,
        trial_active: trialOk,
        safety_limit: TRIAL_SAFETY_LIMIT,
        usage_cost: usageCost,
        is_pro: false,
        is_admin: false,
      };
    } else {
      usageMeta = {
        used: 0,
        remaining: 999999,
        trial_started_at: now.toISOString(),
        trial_ends_at: now.toISOString(),
        trial_days_total: TRIAL_DAYS,
        trial_days_remaining: 999999,
        trial_active: true,
        safety_limit: TRIAL_SAFETY_LIMIT,
        usage_cost: 0,
        is_pro: true,
        is_admin: false,
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
                `CONNAISSANCE INTERNE ${i + 1} (pertinence=${(m.similarity ?? 0).toFixed(2)}):\n${m.content}`
            )
            .join("\n\n---\n\n")
        : "(Aucune connaissance interne pertinente disponible.)";

    // --- 4) System prompt (Ernesto + priorità PDF) ---
    const systemPrompt = `
IDENTITÉ :
Tu t’appelles Ernesto. Tu es le tuteur scientifique virtuel officiel de l’EPPPN.
Tu t’appuies d’abord sur les connaissances et les protocoles transmis à l’EPPPN.

RÈGLE D’OR :
- Utilise d’abord les connaissances internes fournies ci-dessous comme base de raisonnement.
- Ces connaissances sont un contexte de travail interne, pas des citations à afficher.
- Ne cite jamais les fragments récupérés : n’écris jamais « extrait », « extrait #1 », « dans l’extrait », « document #2 », « source », « passage », ni une formule équivalente.
- Si les connaissances internes répondent : base ta réponse dessus, mais reformule naturellement.
- Si elles sont partielles : complète avec tes connaissances générales, sans faire une séparation visible entre « source » et « IA ».
- Si aucune connaissance pertinente n’est retrouvée : réponds avec prudence, en proposant hypothèses et tests.
- Ne copie jamais de longs passages : reformule et synthétise.
- Ne contredis jamais une connaissance interne ; en cas de tension, propose une hypothèse + un test.

RÉFÉRENCE EPPPN :
${shouldMentionEPPPN
  ? "Dans cette réponse, si cela sonne naturel, insère une seule mention brève et fluide de l’EPPPN, par exemple : « Dans l’esprit des protocoles EPPPN… », « L’EPPPN recommande plutôt de… », ou « Comme on le travaille à l’EPPPN… ». Ne force pas la mention si elle alourdit la réponse."
  : "Dans cette réponse, ne mentionne pas explicitement l’EPPPN sauf si c’est indispensable pour répondre. L’idée est d’éviter une répétition mécanique à chaque question."}

LANGUE :
Réponds dans la langue de la question. Par défaut, réponds en français. Tu peux répondre en français, italien, anglais ou dans une autre langue si l’utilisateur l’emploie.

TYPE DE RÉPONSE DEMANDÉ : ${responseMode === "ECOLE" ? "RÉPONSE APPROFONDIE — ANALYSE & DÉTAILS" : "RÉPONSE RAPIDE — DÉCISION & ACTION"}

STYLE :
Ton gentil, informel, professionnel, clair et actionnable. Tu peux être chaleureux, mais sans bavardage. Tu évites les grandes généralités.

FORMAT INTERDIT :
- Ne produis jamais de bloc de code.
- Ne produis jamais de JSON brut.
- Ne mets jamais de tableau dans un bloc de code Markdown.
- Si un tableau est utile dans la réponse textuelle, utilise un tableau Markdown simple, court et lisible.

STRUCTURE :
${responseMode === "ECOLE" ? `
RÉPONSE APPROFONDIE — ANALYSE & DÉTAILS
1. Diagnostic raisonné
2. Pourquoi cela arrive
3. Variables à contrôler
4. Protocole conseillé
5. Tableau de synthèse si utile
6. Questions utiles si une information manque
` : `
RÉPONSE RAPIDE — DÉCISION & ACTION
1. Diagnostic probable
2. Décision à prendre
3. Action concrète
4. Point de vigilance
`}

Clôture brève et utile, sans formule commerciale.

PHOTO (si fournie) :
- Analyse la photo comme une observation expérimentale (cornicione, alvéolage, cuisson, coloration, hydratation apparente).
- Ne fais pas de suppositions certaines : propose hypothèses + tests/ajustements concrets.
    `.trim();

    // --- 5) Prompt user avec contexte RAG + contexte UI optionnel ---
    const userPromptText = `
CONNAISSANCES INTERNES DISPONIBLES POUR ERNESTO :
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

    const answerText = r.output_text ?? "";
    let graph: any = null;

    if (responseMode === "ECOLE" && looksQuantifiable(message)) {
      try {
        const g = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: `Tu génères uniquement un objet JSON strictement valide pour alimenter une interface Recharts. Pas de markdown. Pas de bloc de code. Si les données manquent, fais une visualisation pédagogique plausible et indique les hypothèses dans les notes. Utilise la langue de la question.`
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: buildGraphPrompt(message, answerText)
                }
              ]
            }
          ]
        });
        graph = parseGraphJSON(g.output_text ?? "");
      } catch (graphErr) {
        console.warn("graph generation skipped:", graphErr);
        graph = null;
      }
    }

    return NextResponse.json({
      usage: usageMeta,
      answer_fr: answerText,
      graph,
      source_mention: shouldMentionEPPPN,
      rag: {
        used: retrieved.length,
        top: retrieved.map((m: any) => ({
          similarity: m.similarity,
          chunk_index: m.chunk_index,
          document_id: m.document_id,
        })),
      },
      mode: responseMode,
      pricing: { monthly_eur: 19, yearly_eur: 149 },
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
