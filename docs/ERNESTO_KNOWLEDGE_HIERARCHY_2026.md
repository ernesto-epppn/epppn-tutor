# Ernesto — gerarchia delle conoscenze e controllo delle fonti
Aggiornamento: 4 novembre 2026

## Regola editoriale

**Livello 1 (pari priorità):**
- Manuale Pizza EPPPN `MANUEL 2026 impression`
- `Modernist Pizza` (Volume 2, Techniques and Ingredients, e Recipes)

La scelta tra le due fonti dipende dal problema concreto. Un procedimento descritto
in un libro non si trasferisce automaticamente a un'altra farina, al lievito madre,
a un forno differente o a un altro stile di pizza.

**Livello 2:** tutte le altre risorse validamente presenti nella biblioteca EPPPN
(ricette, libri di Marino, levain, altre opere, materiali pedagogici).
I libri di Marino **non hanno più un bonus speciale**.

**Livello 3:** soltanto quando il corpus dei livelli precedenti non è sufficiente
per il punto richiesto, e soltanto per domande su panificazione naturale,
lievito madre, pasta madre, microbiologia, rinfreschi e fermentazione naturale,
il modello può usare le schede bibliografiche di `public.ernesto_scientific_sources`.
Non deve trasformare la conoscenza generale del modello in una prescrizione
di pizza, farina forte, temperatura o ricetta.

## Implementazione

- `app/lib/epppnKnowledge.ts`: ricerca ibrida, etichette, diversificazione.
- `public.match_chunks_contextual` (Supabase): cerca per embedding e termini
  esatti, priorità paritaria Manuale/Modernist, normalizza/deduplica i testi
  e limita i candidati. Accessibile soltanto al backend `service_role`.
- `app/lib/ernestoScientific.ts`: recupero condizionale di massimo tre
  schede scientifiche pertinenti. Nessun lookup esterno automatico e nessun
  scraping. Solo fonti controllate.
- `app/api/tutor/route.ts`: applica la gerarchia al modello e al verificatore,
  lascia attiva la verifica numerica originale e restituisce le fonti
  scientifiche *disponibili* nei metadati della risposta.
- Il database `ernesto_scientific_sources` conserva sintesi originali,
  argomenti, DOI e link pubblici, non copie integrali di testi protetti.

## Affidabilità

I tre livelli non sono tre "modelli": il modello resta GPT via API.
Un testo simile alla domanda non prova che sia applicabile.
Le note scientifiche servono a giustificare spiegazioni qualitative; i numeri
operativi devono essere tracciabili ai documenti interni oppure forniti
dall'utente. Se non esiste un riferimento adeguato, Ernesto segnala il limite
invece di prescrivere valori generici.

La API distingue `rag.top` (frammenti interni recuperati) da
`rag.scientific_sources_available` (fonti scientifiche disponibili, non
necessariamente impiegate nel testo). Non confondere l'una con l'altra
quando si analizzano i benchmark.

## Bibliografia iniziale verificata

- Calvert et al. (2021), *A review of sourdough starters*, PeerJ,
  https://doi.org/10.7717/peerj.11389
- De Vuyst, Comasio & Van Kerrebroeck (2021 online / 2023 fascicolo),
  *Sourdough production*, Critical Reviews in Food Science and Nutrition,
  https://doi.org/10.1080/10408398.2021.1976100
- De Vuyst, Van Kerrebroeck & Leroy (2017),
  *Microbial Ecology and Process Technology of Sourdough Fermentation*,
  https://doi.org/10.1016/bs.aambs.2017.02.003
- Gänzle (2014), *Enzymatic and bacterial conversions during sourdough
  fermentation*, Food Microbiology, https://doi.org/10.1016/j.fm.2013.04.007
- Arora et al. (2021), *Thirty years of knowledge on sourdough fermentation:
  A systematic review*, Trends in Food Science & Technology,
  https://doi.org/10.1016/j.tifs.2020.12.008

## Controlli prima di una nuova release

1. Verificare Next.js `npm run build` con preview Vercel.
2. Testare la RPC SQL su un embedding esistente e controllare che il medesimo
   testo non venga restituito due volte.
3. Verificare che i ruoli `anon` e `authenticated` non possano eseguire
   `match_chunks_contextual` né leggere direttamente la bibliografia.
4. Eseguire il benchmark su almeno: pasta collante con levain e T80,
   manutenzione/rafraîchis, pasta madre, farina W350, pizza con biga, uso
   di farina debole, e domanda fuori dal campo del lievito madre.
5. Controllare che nessun valore numerico non documentato superi la
   verifica tecnica e che la risposta non attribuisca automaticamente
   una farina forte.

## Ripristino

Il ramo precedente e i documenti originali restano disponibili. Per tornare
alla vecchia versione applicativa, ripristinare il commit Git precedente.
Le nuove tabelle e funzioni PostgreSQL sono additive; non richiedono alcuna
cancellazione per fare rollback del codice. Se un OCR duplicato viene
disattivato, è sufficiente porre `documents.active = true` per ripristinarlo.
