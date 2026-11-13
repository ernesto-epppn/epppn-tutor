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
const globalCSS = read("app/globals.css");
assert.doesNotMatch(layout, /next\/font\/google/, "Build must not depend on Google Fonts downloads");
assert.match(layout, /fonts\.googleapis\.com/, "Preserve IBM Plex Sans where browser downloads are available");
assert.match(globalCSS, /--font-ernesto-ui:\s*"IBM Plex Sans"/, "Keep matching font-family variable and browser fallback");
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
assert.doesNotMatch(helpComponent, /Toutes les aides|href="\/aide"|target="_blank"/, "No all-help links in any contextual help dialog");
assert.match(helpComponent, /"use client";/, "Interactive help must be a client component");
assert.match(helpComponent, /showModal\(\)/, "Help must use the browser top layer");
assert.match(helpComponent, /<dialog/, "Help must use an accessible native dialog");
assert.match(helpComponent, /aria-labelledby=\{titleId\}/, "Dialog must have an accessible heading");
assert.match(helpComponent, /aria-label="Fermer l'aide"/, "Help needs a reachable close button");
assert.match(helpComponent, /onClose=\{onDialogClosed\}/, "Handle native dialog closure");
assert.match(helpComponent, /triggerRef.current\?\.focus/, "Restore keyboard focus to trigger");
assert.match(helpComponent, /createPortal\(/, "Help must render outside clipped workspace containers");
assert.match(helpComponent, /document\.body/, "Portal target must be the document body");
assert.doesNotMatch(helpComponent, /topic !== "home"/, "No special-case guide link remains");
assert.doesNotMatch(helpComponent, /<details/, "Old clipped popover must not remain");
assert.match(helpPage, /from "\.\.\/ernestoHelpTopics"/, "Server-side help page imports data, not client component");
assert.match(layout, /ernesto-help-polish.css/, "Include shared help CSS");
assert.match(visual, /prefers-reduced-motion/, "Respect reduced motion");
assert.match(visual, /\.ernestoHelpDialog\s*\{/, "Help dialog has standalone viewport layout");
assert.match(visual, /max-height:\s*min\(82dvh,\s*640px\)/, "Mobile help sheet must respect viewport height");
assert.match(visual, /safe-area-inset-bottom/, "Mobile help must clear the iOS safe area");
assert.match(visual, /overflow-y:\s*auto/, "Mobile help content must scroll within sheet");
assert.doesNotMatch(visual, /\.ernestoHelpPanel/, "Old absolutely positioned panel CSS must be removed");

// Recipe provenance is retained internally but the redundant source banners are not shown.
assert.doesNotMatch(recipeStudio, /Une formule d'origine, des variantes contrôlées\.|Source : <strong>|CUISSON · SOURCE|Source p\./, "No redundant source labels in the recipes interface");
assert.match(recipeStudio, /<aside className="ers-protocol" aria-label="Protocole de préparation et cuisson">/, "Recipe steps must be in a dedicated right-side protocol region");
assert.match(recipeStudio, /<strong>Protocole<\/strong>/, "Protocol has an unambiguous heading");
const recipeLayout=read("app/ernesto-recipe-layout.css");
assert.match(recipeLayout, /\.ers-work\{display:grid;grid-template-columns:/, "Recipe split view must be explicit");
assert.match(recipeLayout, /\.ers-protocol\{[^}]*display:flex;flex-direction:column;/, "Right protocol has its own visual panel");
assert.match(recipeLayout, /@media\(max-width:740px\)/, "Recipes need a dedicated compact/mobile layout");
assert.match(layout, /ernesto-recipe-layout\.css/, "Refined recipe layout must be loaded");

// Installation shortcut is a secondary home action, preserving the four-workspace grid.
const appGuide=read("app/ErnestoAppGuide.tsx");
const guideStyle=read("app/ernesto-app-guide.css");
assert.match(home, /<ErnestoAppGuide\/>/, "Home provides an Ernesto App guide entry");
assert.match(appGuide, /<dialog/, "Installation instructions must open in a real dialog");
assert.match(appGuide, /showModal\(\)/, "Guide uses the browser top layer");
assert.match(appGuide, /createPortal\(/, "Guide stays outside overflow-clipped workspace containers");
assert.match(appGuide, /<button[^>]*role="tab"/s, "Guide includes phone tabs");
for(const label of ["iPhone","Android","Ernesto App sur votre téléphone","Ajoutez Ernesto App","Ouvrez le lien","Sur l’écran d’accueil"]){
  assert.ok(appGuide.includes(label), "Installation guide missing "+label);
}
assert.doesNotMatch(appGuide, /Safari|Chrome|ernestoAppBrowserChoice|type Browser/, "Installation guide must only offer iPhone and Android");
assert.match(appGuide, /const steps:Record<Phone,string\[\]>/, "Install steps are defined by phone, not browser");
assert.match(guideStyle, /max-height:100dvh/, "Mobile guide must fit the viewport");
assert.match(guideStyle, /safe-area-inset-bottom/, "Mobile dialog needs bottom safe-area space");
assert.match(layout, /ernesto-app-guide\.css/, "Include installation guide CSS");
assert.ok(layout.indexOf('ernesto-recipe-layout.css')>layout.indexOf('ernesto-editorial-identity.css'), "Recipe layout must override the editorial theme when needed");

// Home must surface up to four recent workspaces, not three recent dossiers.
assert.match(home, /Activités récentes/, "Home displays recent activity header");
assert.match(home, /<ErnestoAppGuide\/>[\s\S]*Activités récentes/, "Recent activity is below Ernesto App");
assert.match(home, /recentActivities\.slice\(0,4\)/, "Limit to four last-used workspaces");
assert.doesNotMatch(home, /Dossiers récents|recent\.map\(p|onSelectDossier|onAllDossiers/, "Home should not render recent dossiers");
assert.match(page, /useErnestoRecentSections/, "Workspace visits must be recorded by the main page");
assert.match(page, /recentActivities=\{recentActivities\}/, "Home receives real recent workspace usage");
const recentSource=read("app/ernestoRecentSections.ts");
const activityCss=read("app/ernesto-recent-activities.css");
assert.match(recentSource, /ernesto-recent-sections-v1:/, "Recent section usage needs account-scoped storage");
assert.match(recentSource, /localStorage\.setItem/, "Recent activity must survive a reload");
assert.match(recentSource, /MAX_RECENT=4/, "Keep four distinct recent workspaces");
assert.match(activityCss, /@media\(max-width:570px\)/, "Recent activities must fit mobile");
assert.match(layout, /ernesto-recent-activities\.css/, "Load recent activity CSS");

console.log("Ernesto UI contracts verified.");
