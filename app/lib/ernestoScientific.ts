/**
 * Bibliographie de secours pour les questions de panification au levain naturel.
 * Le corpus EPPPN / Modernist Pizza demeure prioritaire. Ces fiches sont des
 * synthèses de travaux publiés, pas des transcriptions ni des protocoles chiffrés.
 */
export type ScientificReference = {
  id: string;
  source_title: string;
  authors: string;
  publication_year: number;
  doi: string | null;
  source_url: string;
  note_fr: string;
  keywords: string[];
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Intentionnellement restrictif : pas de repli sur la cuisine ou la pizza générale. */
export function isNaturalFermentationQuestion(question: string): boolean {
  const text = normalize(question);
  if (/\b(levain|sourdough|lievito madre|pasta madre|levito madre|fermentation naturelle|fermentazione naturale|panification naturelle|panificazione naturale|starter naturel|fermentation spontanee|fermentazione spontanea)\b/.test(text)) {
    return true;
  }
  return /\b(pain|pane|boulangerie|panification|panificazione|pate|impasto)\b/.test(text)
    && /\b(fermentation|fermentazione|ferment|rafraichi|rinfresco|microbiologie|acidification|acidita|acidite)\b/.test(text);
}

function keywordRelevance(question: string, words: string[]): number {
  const haystack = " " + normalize(question) + " ";
  let score = 0;
  for (const keyword of words) {
    const needle = normalize(keyword);
    if (needle.length >= 4 && haystack.includes(" " + needle + " ")) {
      score += needle.includes(" ") ? 3 : 1;
    }
  }
  return score;
}

export async function retrieveNaturalSourdoughReferences(
  supabase: any,
  question: string
): Promise<{ references: ScientificReference[]; context: string }> {
  if (!isNaturalFermentationQuestion(question)) {
    return { references: [], context: "" };
  }

  const { data, error } = await supabase
    .from("ernesto_scientific_sources")
    .select("id,source_title,authors,publication_year,doi,source_url,note_fr,keywords")
    .eq("active", true)
    .eq("category", "PANIFICATION_NATURELLE")
    .limit(50);
  if (error) throw error;

  const sorted = ((data || []) as ScientificReference[])
    .map((ref) => ({ ref, score: keywordRelevance(question, ref.keywords || []) }))
    .sort((a, b) => b.score - a.score || a.ref.id.localeCompare(b.ref.id));

  const references: ScientificReference[] = [];
  const perPublication = new Map<string, number>();
  for (const { ref, score } of sorted) {
    if (score === 0 && references.length > 0) continue;
    const key = ref.doi || ref.source_title;
    if ((perPublication.get(key) || 0) >= 2) continue;
    references.push(ref);
    perPublication.set(key, (perPublication.get(key) || 0) + 1);
    if (references.length >= 3) break;
  }

  const context = references.length
    ? references.map((r, i) =>
        "FICHE SCIENTIFIQUE COMPLÉMENTAIRE " + (i + 1) + "\n" +
        "Référence : " + r.authors + " (" + r.publication_year + "). " + r.source_title + "\n" +
        "DOI : " + (r.doi || "non renseigné") + "\n" +
        "URL : " + r.source_url + "\n" +
        "Synthèse raisonnée, NON citation verbatim : " + r.note_fr
      ).join("\n\n---\n\n")
    : "";

  return { references, context };
}
