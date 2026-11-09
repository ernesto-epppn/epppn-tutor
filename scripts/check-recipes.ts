import assert from "node:assert/strict";
import { EPPPN_RECIPES } from "../app/recipeData";
import {
  calculateRecipe,
  recipeDefaults,
  recipeIsModified,
  normalizeRecipeSettings,
} from "../app/recipeMath";

const close = (actual: number, expected: number, tolerance = 0.02) => {
  assert.ok(Number.isFinite(actual), "Quantity must be finite");
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    "Expected " + actual + " ≈ " + expected
  );
};

assert.equal(EPPPN_RECIPES.length, 19, "The EPPPN 2025 kit has 19 recipes");
assert.equal(new Set(EPPPN_RECIPES.map(r => r.id)).size, 19, "Recipe IDs unique");
assert.deepEqual(
  EPPPN_RECIPES.map(r => r.page).sort((a,b) => a-b),
  Array.from({ length: 19 }, (_,i) => i+2),
  "All printed recipe pages 2 through 20 are represented"
);

for (const recipe of EPPPN_RECIPES) {
  assert.ok(recipe.name && recipe.flour && recipe.steps.length > 0, "Complete metadata on p. " + recipe.page);
  if (recipe.flourParts) close(recipe.flourParts.reduce((n,p)=>n+p.percent,0),100);
  const values = recipeDefaults(recipe);
  const calc = calculateRecipe(recipe, values);
  assert.ok(calc.flour > 0 && calc.dough > calc.flour, "Positive quantities on p. "+recipe.page);
  const sum = calc.quantities.reduce((n,q)=>n+q.grams,0);
  close(sum,calc.dough,0.05);
  if(recipe.mode === "pâtons") close(calc.dough, values.pieces*values.pieceWeight);
  assert.equal(recipeIsModified(recipe, values), false, "Original recipe flag p. "+recipe.page);
  if(recipe.levain && recipe.levainHydration===null) {
    assert.equal(calc.effectiveHydration,null,"Unknown starter hydration remains unknown");
  }
  if(recipe.mode==="plaques") {
    const wider = calculateRecipe(recipe,{...values,trayWidth:values.trayWidth*2});
    close(wider.dough,calc.dough*2);
  }
}

const classic = EPPPN_RECIPES.find(r=>r.id==="classique-direct")!;
const eight = calculateRecipe(classic,{...recipeDefaults(classic),pieces:8,pieceWeight:260});
close(eight.dough,2080);

const focaccia = EPPPN_RECIPES.find(r=>r.id==="focaccia-j1")!;
const coupeSettings=normalizeRecipeSettings(focaccia,{
  ...recipeDefaults(focaccia),variantId:"coupe",oil:5
});
assert.equal(recipeIsModified(focaccia,coupeSettings),false,"Documented alternative is official");
const coupe=calculateRecipe(focaccia,coupeSettings);
close(coupe.flour,1200);
const base=calculateRecipe(focaccia,recipeDefaults(focaccia));
close(base.flour,1400);

const starterExample = EPPPN_RECIPES.find(r=>r.id==="classique-levain-j1")!;
const sample = calculateRecipe(starterExample,{
  ...recipeDefaults(starterExample),
  pieces:10,
  pieceWeight:173,
  water:53,
  bassinage:0,
  levain:20,
  salt:0,
  levainHydration:100,
});
close(sample.flour,1000);
close(sample.levainFlour,100);
close(sample.levainWater,100);
close(sample.dough,1730);
close(sample.effectiveHydration!, (630/1100)*100, 0.005);
assert.equal(recipeIsModified(starterExample,recipeDefaults(starterExample)),false);

console.log("EPPPN: 19 source formulas, baker's percentages, mass conservation, starter hydration and trays OK");
