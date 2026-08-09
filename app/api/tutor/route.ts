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

type ActionFlowchartStep = {
  action: string;
  control: string;
  if_ok: string;
  if_not: string;
};

type ActionFlowchart = {
  title: string;
  start: string;
  steps: ActionFlowchartStep[];
  outcome: string;
  caution: string;
  clarification_required: boolean;
  clarification_question: string;
  clarification_options: string[];
};

const ACTION_FLOWCHART_FORMAT = {
  type: "json_schema" as const,
  name: "ernesto_action_flowchart",
  description: "Un plan d'action Ernesto sous forme de diagramme de flux opérationnel.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: {
        type: "string",
        description: "Décision résumée en une à trois phrases, sans recopier le diagramme.",
      },
      flowchart: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          start: { type: "string" },
          steps: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                action: { type: "string" },
                control: { type: "string" },
                if_ok: { type: "string" },
                if_not: { type: "string" },
              },
              required: ["action", "control", "if_ok", "if_not"],
            },
          },
          outcome: { type: "string" },
          caution: { type: "string" },
          clarification_required: { type: "boolean" },
          clarification_question: {
            type: "string",
            description: "Une seule question décisive, ou une chaîne vide si aucune précision n'est nécessaire.",
          },
          clarification_options: {
            type: "array",
            maxItems: 3,
            items: { type: "string" },
            description: "Deux ou trois réponses courtes si une précision est nécessaire, sinon un tableau vide.",
          },
        },
        required: [
          "title",
          "start",
          "steps",
          "outcome",
          "caution",
          "clarification_required",
          "clarification_question",
          "clarification_options",
        ],
      },
    },
    required: ["answer", "flowchart"],
  },
};

function cleanFlowchartText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseActionFlowchart(raw: string): { answer: string; flowchart: ActionFlowchart } | null {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) return null;

  try {
    const parsed = objectRecord(JSON.parse(cleaned.slice(first, last + 1)));
    const flow = objectRecord(parsed?.flowchart);
    const steps = Array.isArray(flow?.steps)
      ? flow.steps
          .slice(0, 5)
          .map((value: unknown) => {
            const step = objectRecord(value);
            return {
              action: cleanFlowchartText(step?.action, 220),
              control: cleanFlowchartText(step?.control, 200),
              if_ok: cleanFlowchartText(step?.if_ok, 180),
              if_not: cleanFlowchartText(step?.if_not, 220),
            };
          })
          .filter((step: ActionFlowchartStep) =>
            Boolean(step.action && step.control && step.if_ok && step.if_not)
          )
      : [];

    const answer = cleanFlowchartText(parsed?.answer, 900);
    const flowchart: ActionFlowchart = {
      title: cleanFlowchartText(flow?.title, 120),
      start: cleanFlowchartText(flow?.start, 180),
      steps,
      outcome: cleanFlowchartText(flow?.outcome, 220),
      caution: cleanFlowchartText(flow?.caution, 220),
      clarification_required: flow?.clarification_required === true,
      clarification_question: cleanFlowchartText(flow?.clarification_question, 220),
      clarification_options: Array.isArray(flow?.clarification_options)
        ? flow.clarification_options
            .map((option: unknown) => cleanFlowchartText(option, 100))
            .filter(Boolean)
            .slice(0, 3)
        : [],
    };

    if (
      flowchart.clarification_required &&
      (!flowchart.clarification_question || flowchart.clarification_options.length < 2)
    ) {
      flowchart.clarification_required = false;
      flowchart.clarification_question = "";
      flowchart.clarification_options = [];
    }

    if (!answer || !flowchart.title || !flowchart.start || !flowchart.outcome || steps.length < 3) {
      return null;
    }
    return { answer, flowchart };
  } catch {
    return null;
  }
}

function normalizeEmailForAccess(raw: unknown) {
  return String(raw || "").trim().toLowerCase();
}

function addMonthsClamped(date: Date, monthsRaw: unknown) {
  const monthsNumber = Number(monthsRaw ?? 6);
  const months = Number.isFinite(monthsNumber)
    ? Math.min(6, Math.max(1, Math.floor(monthsNumber)))
    : 6;

  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function getEnvAdminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function ensureV14ClosedAccess(params: {
  supabase: any;
  userId: string;
  userEmail: string;
  role: string;
  now: Date;
}) {
  const { supabase, userId, userEmail, role, now } = params;
  const normalizedEmail = normalizeEmailForAccess(userEmail);

  if (role === "admin" || getEnvAdminEmails().includes(normalizedEmail)) {
    return {
      ok: true as const,
      accessType: "admin",
      accessEndsAt: null as string | null,
      activatedAt: now.toISOString(),
    };
  }

  if (!normalizedEmail) {
    return {
      ok: false as const,
      status: 403,
      reason: "missing_email",
      message: "Impossible de vérifier l’adresse email associée à cette session.",
    };
  }

  const { data: allowedEmail, error: allowedEmailError } = await supabase
    .from("epppn_allowed_emails")
    .select(
      "email,active,access_months,activated_at,access_ends_at,activated_user_id,blocked_at,blocked_reason"
    )
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (allowedEmailError) {
    console.error("V14 epppn_allowed_emails lookup failed:", allowedEmailError.message);
    return {
      ok: false as const,
      status: 500,
      reason: "allowlist_lookup_failed",
      message: "Impossible de vérifier l’accès pour le moment. Réessayez dans quelques instants.",
    };
  }

  if (!allowedEmail || allowedEmail.active !== true) {
    return {
      ok: false as const,
      status: 403,
      reason: "email_not_allowed",
      message:
        "Cette adresse email n’est pas associée à un accès Ernesto. Dans cette première phase, Ernesto est réservé aux stagiaires formés à l’EPPPN.",
    };
  }

  if (allowedEmail.blocked_at) {
    return {
      ok: false as const,
      status: 403,
      reason: "email_blocked",
      message: "Cet accès est temporairement bloqué pour des raisons de sécurité.",
    };
  }

  if (allowedEmail.activated_user_id && allowedEmail.activated_user_id !== userId) {
    const { error: securityEventError } = await supabase
      .from("epppn_allowed_emails")
      .update({
        last_security_event_at: now.toISOString(),
        last_security_event: "activated_user_mismatch",
        updated_at: now.toISOString(),
      })
      .eq("email", normalizedEmail);

    if (securityEventError) {
      console.warn("V14.2 security event update failed:", securityEventError.message);
    }

    return {
      ok: false as const,
      status: 403,
      reason: "account_already_activated",
      message:
        "Ce compte stagiaire est déjà associé à un autre utilisateur. Contactez l’EPPPN si vous avez changé de compte.",
    };
  }

  const activatedAt = allowedEmail.activated_at ? new Date(allowedEmail.activated_at) : now;
  const accessEndsAt = allowedEmail.access_ends_at
    ? new Date(allowedEmail.access_ends_at)
    : addMonthsClamped(activatedAt, allowedEmail.access_months);

  const mustPersistActivation =
    !allowedEmail.activated_at || !allowedEmail.access_ends_at || !allowedEmail.activated_user_id;

  if (mustPersistActivation) {
    const { error: activationError } = await supabase
      .from("epppn_allowed_emails")
      .update({
        activated_at: activatedAt.toISOString(),
        access_ends_at: accessEndsAt.toISOString(),
        activated_user_id: userId,
        updated_at: now.toISOString(),
      })
      .eq("email", normalizedEmail);

    if (activationError) {
      console.warn("V14 allowed email activation update failed:", activationError.message);
    }
  }

  if (accessEndsAt <= now) {
    return {
      ok: false as const,
      status: 403,
      reason: "access_expired",
      message: "La période d’accès à Ernesto associée à cette adresse email est arrivée à son terme.",
    };
  }

  return {
    ok: true as const,
    accessType: "stagiaire_epppn",
    accessEndsAt: accessEndsAt.toISOString(),
    activatedAt: activatedAt.toISOString(),
  };
}

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") || "";

    let message = "";
    let contextText: string | undefined = undefined;
    const imageDataUrls: string[] = [];
    let speedRaw: string | undefined = undefined;
    let responseIndexRaw: string | number | undefined = undefined;
    let presentationRaw: string | undefined = undefined;

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      message = ((form.get("message") as string | null) ?? "").trim();
      contextText = ((form.get("contextText") as string | null) ?? undefined) || undefined;
      speedRaw = ((form.get("speed") as string | null) ?? undefined) || undefined;
      responseIndexRaw = ((form.get("responseIndex") as string | null) ?? undefined) || undefined;
      presentationRaw = ((form.get("presentation") as string | null) ?? undefined) || undefined;

      const legacyImage = form.get("image");
      const files = [...form.getAll("images"), legacyImage]
        .filter((value): value is File => value instanceof File && value.size > 0)
        .slice(0, 2);
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
        }
        if (file.size > 2 * 1024 * 1024) {
          return NextResponse.json({ error: "Image too large" }, { status: 413 });
        }
        const buf = Buffer.from(await file.arrayBuffer());
        const base64 = buf.toString("base64");
        const mime = file.type || "image/jpeg";
        imageDataUrls.push(`data:${mime};base64,${base64}`);
      }
    } else {
      const body = (await req.json()) as {
        message: string;
        contextText?: string;
        speed?: string;
        responseIndex?: number | string;
        presentation?: string;
      };
      message = (body.message ?? "").trim();
      contextText = body.contextText;
      speedRaw = body.speed;
      responseIndexRaw = body.responseIndex;
      presentationRaw = body.presentation;
    }

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

    const wantsActionFlowchart = String(presentationRaw || "").toLowerCase() === "flowchart";
    const normalizedSpeed = String(speedRaw || "BANCO").toUpperCase();
    const responseMode =
      !wantsActionFlowchart && (normalizedSpeed === "APPROFONDIE" || normalizedSpeed === "ECOLE")
        ? "ECOLE"
        : "BANCO";
    const responseIndex = Number(responseIndexRaw ?? 0);
    const shouldMentionEPPPN =
      Number.isFinite(responseIndex) && responseIndex > 0 && responseIndex % 3 === 0;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

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
    const userEmail = (user.email || "").trim().toLowerCase();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    const role = profile?.role || "free";
    const isAdmin = role === "admin" || getEnvAdminEmails().includes(userEmail);

    const { data: ent } = await supabase
      .from("user_entitlements")
      .select("status,current_period_end,plan,stripe_subscription_id")
      .eq("user_id", userId)
      .maybeSingle();

    const hasPaidPlan =
      Boolean(ent?.stripe_subscription_id) || ent?.plan === "monthly" || ent?.plan === "yearly";
    const isPaidPro =
      hasPaidPlan &&
      ent?.status === "active" &&
      (!ent.current_period_end || new Date(ent.current_period_end) > now);

    let closedAccess: any = null;
    if (!isAdmin && !isPaidPro) {
      closedAccess = await ensureV14ClosedAccess({
        supabase,
        userId,
        userEmail,
        role,
        now,
      });

      if (!closedAccess.ok) {
        return NextResponse.json(
          {
            error: "closed_access",
            closed_access: true,
            reason: closedAccess.reason,
            message: closedAccess.message,
          },
          { status: closedAccess.status }
        );
      }
    }

    const ACCESS_MONTHS_FALLBACK = 6;

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
          plan?: string;
        }
      | undefined = undefined;

    if (isAdmin) {
      usageMeta = {
        used: 0,
        remaining: 999999,
        trial_started_at: now.toISOString(),
        trial_ends_at: now.toISOString(),
        trial_days_total: ACCESS_MONTHS_FALLBACK * 30,
        trial_days_remaining: 999999,
        trial_active: true,
        safety_limit: 999999,
        usage_cost: 0,
        is_pro: true,
        is_admin: true,
        plan: "admin",
      };
    } else if (isPaidPro) {
      const endDate = ent?.current_period_end ? new Date(ent.current_period_end) : now;
      const daysRemaining = ent?.current_period_end
        ? Math.max(
            0,
            Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
          )
        : 999999;

      usageMeta = {
        used: 0,
        remaining: 999999,
        trial_started_at: now.toISOString(),
        trial_ends_at: ent?.current_period_end || now.toISOString(),
        trial_days_total: ACCESS_MONTHS_FALLBACK * 30,
        trial_days_remaining: daysRemaining,
        trial_active: true,
        safety_limit: 999999,
        usage_cost: 0,
        is_pro: true,
        is_admin: false,
        plan: ent?.plan || "active",
      };
    } else if (closedAccess?.ok) {
      const startDate = new Date(closedAccess.activatedAt);
      const endDate = new Date(closedAccess.accessEndsAt);
      const totalDays = Math.max(
        1,
        Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000))
      );
      const daysRemaining = Math.max(
        0,
        Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      );

      usageMeta = {
        used: 0,
        remaining: 999999,
        trial_started_at: closedAccess.activatedAt,
        trial_ends_at: closedAccess.accessEndsAt,
        trial_days_total: totalDays,
        trial_days_remaining: daysRemaining,
        trial_active: true,
        safety_limit: 999999,
        usage_cost: 0,
        is_pro: true,
        is_admin: false,
        plan: "stagiaire_epppn",
      };
    } else {
      return NextResponse.json(
        {
          error: "closed_access",
          closed_access: true,
          reason: "access_not_available",
          message: "Votre accès à Ernesto n’est pas disponible.",
        },
        { status: 403 }
      );
    }

    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });
    const queryEmbedding = emb.data[0].embedding;

    const { data: matches, error: matchErr } = await supabase.rpc("match_chunks", {
      query_embedding: queryEmbedding,
      match_count: 6,
    });

    if (matchErr) {
      console.warn("match_chunks error:", matchErr);
    }

    const retrieved = (matches ?? [])
      .filter((m: any) => (m.similarity ?? 0) >= 0.2)
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

    const systemPrompt = `
IDENTITÉ :
- Tu t’appelles Ernesto. Tu es le tuteur scientifique virtuel officiel de l’EPPPN.
- Tu t’appuies d’abord sur les connaissances et les protocoles transmis à l’EPPPN.
- Ne te comporte pas comme un assistant généraliste.
- Ramène la réponse vers l’observation, le geste, le protocole, le test ou l’organisation du travail.

PÉRIMÈTRE D’ERNESTO :
- Pizza, panification naturelle, pain, focaccias, farines, levain, fermentation, cuisson, équipements et organisation du travail en restauration.
- Tu peux traiter les questions économiques ou organisationnelles lorsqu’elles concernent directement cette activité professionnelle.
- Pour une question hors périmètre, refuse brièvement et propose une reformulation pertinente.

MÉTHODE :
- Diagnostic avant protocole.
- Ne donne jamais une recette magique ou une solution unique sans considérer les variables décisives.
- Raisonne notamment à partir de la farine, hydratation, température, temps, levain/levure, fermentation, pétrissage, cuisson et matériel, mais ne récite pas cette liste si elle n’est pas pertinente.
- Quand une donnée manque, distingue clairement ce qui est observé, ce qui est probable et ce qui reste à vérifier.
- Propose des tests simples et des corrections progressives.
- Sois exhaustif sur les variables qui peuvent réellement changer la décision, pas encyclopédique sur tout le sujet.

FIABILITÉ :
- N’invente pas de chiffres, normes, seuils ou références précises.
- Une valeur chiffrée doit être soutenue par les connaissances internes ou être un repère professionnel que tu peux défendre avec prudence.
- Si tu hésites entre plusieurs causes, classe-les par plausibilité au lieu de les présenter comme équivalentes.
- Dis ce qui ferait changer ton diagnostic.

FORME MOBILE-FIRST :
- Paragraphes courts, titres très courts et listes limitées.
- Une idée par paragraphe.
- Pas de bloc de code ni de JSON brut.
- Évite les tableaux dans Action.
- Dans Analyse, un tableau n’est autorisé que s’il clarifie vraiment une comparaison : maximum 3 colonnes et 5 lignes, cellules courtes.
- Ne crée jamais de longues lignes artificielles, de suites de paramètres séparés par des barres verticales ou de pseudo-tableaux textuels.
- Utilise des titres Markdown de niveau 2 (##) pour les sections afin que l’interface les rende clairement.

PERSONNALISATION :
- Ajuste le niveau au profil utilisateur et à son contexte de travail.
- Débutant : explique le mécanisme utile avec des mots simples.
- Professionnel : privilégie paramètres, tolérances, arbitrages et organisation.
- N’infantilise jamais l’utilisateur.

ANALYSE D’IMAGE :
- Décris d’abord ce qui est réellement visible.
- Distingue observation, hypothèse et contrôle à effectuer.
- Une photo ne suffit jamais à rendre certaine une cause invisible.

CONNAISSANCES INTERNES / RAG :
- Tu raisonnes d’abord à partir des connaissances internes disponibles, issues notamment des savoirs, protocoles, pratiques et documents transmis à l’EPPPN.
- Ces connaissances restent internes : ne parle jamais d’« extrait », de « source », de « document », de « passage » ou de « RAG » dans la réponse.
- Reformule et synthétise ; ne copie pas de longs passages.
- Si les connaissances internes sont partielles, complète prudemment avec tes connaissances générales sans créer une séparation artificielle entre les deux.
- Ne contredis pas gratuitement les connaissances internes ; si une tension existe, explique l’hypothèse et propose un test pratique.

TON :
- Cordial, clair, professionnel, accessible et techniquement exigeant.
- Pas de flatterie automatique, pas de bavardage, pas de formule commerciale.
- Évite « excellente question », « bravo », « bien sûr » ou « avec plaisir » sauf justification réelle.

RÉFÉRENCE EPPPN :
${shouldMentionEPPPN
  ? "Si cela sonne naturel, insère une seule mention brève de l’EPPPN. Ne la force jamais."
  : "Ne mentionne pas explicitement l’EPPPN sauf si c’est indispensable pour répondre."}

LANGUE :
Réponds dans la langue de la question. Par défaut, réponds en français.

MODE DEMANDÉ : ${responseMode === "ECOLE" ? "ANALYSE" : "ACTION"}

${responseMode === "ECOLE" ? `
MODE ANALYSE — comprendre pour mieux décider
Objectif : fournir un raisonnement pédagogique complet mais sélectif. L’utilisateur doit comprendre ce qui se passe, savoir quoi vérifier et pouvoir adapter le protocole.

Organisation adaptative :
## Lecture du problème
- Reformule l’observation en 1 à 3 phrases et explicite les hypothèses nécessaires.

## Hypothèses classées
- Donne 2 à 4 causes maximum, par ordre de plausibilité.
- Pour chacune : indice en faveur, indice qui manquerait, conséquence pratique.

## Mécanisme utile
- Explique uniquement les mécanismes qui permettent de comprendre la décision. Pas de cours général hors sujet.

## Variables décisives
- Priorise 3 à 6 variables qui changent réellement le résultat ou le diagnostic.
- Relie chaque variable à son effet attendu.

## Protocole de vérification et de correction
- Propose une séquence concrète, ordonnée, testable.
- Sépare ce qu’il faut contrôler maintenant de ce qu’il faut modifier au prochain essai lorsque c’est pertinent.

## Comment vérifier
- Donne les signes observables qui permettront de savoir si la correction fonctionne.
- Précise ce qui ferait changer le diagnostic.

Règles :
- Ne force pas toutes les sections si la question est simple ; fusionne celles qui se recouvrent.
- Une bonne Analyse est exhaustive sur les causes et variables décisives, mais reste concise sur le reste.
- Termine par 1 à 3 questions seulement si leur réponse modifierait réellement le conseil.
` : `
MODE ACTION — décider et agir maintenant
Objectif : donner une réponse immédiatement exploitable au banc, au four ou dans l’organisation du service, sans devenir simpliste.

Organisation adaptative :
## Décision
- Commence par ce que tu ferais maintenant, en 1 ou 2 phrases.
- Si le diagnostic est incertain, dis quelle hypothèse tu privilégies et pourquoi.

## Plan d’action
- Donne 3 à 5 étapes maximum, dans l’ordre d’exécution.
- Chaque étape doit être concrète : geste, réglage, contrôle ou décision.

## Contrôle
- Indique ce qu’il faut observer après l’action et l’effet attendu.
- Donne un repère chiffré seulement s’il est fiable et réellement utile.

## À éviter
- Ajoute cette section uniquement s’il existe une erreur fréquente ou un risque important.

Règles :
- Pas de théorie pour elle-même.
- Pas de répétition de la question.
- Pas de liste générique de toutes les variables possibles.
- Si une donnée manque, fais une hypothèse visible et pose au maximum une question qui change réellement la décision.
- Une réponse Action peut être courte, mais elle ne doit jamais être banale : elle doit contenir un choix, un ordre d’action et un critère de contrôle.
`}

${wantsActionFlowchart ? `
PRÉSENTATION DEMANDÉE — DIAGRAMME DE FLUX
- Résume la décision en 1 à 3 phrases, puis construis un parcours visuel de 3 à 5 étapes.
- Chaque étape associe une action concrète à un contrôle observable.
- Pour chaque contrôle, indique la suite si le résultat est conforme et la correction à effectuer sinon.
- La branche « non » doit ramener vers un nouveau contrôle, pas vers une impasse.
- Utilise des formulations très courtes, lisibles sur téléphone, sans jargon inutile.
- Le point de départ, le résultat attendu et l’éventuel point de vigilance doivent être explicites.
- S'il manque une information qui changerait réellement le plan, active clarification_required et formule une seule question avec 2 ou 3 réponses courtes et mutuellement exclusives.
- Si aucune précision décisive ne manque, clarification_required vaut false, clarification_question est vide et clarification_options est un tableau vide.
` : ""}

PHOTO (si fournie) :
- Analyse-la comme une observation expérimentale : cornicione, alvéolage, cuisson, coloration, structure apparente.
- Propose hypothèses + contrôles, jamais une certitude visuelle injustifiée.
${imageDataUrls.length === 2 ? "- Deux photos sont fournies dans l'ordre AVANT puis APRÈS : compare uniquement les différences réellement visibles, puis relie-les prudemment à la correction testée." : ""}
    `.trim();

    const userPromptText = `
CONNAISSANCES INTERNES DISPONIBLES POUR ERNESTO :
${retrievedContext}

Contexte utilisateur (optionnel) :
${contextText ?? "(non fourni)"}

Question :
${message}
`.trim();

    const userContent: any[] = [{ type: "input_text", text: userPromptText }];

    if (imageDataUrls.length) {
      userContent.push({
        type: "input_text",
        text: imageDataUrls.length === 2
          ? "COMPARAISON PHOTO : la première image correspond à AVANT et la seconde à APRÈS."
          : "PHOTO FOURNIE : analyse-la en priorité pour le diagnostic (en respectant les règles ci-dessus).",
      });
      imageDataUrls.forEach((imageUrl, index) => {
        if (imageDataUrls.length === 2) {
          userContent.push({
            type: "input_text",
            text: index === 0 ? "IMAGE 1 — AVANT" : "IMAGE 2 — APRÈS",
          });
        }
        userContent.push({ type: "input_image", image_url: imageUrl });
      });
    }

    const responseInput = [
      { role: "system" as const, content: [{ type: "input_text" as const, text: systemPrompt }] },
      { role: "user" as const, content: userContent },
    ];

    let answerText = "";
    let flowchart: ActionFlowchart | null = null;

    if (wantsActionFlowchart) {
      try {
        const structured = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: responseInput,
          text: { format: ACTION_FLOWCHART_FORMAT },
        });
        const parsed = parseActionFlowchart(structured.output_text ?? "");
        if (parsed) {
          answerText = parsed.answer;
          flowchart = parsed.flowchart;
        }
      } catch (flowchartErr) {
        console.warn("action flowchart generation skipped:", flowchartErr);
      }
    }

    if (!answerText) {
      const response = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: responseInput,
      });
      answerText = response.output_text ?? "";
    }

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
                  text:
                    "Tu génères uniquement un objet JSON strictement valide pour alimenter une interface Recharts. Pas de markdown. Pas de bloc de code. Si les données manquent, fais une visualisation pédagogique plausible et indique les hypothèses dans les notes. Utilise la langue de la question.",
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: buildGraphPrompt(message, answerText),
                },
              ],
            },
          ],
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
      flowchart,
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
        received_image: imageDataUrls.length > 0,
        received_images: imageDataUrls.length,
        comparison: imageDataUrls.length === 2,
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
