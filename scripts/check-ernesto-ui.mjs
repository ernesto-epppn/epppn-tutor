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

// Contextual help must cover the workspaces and each commercial sub-section.
const topics = read("app/ernestoHelpTopics.ts");
const helpComponent = read("app/ErnestoSectionHelp.tsx");
const helpPage = read("app/aide/page.tsx");
const recipeStudio = read("app/ErnestoRecipeStudio.tsx");
const commercial = read("app/ErnestoCommercialStudio.tsx");
const activity = read("app/ErnestoActivityStudio.tsx");
const page = read("app/page.tsx");
const visual = read("app/ernesto-help-polish.css");
const keys = ["home", "tutor", "recipes", "cost", "journal", "stock", "suppliers", "carnet"];
for (const key of keys) {
  assert.match(topics, new RegExp('^\\s*' + key + ': \\{', 'm'), "Missing help content: " + key);
  assert.match(helpPage, new RegExp('key: "' + key + '"'), "Missing help index link: " + key);
}
assert.ok(home.includes('<ErnestoSectionHelp topic="home"/>'), "Home needs in-place help");
assert.ok(page.includes('<ErnestoSectionHelp topic="tutor" />'), "Tutor needs in-place help");
assert.ok(recipeStudio.includes('<ErnestoSectionHelp topic="recipes"/>'), "Recipes need in-place help");
assert.ok(commercial.includes('<ErnestoSectionHelp topic={tab==="journal"?"journal":"cost"}/>'), "Cost and journal need help");
assert.ok(activity.includes('<ErnestoSectionHelp topic={section==="stock"?"stock":"suppliers"}/>'), "Stock and suppliers need separate help");
assert.ok(notes.includes('<ErnestoSectionHelp topic="carnet"/>'), "Carnet needs in-place help");
assert.match(helpComponent, /target="_blank" rel="noopener noreferrer"/, "Help index must not interrupt forms");
assert.match(helpComponent, /"use client";/, "Interactive help must be a client component");
assert.match(helpComponent, /showModal\(\)/, "Help must use the browser top layer");
assert.match(helpComponent, /<dialog/, "Help must use an accessible native dialog");
assert.match(helpComponent, /aria-labelledby=\{titleId\}/, "Dialog must have an accessible heading");
assert.match(helpComponent, /aria-label="Fermer l'aide"/, "Help needs a reachable close button");
assert.match(helpComponent, /onClose=\{\(\) => triggerRef.current/, "Return keyboard focus to trigger");
assert.doesNotMatch(helpComponent, /<details/, "Old clipped popover must not remain");
assert.match(helpPage, /from "\.\.\/ernestoHelpTopics"/, "Server-side help page imports data, not client component");
assert.match(layout, /ernesto-help-polish.css/, "Include shared help CSS");
assert.match(visual, /prefers-reduced-motion/, "Respect reduced motion");
assert.match(visual, /\.ernestoHelpDialog\s*\{/, "Help dialog has standalone viewport layout");
assert.match(visual, /max-height:\s*min\(82dvh,\s*640px\)/, "Mobile help sheet must respect viewport height");
assert.match(visual, /safe-area-inset-bottom/, "Mobile help must clear the iOS safe area");
assert.match(visual, /overflow-y:\s*auto/, "Mobile help content must scroll within sheet");
assert.doesNotMatch(visual, /\.ernestoHelpPanel/, "Old absolutely positioned panel CSS must be removed");

console.log("Ernesto UI contracts verified.");
