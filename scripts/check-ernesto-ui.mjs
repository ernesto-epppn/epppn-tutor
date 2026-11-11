import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL("../" + name, import.meta.url), "utf8");
const home = read("app/ErnestoHome.tsx");
const stylesheet = read("app/ernesto-editorial-identity.css");
const layout = read("app/layout.tsx");
const notes = read("app/ErnestoExperienceCarnet.tsx");

const actionKeys = [...home.matchAll(/key: "(chat|recipes|commercial|carnet)"/g)].map((match) => match[1]);
assert.deepEqual(actionKeys, ["chat", "recipes", "commercial", "carnet"], "Keep the four primary home actions");
assert.match(home, /title: "Recettes"/, "Use an unambiguous recipe label");
assert.doesNotMatch(home, /ernestoHomeCardArrow|ernestoHomeDossierGo/, "Clickable cards and dossier rows need no decorative arrows");
assert.match(stylesheet, /\.ernestoHomeCards\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s, "Preserve 2x2 layout");
assert.match(stylesheet, /min-height:\s*96px\s*!important/, "Use compact desktop cards");
assert.match(layout, /IBM_Plex_Sans\(/, "Use the shared typographic system");
assert.match(notes, /setExperienceDate\(todayLocalISO\(\)\)/, "Default new observations to today's local date");
assert.match(notes, /Autorisée pour les réponses/, "Consent is not evidence of actual note usage");
console.log("Ernesto UI contracts verified.");
