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
      return {
        ...m,
        document_title: document?.title || m?.metadata?.title || "",
        document_source: document?.source || m?.metadata?.source || "",
        source_label: priority.label,
        source_boost: priority.boost,
        retrieval_score: similarity + priority.boost,
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
  const result = new Set<string>();
  const regex = /(?:\b\d+(?:[.,]\d+)?\s?(?:%|°\s?C|°C|g|kg|min|minutes?|h|heures?|jours?|W)\b)|(?:\bW\s?\d{2,4}\b)/gi;
  for (const match of String(text || "").matchAll(regex)) {
    result.add(match[0].toLowerCase().replace(/\s+/g, ""));
  }
  return [...result];
}
