import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const PROJECT_REF = "ayatabfbtavvizwhkndf";
const SUPABASE_ORG = "gfbkscsevvfyoerisifs";
const VERCEL_TEAM_SLUG = "ilios-projects-0081c65a";
const VERCEL_PROJECT = "epppn-tutor";

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
  return { user, email };
}

function dateMs(value: unknown) {
  const ms = value ? new Date(String(value)).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function statusOf(row: any, authUser: any, now: number) {
  const expired = Boolean(row.access_ends_at) && dateMs(row.access_ends_at) <= now;
  if (row.blocked_at) return "blocked";
  if (row.paused_at) return "paused";
  if (expired) return "expired";
  if (row.active === true && (row.activated_user_id || authUser?.last_sign_in_at)) return "active";
  if (row.active !== true) return "blocked";
  return "invited";
}

async function checkOpenAIHealth() {
  if (!process.env.OPENAI_API_KEY) return { ok: false, detail: "Clé API absente" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch("https://api.openai.com/v1/models/gpt-4.1-mini", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: controller.signal,
      cache: "no-store",
    });
    return { ok: response.ok, detail: response.ok ? "API accessible" : `HTTP ${response.status}` };
  } catch {
    return { ok: false, detail: "API non joignable" };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenAICosts(startTime: number, endTime: number) {
  const adminKey = process.env.OPENAI_ADMIN_KEY;
  if (!adminKey) return { available: false as const, total_usd: null as number | null, currency: "usd" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(startTime));
    url.searchParams.set("end_time", String(endTime));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "31");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { available: false as const, total_usd: null as number | null, currency: "usd" };
    const payload = await response.json().catch(() => ({}));
    let total = 0;
    for (const bucket of Array.isArray(payload?.data) ? payload.data : []) {
      for (const result of Array.isArray(bucket?.results) ? bucket.results : []) {
        total += Number(result?.amount?.value || 0);
      }
    }
    return { available: true as const, total_usd: total, currency: "usd" };
  } catch {
    return { available: false as const, total_usd: null as number | null, currency: "usd" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;

    const now = Date.now();
    const day = 86400000;
    const since7 = new Date(now - 7 * day).toISOString();
    const since30 = new Date(now - 30 * day).toISOString();
    const since24h = new Date(now - day).toISOString();

    const [
      settingsResult,
      allowResult,
      authUsersResult,
      accessResult,
      memoryResult,
      ragResult,
      feedbackResult,
      runtimeResult,
      docsResult,
      chunksResult,
      jobsResult,
      openaiHealth,
    ] = await Promise.all([
      supabase.from("ernesto_system_settings").select("*").eq("id", "global").maybeSingle(),
      supabase.from("epppn_allowed_emails").select("email,full_name,active,activated_user_id,activated_at,invited_at,access_ends_at,blocked_at,paused_at,app_role,last_login_at").order("invited_at", { ascending: false }),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabase.from("ernesto_access_events").select("user_id,email,created_at").order("created_at", { ascending: false }).limit(20000),
      supabase.from("ernesto_dossier_memory").select("user_id,project_id,turn_count,updated_at"),
      supabase.from("ernesto_rag_usage_events").select("user_id,user_email,question,rag_used,top_similarity,mode,created_at").gte("created_at", since30).order("created_at", { ascending: false }).limit(5000),
      supabase.from("ernesto_answer_feedback").select("user_id,project_title,question,rating,reason,rag_used,created_at").gte("created_at", since30).order("created_at", { ascending: false }).limit(2000),
      supabase.from("ernesto_runtime_events").select("user_id,user_email,ok,status_code,latency_ms,model,model_requests,input_tokens,output_tokens,total_tokens,embedding_tokens,rag_used,image_count,estimated_cost_usd,error_code,created_at").gte("created_at", since30).order("created_at", { ascending: false }).limit(10000),
      supabase.from("documents").select("id,status,active,indexed_at,created_at").order("created_at", { ascending: false }),
      supabase.from("document_chunks").select("id", { count: "exact", head: true }),
      supabase.from("ernesto_knowledge_jobs").select("id,status,error,stage_label,created_at,updated_at").gte("created_at", since30).order("created_at", { ascending: false }).limit(100),
      checkOpenAIHealth(),
    ]);

    const hardErrors = [settingsResult, allowResult, accessResult, memoryResult, ragResult, feedbackResult, runtimeResult, docsResult, chunksResult, jobsResult]
      .map((result: any) => result?.error)
      .filter(Boolean);
    if (hardErrors.length) {
      console.error("Admin pilot API lookup failed:", hardErrors[0]?.message);
      return NextResponse.json({ error: "pilot_lookup_failed" }, { status: 500 });
    }

    const settings = settingsResult.data || {
      id: "global",
      maintenance_mode: false,
      suspend_trainees: false,
      rag_enabled: true,
      images_enabled: true,
      monthly_openai_budget_usd: 50,
      pilot_target_count: 10,
      maintenance_message: null,
      vercel_plan_label: "Hobby",
      supabase_plan_label: "Free",
    };

    const authUsers = authUsersResult.data?.users || [];
    const authById = new Map(authUsers.map((user: any) => [String(user.id), user]));
    const authByEmail = new Map(authUsers.map((user: any) => [normalizeEmail(user.email), user]));

    const accesses = accessResult.data || [];
    const accessByUser = new Map<string, { count: number; first: string | null; last: string | null; count7: number }>();
    for (const event of accesses) {
      const key = String(event.user_id || "");
      if (!key) continue;
      const current = accessByUser.get(key) || { count: 0, first: null, last: null, count7: 0 };
      current.count += 1;
      if (!current.last) current.last = event.created_at || null;
      current.first = event.created_at || current.first;
      if (dateMs(event.created_at) >= now - 7 * day) current.count7 += 1;
      accessByUser.set(key, current);
    }

    const dossierByUser = new Map<string, { count: number; turns: number }>();
    for (const row of memoryResult.data || []) {
      const key = String(row.user_id || "");
      if (!key) continue;
      const current = dossierByUser.get(key) || { count: 0, turns: 0 };
      current.count += 1;
      current.turns += Number(row.turn_count || 0);
      dossierByUser.set(key, current);
    }

    const ragRows = ragResult.data || [];
    const ragByEmail = new Map<string, { questions: number; last: string | null; low: number }>();
    for (const row of ragRows) {
      const key = normalizeEmail(row.user_email);
      if (!key) continue;
      const current = ragByEmail.get(key) || { questions: 0, last: null, low: 0 };
      current.questions += 1;
      if (!current.last) current.last = row.created_at || null;
      if (Number(row.rag_used || 0) === 0 || Number(row.top_similarity || 0) < 0.35) current.low += 1;
      ragByEmail.set(key, current);
    }

    const feedbackRows = feedbackResult.data || [];
    const feedbackByUser = new Map<string, { positive: number; negative: number }>();
    for (const row of feedbackRows) {
      const key = String(row.user_id || "");
      if (!key) continue;
      const current = feedbackByUser.get(key) || { positive: 0, negative: 0 };
      if (Number(row.rating) > 0) current.positive += 1;
      else current.negative += 1;
      feedbackByUser.set(key, current);
    }

    const allowRows = (allowResult.data || []).filter((row: any) => String(row.app_role || "user") !== "admin");
    const trainees = allowRows.map((row: any) => {
      const email = normalizeEmail(row.email);
      const authUser = row.activated_user_id ? authById.get(String(row.activated_user_id)) : authByEmail.get(email);
      const userId = String(row.activated_user_id || authUser?.id || "");
      const access = userId ? accessByUser.get(userId) : undefined;
      const dossier = userId ? dossierByUser.get(userId) : undefined;
      const rag = ragByEmail.get(email);
      const feedback = userId ? feedbackByUser.get(userId) : undefined;
      const lastAccess = access?.last || row.last_login_at || authUser?.last_sign_in_at || null;
      return {
        email,
        full_name: row.full_name || null,
        role: row.app_role || "user",
        status: statusOf(row, authUser, now),
        first_access_at: access?.first || row.activated_at || null,
        last_access_at: lastAccess,
        access_count: access?.count || 0,
        accesses_7d: access?.count7 || 0,
        dossier_count: dossier?.count || 0,
        question_count: rag?.questions || dossier?.turns || 0,
        feedback_positive: feedback?.positive || 0,
        feedback_negative: feedback?.negative || 0,
        low_rag_questions: rag?.low || 0,
        never_connected: !lastAccess,
        active_7d: Boolean(lastAccess && dateMs(lastAccess) >= now - 7 * day),
      };
    });

    const responses30 = ragRows.length;
    const ragUsedRows = ragRows.filter((row: any) => Number(row.rag_used || 0) > 0);
    const lowRagRows = ragRows.filter((row: any) => Number(row.rag_used || 0) === 0 || Number(row.top_similarity || 0) < 0.35);
    const positive = feedbackRows.filter((row: any) => Number(row.rating) > 0).length;
    const negative = feedbackRows.filter((row: any) => Number(row.rating) <= 0).length;
    const userEmailById = new Map(trainees.map((item: any) => {
      const row = allowRows.find((allowed: any) => normalizeEmail(allowed.email) === item.email);
      return [String(row?.activated_user_id || ""), item.email];
    }));
    const negativeRecent = feedbackRows
      .filter((row: any) => Number(row.rating) <= 0)
      .slice(0, 8)
      .map((row: any) => ({
        created_at: row.created_at,
        email: userEmailById.get(String(row.user_id || "")) || null,
        project_title: row.project_title || null,
        question: String(row.question || "").slice(0, 280),
        reason: row.reason || null,
        rag_used: Number(row.rag_used || 0),
      }));

    const runtimeRows = runtimeResult.data || [];
    const runtime24 = runtimeRows.filter((row: any) => dateMs(row.created_at) >= now - day);
    const success24 = runtime24.filter((row: any) => row.ok === true);
    const errors24 = runtime24.filter((row: any) => row.ok !== true);
    const latencies = success24.map((row: any) => Number(row.latency_ms || 0)).filter((value: number) => value > 0);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((sum: number, value: number) => sum + value, 0) / latencies.length) : null;

    const docs = docsResult.data || [];
    const indexedDocs = docs.filter((row: any) => row.status === "indexed" && row.active !== false).length;
    const chunks = Number(chunksResult.count || 0);
    const failedJobs24 = (jobsResult.data || []).filter((row: any) => row.status === "failed" && dateMs(row.updated_at || row.created_at) >= now - day);

    const localCost = runtimeRows.reduce((sum: number, row: any) => sum + Number(row.estimated_cost_usd || 0), 0);
    const inputTokens = runtimeRows.reduce((sum: number, row: any) => sum + Number(row.input_tokens || 0), 0);
    const outputTokens = runtimeRows.reduce((sum: number, row: any) => sum + Number(row.output_tokens || 0), 0);
    const embeddingTokens = runtimeRows.reduce((sum: number, row: any) => sum + Number(row.embedding_tokens || 0), 0);
    const modelRequests = runtimeRows.reduce((sum: number, row: any) => sum + Number(row.model_requests || 0), 0);

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const openaiCosts = await fetchOpenAICosts(Math.floor(monthStart.getTime() / 1000), Math.floor(Date.now() / 1000));
    const displayedOpenAICost = openaiCosts.available ? Number(openaiCosts.total_usd || 0) : localCost;
    const budget = Number(settings.monthly_openai_budget_usd || 50);
    const budgetRatio = budget > 0 ? displayedOpenAICost / budget : 0;

    const runtimeStarted = runtimeRows.length ? runtimeRows[runtimeRows.length - 1]?.created_at || null : null;
    const overallHealthy = openaiHealth.ok && indexedDocs > 0 && chunks > 0 && errors24.length === 0;

    return NextResponse.json({
      settings,
      health: {
        overall: overallHealthy ? "healthy" : errors24.length || failedJobs24.length ? "warning" : "healthy",
        supabase: { ok: true, detail: "Base accessible" },
        openai: openaiHealth,
        rag: { ok: indexedDocs > 0 && chunks > 0 && settings.rag_enabled !== false, documents: indexedDocs, chunks, enabled: settings.rag_enabled !== false },
        vercel: { ok: process.env.VERCEL_ENV === "production" || Boolean(process.env.VERCEL), detail: process.env.VERCEL_ENV === "production" ? "Production active" : "Application accessible", commit: process.env.VERCEL_GIT_COMMIT_SHA || null },
        errors_24h: errors24.length,
        knowledge_failures_24h: failedJobs24.length,
        avg_latency_ms_24h: avgLatency,
        requests_24h: runtime24.length,
        error_rate_24h: runtime24.length ? errors24.length / runtime24.length : 0,
      },
      pilot: {
        target: Number(settings.pilot_target_count || 10),
        trainees,
        total: trainees.length,
        connected: trainees.filter((item: any) => !item.never_connected).length,
        active_7d: trainees.filter((item: any) => item.active_7d).length,
        never_connected: trainees.filter((item: any) => item.never_connected).length,
        paused: trainees.filter((item: any) => item.status === "paused").length,
      },
      quality: {
        period_days: 30,
        responses: responses30,
        retrieval_rate: responses30 ? ragUsedRows.length / responses30 : 0,
        low_rag_count: lowRagRows.length,
        low_rag_rate: responses30 ? lowRagRows.length / responses30 : 0,
        feedback_total: positive + negative,
        feedback_positive: positive,
        feedback_negative: negative,
        positive_rate: positive + negative ? positive / (positive + negative) : null,
        negative_recent: negativeRecent,
      },
      costs: {
        period_days: 30,
        openai: {
          actual_available: openaiCosts.available,
          actual_usd: openaiCosts.total_usd,
          estimated_usd: Number(localCost.toFixed(6)),
          displayed_usd: Number(displayedOpenAICost.toFixed(6)),
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          embedding_tokens: embeddingTokens,
          model_requests: modelRequests,
          model: "gpt-4.1-mini",
          embedding_model: "text-embedding-3-small",
          tracking_started_at: runtimeStarted,
          budget_usd: budget,
          budget_ratio: budgetRatio,
        },
        vercel: { plan: settings.vercel_plan_label || "Hobby", deployment: process.env.VERCEL_ENV === "production" ? "READY" : "Actif" },
        supabase: { plan: settings.supabase_plan_label || "Free", project_status: "ACTIVE_HEALTHY", region: "eu-west-1" },
      },
      links: {
        openai_billing: "https://platform.openai.com/settings/organization/billing/overview",
        openai_usage: "https://platform.openai.com/usage",
        vercel_project: `https://vercel.com/${VERCEL_TEAM_SLUG}/${VERCEL_PROJECT}`,
        vercel_usage: `https://vercel.com/${VERCEL_TEAM_SLUG}/~/usage`,
        supabase_project: `https://supabase.com/dashboard/project/${PROJECT_REF}`,
        supabase_billing: `https://supabase.com/dashboard/org/${SUPABASE_ORG}/billing`,
      },
      generated_at: new Date().toISOString(),
      notes: {
        cost_estimate: "L’estimation locale utilise les tarifs standards actuels de gpt-4.1-mini et text-embedding-3-small. Le montant facturé OpenAI reste la référence lorsque la clé administrateur de facturation est configurée.",
        telemetry: runtimeStarted ? "La télémétrie détaillée est calculée à partir de sa date d’activation." : "La télémétrie détaillée commencera avec les prochaines réponses Ernesto.",
      },
    });
  } catch (error) {
    console.error("Admin pilot GET failed:", error);
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
    const allowedKeys = new Set([
      "maintenance_mode",
      "suspend_trainees",
      "rag_enabled",
      "images_enabled",
      "monthly_openai_budget_usd",
      "pilot_target_count",
      "maintenance_message",
    ]);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: auth.user.id };

    for (const [key, value] of Object.entries(body)) {
      if (!allowedKeys.has(key)) continue;
      if (["maintenance_mode", "suspend_trainees", "rag_enabled", "images_enabled"].includes(key)) {
        update[key] = value === true;
      } else if (key === "monthly_openai_budget_usd") {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount < 1 || amount > 10000) return NextResponse.json({ error: "invalid_budget" }, { status: 400 });
        update[key] = Math.round(amount * 100) / 100;
      } else if (key === "pilot_target_count") {
        const count = Number(value);
        if (!Number.isFinite(count) || count < 1 || count > 1000) return NextResponse.json({ error: "invalid_pilot_target" }, { status: 400 });
        update[key] = Math.floor(count);
      } else if (key === "maintenance_message") {
        update[key] = String(value || "").trim().slice(0, 240) || null;
      }
    }

    if (Object.keys(update).length <= 2) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });

    const { data, error } = await supabase
      .from("ernesto_system_settings")
      .update(update)
      .eq("id", "global")
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: "settings_update_failed" }, { status: 500 });

    return NextResponse.json({ ok: true, settings: data });
  } catch (error) {
    console.error("Admin pilot POST failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
