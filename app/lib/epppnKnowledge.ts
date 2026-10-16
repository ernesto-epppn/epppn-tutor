import OpenAI from "openai";

export const PRIMARY_KNOWLEDGE_PRIORITY = [
  { title: "Cookbook Pizza Home made 5 - Marino", boost: 0.16, label: "Marino · Cookbook Pizza Home made 5" },
  { title: "Ricettario Pizza home made", boost: 0.13, label: "Marino · Ricettario Pizza home made" },
  { title: "pane - Fulvio MArino", boost: 0.11, label: "Marino · Pane" },
  { title: "MANUEL 2026 impression", boost: 0.09, label: "Manuel EPPPN 2026" },
] as const;

export function normalizeKnowledgeTitle(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("fr");
}

export function knowledgePriorityForTitle(value: unknown) {
  const normalized = normalizeKnowledgeTitle(value);
  const hit = PRIMARY_KNOWLEDGE_PRIORITY.find(
    (entry) => normalizeKnowledgeTitle(entry.title) === normalized
  );
  if (hit) return hit;
  if (
    normalized.includes("fiches recettes epppn") ||
    normalized === "levain" ||
    normalized.includes("tonda biga")
  ) {
    return { title: String(value || ""), boost: 0.05, label: "EPPPN · complément officiel" };
  }
  if (normalized.includes("plaquette epppn")) {
    return { title: String(value || ""), boost: 0.02, label: "EPPPN · repère institutionnel" };
  }
  return { title: String(value || ""), boost: 0, label: "Référence complémentaire" };
}

export function expandTechnicalRetrievalQuery(message: string) {
  const additions: string[] = [];
  if (/(levain|levure|lievito|lievit|ferment)/i.test(message)) {
    additions.push("levain levure lievito lievitazione fermentation fermentazione");
  }
  if (/(hydrat|idrat|eau|acqua)/i.test(message)) {
    additions.push("hydratation idratazione eau acqua");
  }
  if (/(four|forno|cuisson|cottur)/i.test(message)) {
    additions.push("four forno cuisson cottura température temperatura");
  }
  if (/(farine|farina|\bW\s?\d{2,4}\b|protéine|proteina)/i.test(message)) {
    additions.push("farine farina force W protéines proteine");
  }
  if (/(temp[ée]rature|temperatura|froid|freddo|chaud|caldo)/i.test(message)) {
    additions.push("température temperatura froid freddo chaleur calore");
  }
  if (/(biga|poolish|pré[- ]?ferment|preferment)/i.test(message)) {
    additions.push("biga poolish préferment prefermento");
  }
  return additions.length
    ? message + "\n\nVocabulaire technique équivalent FR/IT pour la recherche : " + [...new Set(additions)].join(" ; ")
    : message;
}

export function shouldVerifyTechnicalAnswer(question: string, answer: string) {
  const domain =
    /(levain|levure|lievito|lievit|ferment|hydrat|idrat|farine|farina|four|forno|cuisson|cottur|temp[ée]rature|temperatura|biga|poolish|p[ée]triss|impast|pointage|appr[êe]t|maturation|p[âa]ton|cornicione)/i;
  const operational =
    /(\d|%|°|gram|\bg\b|kg|min|minute|heure|\bh\b|jour|dose|dosage|ratio|w\s?\d|protéine|proteina)/i;
  return domain.test(question) || (domain.test(answer) && operational.test(answer));
}

export async function retrieveEpppnKnowledge(params: {
  supabase: any;
  openai: OpenAI;
  message: string;
  candidateCount?: number;
  resultCount?: number;
  minSimilarity?: number;
}) {
  const {
    supabase,
    openai,
    message,
    candidateCount = 80,
    resultCount = 8,
    minSimilarity = 0.2,
  } = params;

  const retrievalQuery = expandTechnicalRetrievalQuery(message);
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: retrievalQuery,
  });
  const queryEmbedding = emb.data[0].embedding;

  const { data: matches, error: matchErr } = await supabase.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_count: candidateCount,
  });
  if (matchErr) throw matchErr;

  const candidates = (matches ?? []).filter(
    (m: any) => Number(m.similarity ?? 0) >= minSimilarity
  );
  const documentIds = [...new Set(candidates.map((m: any) => Number(m.document_id)).filter(Boolean))];

  const { data: documentRows, error: documentErr } = documentIds.length
    ? await supabase
        .from("documents")
        .select("id,title,source,active,status")
        .in("id", documentIds)
    : { data: [], error: null };

  if (documentErr) throw documentErr;

  const documentsById = new Map<number, any>(
    (documentRows ?? []).map((doc: any): [number, any] => [Number(doc.id), doc])
  );

  const reranked = candidates
    .map((m: any) => {
      const document = documentsById.get(Number(m.document_id));
      const priority = knowledgePriorityForTitle(document?.title);
      const similarity = Number(m.similarity ?? 0);
      const title = String(document?.title || m?.metadata?.title || "");
      const normalizedTitle = normalizeKnowledgeTitle(title);
      const breadQuery = /\b(pain|panification|baguette|miche|mie)\b/i.test(message);
      const domainBoost = breadQuery
        ? normalizedTitle === normalizeKnowledgeTitle("pane - Fulvio MArino")
          ? 0.22
          : normalizedTitle === normalizeKnowledgeTitle("MANUEL 2026 impression")
            ? 0.08
            : 0
        : 0;
      return {
        ...m,
        document_title: title,
        document_source: document?.source || m?.metadata?.source || "",
        source_label: priority.label,
        source_boost: priority.boost,
        domain_boost: domainBoost,
        retrieval_score: similarity + priority.boost + domainBoost,
      };
    })
    .sort((a: any, b: any) => b.retrieval_score - a.retrieval_score);

  const retrieved: any[] = [];
  const perDocumentCount = new Map<number, number>();
  for (const item of reranked) {
    const documentId = Number(item.document_id);
    const already = perDocumentCount.get(documentId) || 0;
    if (already >= 4) continue;
    retrieved.push(item);
    perDocumentCount.set(documentId, already + 1);
    if (retrieved.length >= resultCount) break;
  }

  if (retrieved.length < resultCount) {
    for (const item of reranked) {
      if (retrieved.some((existing: any) => existing.chunk_id === item.chunk_id)) continue;
      retrieved.push(item);
      if (retrieved.length >= resultCount) break;
    }
  }

  const context =
    retrieved.length > 0
      ? retrieved
          .map(
            (m: any, i: number) =>
              "CONNAISSANCE INTERNE " + (i + 1) + "\n" +
              "Priorité: " + (m.source_label || "Référence complémentaire") + "\n" +
              "Titre interne: " + (m.document_title || "non renseigné") + "\n" +
              "Pertinence sémantique: " + Number(m.similarity ?? 0).toFixed(2) + "\n" +
              m.content
          )
          .join("\n\n---\n\n")
      : "(Aucune connaissance interne pertinente disponible.)";

  const embeddingTokens = Number(
    (emb as any)?.usage?.total_tokens || (emb as any)?.usage?.prompt_tokens || 0
  );

  return { retrieved, context, embeddingTokens };
}

export function extractOperationalNumbers(text: string) {
  const raw = String(text || "");
  const result = new Set<string>();

  const addRangeEndpoints = (
    regex: RegExp,
    makeToken: (value: string, unit?: string) => string
  ) => {
    for (const match of raw.matchAll(regex)) {
      result.add(makeToken(match[1], match[3]));
      result.add(makeToken(match[2], match[3]));
    }
  };

  addRangeEndpoints(
    /\bW\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:-|–|—|à)\s*(\d{2,4}(?:[.,]\d+)?)/gi,
    (value) => "W " + value
  );
  addRangeEndpoints(
    /\bpH\s*(\d+(?:[.,]\d+)?)\s*(?:-|–|—|à)\s*(\d+(?:[.,]\d+)?)/gi,
    (value) => "pH " + value
  );
  addRangeEndpoints(
    /\bP\/L\s*(\d+(?:[.,]\d+)?)\s*(?:-|–|—|à)\s*(\d+(?:[.,]\d+)?)/gi,
    (value) => "P/L " + value
  );
  addRangeEndpoints(
    /\b(\d+(?:[.,]\d+)?)\s*(?:-|–|—|à)\s*(\d+(?:[.,]\d+)?)\s*(%|°\s?C|°C|kg|kilogrammes?|chilogrammi?|g|grammes?|grammi?|ml|millilitres?|millilitri?|l|litres?|litri?|min|minutes?|minuti?|h|heures?|ore?|ora|jours?|giorni?|giorno|s|sec|secondes?|secondi?)\b/gi,
    (value, unit) => value + (unit || "")
  );

  const regex = /(?:\bW\s?\d{2,4}(?:[.,]\d+)?\b)|(?:\bpH\s?\d+(?:[.,]\d+)?\b)|(?:\bP\/L\s?\d+(?:[.,]\d+)?\b)|(?:\b\d+(?:[.,]\d+)?\s?(?:%|°\s?C|°C|kg|kilogrammes?|chilogrammi?|g|grammes?|grammi?|ml|millilitres?|millilitri?|l|litres?|litri?|min|minutes?|minuti?|h|heures?|ore?|ora|jours?|giorni?|giorno|s|sec|secondes?|secondi?|W)\b)|(?:\b\d+(?:[.,]\d+)?\s*:\s*\d+(?:[.,]\d+)?\b)/gi;
  for (const match of raw.matchAll(regex)) {
    result.add(match[0]);
  }
  return [...result];
}

export function normalizeOperationalNumber(value: string) {
  let token = String(value || "")
    .toLowerCase()
    .trim()
    .replace(",", ".")
    .replace(/\s+/g, "");

  token = token
    .replace(/(?:heures?|ore?|ora)$/i, "h")
    .replace(/(?:minutes?|minuti?)$/i, "min")
    .replace(/(?:jours?|giorni?|giorno)$/i, "d")
    .replace(/(?:secondes?|secondi?|sec)$/i, "s")
    .replace(/(?:kilogrammes?|chilogrammi?)$/i, "kg")
    .replace(/(?:grammes?|grammi?)$/i, "g")
    .replace(/(?:millilitres?|millilitri?)$/i, "ml")
    .replace(/(?:litres?|litri?)$/i, "l")
    .replace(/°c$/i, "°c");

  return token;
}

function roundedSignature(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : NaN;
}

export function operationalNumberSignature(value: string) {
  const token = normalizeOperationalNumber(value);

  let match = token.match(/^w(\d+(?:\.\d+)?)$/i) || token.match(/^(\d+(?:\.\d+)?)w$/i);
  if (match) return "w:" + roundedSignature(Number(match[1]));

  match = token.match(/^ph(\d+(?:\.\d+)?)$/i);
  if (match) return "ph:" + roundedSignature(Number(match[1]));

  match = token.match(/^p\/l(\d+(?:\.\d+)?)$/i);
  if (match) return "pl:" + roundedSignature(Number(match[1]));

  match = token.match(/^(\d+(?:\.\d+)?)%$/);
  if (match) return "pct:" + roundedSignature(Number(match[1]));

  match = token.match(/^(\d+(?:\.\d+)?)°c$/);
  if (match) return "temp_c:" + roundedSignature(Number(match[1]));

  match = token.match(/^(\d+(?:\.\d+)?)(kg|g)$/);
  if (match) {
    const grams = Number(match[1]) * (match[2] === "kg" ? 1000 : 1);
    return "mass_g:" + roundedSignature(grams);
  }

  match = token.match(/^(\d+(?:\.\d+)?)(l|ml)$/);
  if (match) {
    const ml = Number(match[1]) * (match[2] === "l" ? 1000 : 1);
    return "volume_ml:" + roundedSignature(ml);
  }

  match = token.match(/^(\d+(?:\.\d+)?)(d|h|min|s)$/);
  if (match) {
    const multipliers: Record<string, number> = { d: 86400, h: 3600, min: 60, s: 1 };
    return "time_s:" + roundedSignature(Number(match[1]) * multipliers[match[2]]);
  }

  match = token.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (match && Number(match[2]) !== 0) {
    return "ratio:" + roundedSignature(Number(match[1]) / Number(match[2]));
  }

  return token;
}

type ComparableOperationalValue = { kind: string; value: number };

function comparableFromSignature(signature: string): ComparableOperationalValue | null {
  const match = String(signature || "").match(/^([a-z_]+):(-?\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const value = Number(match[2]);
  return Number.isFinite(value) ? { kind: match[1], value } : null;
}

function extractOperationalRanges(text: string) {
  const raw = String(text || "");
  const ranges: Array<{ kind: string; min: number; max: number }> = [];

  const add = (aToken: string, bToken: string) => {
    const a = comparableFromSignature(operationalNumberSignature(aToken));
    const b = comparableFromSignature(operationalNumberSignature(bToken));
    if (!a || !b || a.kind !== b.kind) return;
    ranges.push({ kind: a.kind, min: Math.min(a.value, b.value), max: Math.max(a.value, b.value) });
  };

  for (const m of raw.matchAll(/\bW\s*(\d{2,4}(?:[.,]\d+)?)\s*(?:-|–|—|à)\s*(\d{2,4}(?:[.,]\d+)?)/gi)) {
    add("W " + m[1], "W " + m[2]);
  }
  for (const m of raw.matchAll(/\bpH\s*(\d+(?:[.,]\d+)?)\s*(?:-|–|—|à)\s*(\d+(?:[.,]\d+)?)/gi)) {
    add("pH " + m[1], "pH " + m[2]);
  }
  for (const m of raw.matchAll(/\bP\/L\s*(\d+(?:[.,]\d+)?)\s*(?:-|–|—|à)\s*(\d+(?:[.,]\d+)?)/gi)) {
    add("P/L " + m[1], "P/L " + m[2]);
  }
  for (const m of raw.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(?:-|–|—|à)\s*(\d+(?:[.,]\d+)?)\s*(%|°\s?C|°C|kg|kilogrammes?|chilogrammi?|g|grammes?|grammi?|ml|millilitres?|millilitri?|l|litres?|litri?|min|minutes?|minuti?|h|heures?|ore?|ora|jours?|giorni?|giorno|s|sec|secondes?|secondi?)\b/gi)) {
    add(m[1] + m[3], m[2] + m[3]);
  }

  return ranges;
}

function documentedDivisors(context: string) {
  const divisors = new Set<number>();
  const raw = String(context || "").toLowerCase().replace(",", ".");

  for (const match of raw.matchAll(/\b(\d+(?:\.\d+)?)\s*fois\s*moins\b/g)) {
    const value = Number(match[1]);
    if (value > 0) divisors.add(value);
  }
  if (/\bun\s+tiers\b|\b1\s*\/\s*3\b/.test(raw)) divisors.add(3);
  if (/\bun\s+quart\b|\b1\s*\/\s*4\b/.test(raw)) divisors.add(4);
  if (/\bla\s+moiti[ée]\b|\b1\s*\/\s*2\b/.test(raw)) divisors.add(2);

  return [...divisors];
}

function questionMassesInGrams(question: string) {
  const masses: number[] = [];
  for (const token of extractOperationalNumbers(question)) {
    const sig = operationalNumberSignature(token);
    if (sig.startsWith("mass_g:")) {
      const value = Number(sig.slice("mass_g:".length));
      if (Number.isFinite(value) && value > 0) masses.push(value);
    }
  }
  return masses;
}

function documentedPercentages(context: string) {
  const values: number[] = [];
  for (const token of extractOperationalNumbers(context)) {
    const sig = operationalNumberSignature(token);
    if (sig.startsWith("pct:")) {
      const value = Number(sig.slice("pct:".length));
      if (Number.isFinite(value) && value >= 0) values.push(value);
    }
  }
  return values;
}

export function supportedOperationalSignatures(params: {
  question: string;
  context: string;
  allowDocumentedDerivations?: boolean;
}) {
  const { question, context, allowDocumentedDerivations = true } = params;
  const signatures = new Set(
    [...extractOperationalNumbers(question), ...extractOperationalNumbers(context)]
      .map(operationalNumberSignature)
  );

  if (!allowDocumentedDerivations) return signatures;

  const masses = questionMassesInGrams(question);
  const percentages = documentedPercentages(context);
  const divisors = documentedDivisors(context);

  for (const grams of masses) {
    for (const percentage of percentages) {
      signatures.add("mass_g:" + roundedSignature((grams * percentage) / 100));
    }
    for (const divisor of divisors) {
      signatures.add("mass_g:" + roundedSignature(grams / divisor));
    }
  }

  return signatures;
}

export function findUnsupportedOperationalNumbers(params: {
  answer: string;
  question: string;
  context: string;
  allowDocumentedDerivations?: boolean;
}) {
  const supported = supportedOperationalSignatures(params);
  const ranges = [
    ...extractOperationalRanges(params.question),
    ...extractOperationalRanges(params.context),
  ];

  return extractOperationalNumbers(params.answer).filter((value) => {
    const signature = operationalNumberSignature(value);
    if (supported.has(signature)) return false;

    const comparable = comparableFromSignature(signature);
    if (!comparable) return true;

    return !ranges.some(
      (range) =>
        range.kind === comparable.kind &&
        comparable.value >= range.min &&
        comparable.value <= range.max
    );
  });
}

export function stripUnsupportedOperationalLines(params: {
  answer: string;
  question: string;
  context: string;
}) {
  const removed = new Set<string>();
  const lines = String(params.answer || "").split("\n");
  const kept = lines.filter((line) => {
    if (!line.trim()) return true;
    const unsupported = findUnsupportedOperationalNumbers({
      answer: line,
      question: params.question,
      context: params.context,
      allowDocumentedDerivations: true,
    });
    unsupported.forEach((value) => removed.add(value));
    return unsupported.length === 0;
  });

  return {
    text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    removed: [...removed],
  };
}

export async function secureTechnicalNumericAdvice(params: {
  openai: OpenAI;
  answer: string;
  question: string;
  context: string;
  onResponse?: (response: any) => void;
}) {
  const { openai, question, context, onResponse } = params;
  let answer = String(params.answer || "").trim();
  const initialUnsupported = findUnsupportedOperationalNumbers({
    answer,
    question,
    context,
    allowDocumentedDerivations: true,
  });

  let rewritten = false;
  if (initialUnsupported.length) {
    try {
      const response = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "Tu es le garde-fou numérique final d’Ernesto.",
                  "Réécris la réponse sans aucune valeur opératoire non fondée.",
                  "Les valeurs listées comme NON AUTORISÉES doivent disparaître, ainsi que toute recommandation qui en dépend.",
                  "Tu peux conserver une valeur seulement si elle est directement présente dans la question ou les connaissances internes, ou si elle est le résultat exact d’un calcul entre une quantité utilisateur et une proportion explicitement documentée.",
                  "N’ajoute aucun nouveau chiffre. Si une valeur manque, formule la recommandation qualitativement et indique ce qu’il faut mesurer.",
                  "Ne cite pas les sources internes. Retourne uniquement la réponse finale corrigée.",
                ].join("\n"),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "QUESTION :",
                  question,
                  "",
                  "CONNAISSANCES INTERNES :",
                  context,
                  "",
                  "VALEURS NON AUTORISÉES DÉTECTÉES :",
                  initialUnsupported.join(", "),
                  "",
                  "RÉPONSE À SÉCURISER :",
                  answer,
                ].join("\n"),
              },
            ],
          },
        ],
      });
      onResponse?.(response);
      const rewrittenText = String(response.output_text || "").trim();
      if (rewrittenText) {
        answer = rewrittenText;
        rewritten = true;
      }
    } catch {
      // The deterministic final gate below still prevents unsupported values.
    }
  }

  const finalUnsupported = findUnsupportedOperationalNumbers({
    answer,
    question,
    context,
    allowDocumentedDerivations: true,
  });

  let removed: string[] = [];
  if (finalUnsupported.length) {
    const stripped = stripUnsupportedOperationalLines({ answer, question, context });
    removed = stripped.removed;
    answer =
      stripped.text ||
      "Les références internes disponibles ne permettent pas de confirmer un réglage chiffré fiable pour ce cas. Je peux expliquer les variables à contrôler, mais je préfère ne pas proposer de valeur non documentée.";
  }

  return {
    answer,
    initialUnsupported,
    finalUnsupported: findUnsupportedOperationalNumbers({
      answer,
      question,
      context,
      allowDocumentedDerivations: true,
    }),
    rewritten,
    removed,
  };
}
