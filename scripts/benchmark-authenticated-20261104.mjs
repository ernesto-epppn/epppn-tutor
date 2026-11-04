/**
 * One-time authenticated, production-pipeline benchmark.
 * Executed only from benchmark/authenticated-20261104 during its Vercel preview build.
 * Creates and deletes a temporary Supabase Auth user; NEVER prints credentials.
 * Saves full reports in the RLS-protected ernesto_benchmark_audit table.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TARGET_BRANCH = "benchmark/authenticated-20261104";
const PROJECT_DOMAIN = "https://ernesto.epppn.fr";
const runId = randomUUID();
const startAt = Date.now();

if (process.env.VERCEL_GIT_COMMIT_REF !== TARGET_BRANCH) {
  console.log("BENCH_SKIP", "Only runs on a dedicated testing branch.");
  process.exit(0);
}

const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.log("BENCH_BLOCKED", "Environment variable names missing:", missing.join(","));
  process.exit(0);
}
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const login = createClient(process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const manualCases = [
  {
    id: "NAT-T80-01", mode: "ACTION",
    question: "Je travaille avec une farine T80 moulue sur meule et un levain naturel. Après une fermentation longue, la pâte est très collante et manque de tenue. Est-ce que je dois obligatoirement acheter une farine W350 ?",
    reference_answer: "Non, une farine W350 n'est pas une obligation. Examiner d'abord la maturité du levain, les rafraîchis, la température et la durée de fermentation, l'hydratation réelle et le comportement de la farine T80. Observer l'élasticité, la tenue et l'évolution de la pâte; modifier un paramètre à la fois. La farine, son taux d'extraction et son activité enzymatique doivent être pris en compte. Aucun dosage ou seuil universel ne peut être conseillé sans protocole précis.",
    required_points: ["Ne pas imposer W350 ni un W élevé.", "Évoquer farine T80, activité enzymatique et hydratation.", "Contrôler levain, rafraîchis, temps et température.", "Proposer un test progressif."],
    forbidden_points: ["Affirmer que la pâte ne peut pas fonctionner avec T80.", "Donner un W obligatoire.", "Attribuer une cause certaine sans données."]
  },
  {
    id: "NAT-ACID-02", mode: "ANALYSE",
    question: "Mon levain naturel sent fortement le vinaigre, a perdu en activité et mes pâtes lèvent mal. Puis-je neutraliser cette acidité avec du bicarbonate ou ajouter toujours plus de levure ?",
    reference_answer: "Il faut distinguer acidité perçue et activité fermentaire: l'odeur seule ne permet pas un diagnostic certain. Vérifier historique et rythme des rafraîchis, températures, farine, hydratation, évolution du volume et délai de reprise après alimentation. Ne pas conseiller systématiquement bicarbonate ni augmentation de levure, qui masquent le problème et modifient la pâte; reprendre le suivi du levain, observer et corriger progressivement. Aucun ratio ou délai précis sans le protocole.",
    required_points: ["Distinguer acidification et capacité de levée.", "Refuser correction automatique au bicarbonate.", "Décrire des observations contrôlables.", "Ne pas inventer des dosages."],
    forbidden_points: ["Donner une dose de bicarbonate.", "Affirmer avec certitude l'origine de la mauvaise levée."]
  },
  {
    id: "NAT-LONG-03", mode: "ACTION",
    question: "Pour une pâte au levain avec une farine peu forte, puis-je suivre exactement un protocole de 72 h prévu pour une farine très forte de pizza, à la même hydratation et température ?",
    reference_answer: "Non. Un protocole ne se transfère pas mécaniquement entre farines de comportements différents. Évaluer la farine réellement utilisée, son extraction et son activité enzymatique, l'hydratation, l'inoculation et la maturité du levain, la température et la durée. Suivre la tenue de pâte et la fermentation, adapter progressivement les paramètres sans fixer de valeurs universelles ni imposer une farine forte.",
    required_points: ["Refuser transposition automatique des 72 h.", "Considérer interaction farine, levain, température, hydratation.", "Ne pas conseiller une farine forte comme seule issue."],
    forbidden_points: ["Garantir les mêmes paramètres.", "Inventer une durée idéale.", "Interpréter W comme unique déterminant."]
  },
  {
    id: "NAT-FLOURS-04", mode: "ANALYSE",
    question: "En panification naturelle, vaut-il toujours mieux utiliser une farine très forte ? Je préfère les farines paysannes, semi-complètes et moins standardisées. Comment raisonner le choix ?",
    reference_answer: "Non. La pertinence d'une farine dépend du produit visé et de son comportement réel, pas de la maximisation du W. Examiner type de céréale, extraction et mouture, qualité des protéines, activité enzymatique, capacité d'absorption, hydratation, durée et température de fermentation, comportement du levain et résultat sensoriel. Les pratiques de pain et de pizza peuvent différer. Comparer par essais contrôlés, ne pas inventer de seuil ni imposer un standard industriel.",
    required_points: ["Refuser dogme W élevé.", "Considérer extraction, mouture et matière première.", "Faire place aux farines paysannes.", "Relier le choix au produit et au procédé."],
    forbidden_points: ["Présenter W350 comme idéal universel.", "Raisonner uniquement sur protéines ou W."]
  }
];

let createdUserId = null;
let finished = false;
const technical = [];
const expert = [];

async function callJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, redirect: "follow", signal: AbortSignal.timeout(115000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("HTTP " + res.status + " " + String(body?.error || body?.message || "request_failed").slice(0,160));
  return body;
}

async function saveResult(suite, caseId, result) {
  const { error } = await admin.from("ernesto_benchmark_audit").upsert(
    { run_id: runId, suite, case_id: caseId, result },
    { onConflict: "run_id,case_id,suite" }
  );
  if (error) console.log("BENCH_AUDIT_WRITE_ERROR", caseId, error.code || "failed");
}

function showResult(suite, caseId, result) {
  const top = (result?.top_matches || []).map((x) => x.document_title).filter(Boolean);
  console.log("BENCH_RESULT", JSON.stringify({
    run_id: runId, suite, id: caseId,
    pass: result?.pass === true,
    score: Number(result?.score || 0),
    error: result?.error || undefined,
    top_source: top[0] || (result?.sources || [])[0] || null,
    sources: (result?.sources || []).length,
    unsupported_numbers: (result?.unsupported_numbers || []).length,
    numeric_guard_triggered: Boolean(result?.numeric_guard_triggered),
    issues: (result?.evaluation?.issues || result?.analysis?.contradictions || []).slice(0,2)
  }));
}

try {
  console.log("BENCH_STARTED", JSON.stringify({ run_id: runId, url: PROJECT_DOMAIN, suite: "36 production cases + 4 expert cases", at: new Date().toISOString() }));
  const email = "ernesto-benchmark-" + randomUUID() + "@example.com";
  const password = randomBytes(48).toString("base64url");
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true
  });
  if (createError || !created?.user?.id) throw new Error("test_auth_create_failed: " + (createError?.code || "unknown"));
  createdUserId = created.user.id;

  const { error: profileError } = await admin.from("profiles").upsert({
    user_id: createdUserId, role: "admin"
  }, { onConflict: "user_id" });
  if (profileError) throw new Error("test_profile_create_failed: " + profileError.code);

  const { data: signed, error: signError } = await login.auth.signInWithPassword({ email, password });
  if (signError || !signed?.session?.access_token) throw new Error("test_auth_signin_failed: " + (signError?.code || "unknown"));
  const authorization = "Bearer " + signed.session.access_token;
  const headers = { "content-type": "application/json", authorization };

  const list = await callJson(PROJECT_DOMAIN + "/api/admin/benchmark", { headers });
  const cases = Array.isArray(list.cases) ? list.cases : [];
  console.log("BENCH_AUTH_OK", JSON.stringify({ cases_found: cases.length, preview_build: true }));
  if (!cases.length) throw new Error("No benchmark cases returned by authenticated production API.");

  for (let i = 0; i < Math.min(cases.length,36); i++) {
    const test = cases[i];
    let result;
    try {
      const response = await callJson(PROJECT_DOMAIN + "/api/admin/benchmark", {
        method: "POST", headers,
        body: JSON.stringify({ case_ids: [test.id] })
      });
      result = Array.isArray(response.results) && response.results.length
        ? response.results[0] : { error: "no_evaluation_results", pass: false, score: 0 };
    } catch (e) {
      result = { error: String(e?.message || "benchmark_api_failed").slice(0,180), pass: false, score: 0 };
    }
    technical.push(result);
    await saveResult("technical",test.id,result);
    showResult("technical",test.id,result);
    if (i >= 3 && technical.slice(-3).every((x) => x.error && /HTTP 401|HTTP 403|HTTP 429|HTTP 503/.test(x.error))) {
      console.log("BENCH_HALTED", "Repeated access or capacity errors.");
      break;
    }
  }

  for (const test of manualCases) {
    let result;
    try {
      const response = await callJson(PROJECT_DOMAIN + "/api/admin/benchmark-manual", {
        method: "POST", headers, body: JSON.stringify({
          action: "run", title: test.id, category: "Panification naturelle",
          mode: test.mode, question: test.question,
          reference_answer: test.reference_answer,
          required_points: test.required_points, forbidden_points: test.forbidden_points
        })
      });
      result = response.result || { error: "no_expert_result", pass: false, score: 0 };
    } catch (e) {
      result = { error: String(e?.message || "expert_api_failed").slice(0,180), pass: false, score: 0 };
    }
    expert.push(result);
    await saveResult("expert",test.id,result);
    showResult("expert",test.id,result);
  }
  finished = true;
} catch (error) {
  console.log("BENCH_FATAL", String(error?.message || error).slice(0,300));
} finally {
  if (createdUserId) {
    // Remove the privilege and account, even when a test fails.
    const p = await admin.from("profiles").delete().eq("user_id",createdUserId);
    const a = await admin.auth.admin.deleteUser(createdUserId);
    console.log("BENCH_AUTH_CLEANUP", JSON.stringify({ profile_removed: !p.error, auth_user_removed: !a.error }));
  }
  const validTechnical = technical.filter((x)=>!x.error);
  const validExpert = expert.filter((x)=>!x.error);
  function score(rows) {
    return {
      evaluated: rows.length, passed: rows.filter((x)=>x.pass===true).length,
      avg_score: rows.length ? Math.round(rows.reduce((sum,x)=>sum+Number(x.score||0),0)/rows.length) : null
    };
  }
  console.log("BENCH_FINAL",JSON.stringify({
    run_id:runId, completed:finished, duration_seconds:Math.round((Date.now()-startAt)/1000),
    technical:score(validTechnical), expert:score(validExpert),
    technical_errors:technical.length-validTechnical.length,
    expert_errors:expert.length-validExpert.length
  }));
}
