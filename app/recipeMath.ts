import type { Recipe } from "./recipeData";

export type RecipeSettings = {
  pieces: number;
  pieceWeight: number;
  trays: number;
  trayWidth: number;
  trayHeight: number;
  variantId: string;
  water: number;
  bassinage: number;
  salt: number;
  yeast: number;
  levain: number;
  oil: number;
  potato: number;
  levainHydration: number | null;
};

export type IngredientQuantity = {
  key: string;
  label: string;
  percent: number;
  grams: number;
  approximate?: boolean;
};

const positive = (n: unknown, fallback: number, max = 100000) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 && v <= max ? v : fallback;
};
const percent = (n: unknown, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && v <= 250 ? v : fallback;
};
const round = (value: number) => Math.round(value * 1000) / 1000;

export function recipeDefaults(recipe: Recipe): RecipeSettings {
  return {
    pieces: recipe.defaultPieces || 8,
    pieceWeight: recipe.pieceWeight || 260,
    trays: 1,
    trayWidth: recipe.baseTrayWidth || 60,
    trayHeight: recipe.baseTrayHeight || 40,
    variantId: recipe.variants?.[0]?.id || "",
    water: recipe.water,
    bassinage: recipe.bassinage,
    salt: recipe.salt,
    yeast: recipe.yeast,
    levain: recipe.levain,
    oil: recipe.oil,
    potato: recipe.potato,
    levainHydration: recipe.levainHydration,
  };
}

export function normalizeRecipeSettings(recipe: Recipe, input?: Partial<RecipeSettings> | null): RecipeSettings {
  const d = recipeDefaults(recipe);
  const s = input || {};
  return {
    pieces: Math.round(positive(s.pieces, d.pieces, 10000)),
    pieceWeight: positive(s.pieceWeight, d.pieceWeight, 10000),
    trays: Math.round(positive(s.trays, d.trays, 10000)),
    trayWidth: positive(s.trayWidth, d.trayWidth, 500),
    trayHeight: positive(s.trayHeight, d.trayHeight, 500),
    variantId: recipe.variants?.some(v => v.id === s.variantId) ? String(s.variantId) : d.variantId,
    water: percent(s.water, d.water),
    bassinage: percent(s.bassinage, d.bassinage),
    salt: percent(s.salt, d.salt),
    yeast: percent(s.yeast, d.yeast),
    levain: percent(s.levain, d.levain),
    oil: percent(s.oil, d.oil),
    potato: percent(s.potato, d.potato),
    levainHydration: s.levainHydration === null || s.levainHydration === undefined
      ? (s.levainHydration === null ? null : d.levainHydration)
      : percent(s.levainHydration, d.levainHydration ?? 100),
  };
}

export function recipeIsModified(recipe: Recipe, values: RecipeSettings) {
  const d = recipeDefaults(recipe);
  const variant = recipe.variants?.find(v => v.id === values.variantId);
  // Both focaccia and pizza à la coupe are original variations documented on p.7.
  const originalOil = variant?.oil ?? d.oil;
  const keys: (keyof RecipeSettings)[] = [
    "water","bassinage","salt","yeast","levain","potato","levainHydration"
  ];
  return values.oil !== originalOil || keys.some(key => values[key] !== d[key]);
}

export function calculateRecipe(recipe: Recipe, userSettings: RecipeSettings) {
  const s = normalizeRecipeSettings(recipe, userSettings);
  const variant = recipe.variants?.find(v => v.id === s.variantId);
  // Variant values are loaded into the form when selected; keep editable rates
  // separate so the user can still make a clearly labelled personal adaptation.
  const ingredientFactor = 1 + (
    s.water+s.bassinage+s.salt+s.yeast+s.levain+s.oil+s.potato
  ) / 100;
  const isTray = recipe.mode === "plaques";
  const baseFlour = variant?.flourPerTray ?? recipe.baseFlourPerTray ?? 1000;
  const baseArea = (recipe.baseTrayWidth ?? 60) * (recipe.baseTrayHeight ?? 40);
  const area = s.trayWidth * s.trayHeight;
  const flour = isTray
    ? baseFlour * s.trays * area / baseArea
    : (s.pieces * s.pieceWeight) / ingredientFactor;
  const dough = flour * ingredientFactor;

  const quantities: IngredientQuantity[] = [];
  const flourParts = recipe.flourParts?.length ? recipe.flourParts : [{name:recipe.flour.split(" · ")[0],percent:100}];
  for (const part of flourParts) {
    quantities.push({
      key:"farine-"+part.name,
      label:part.name,
      percent:part.percent,
      grams:round(flour * part.percent / 100)
    });
  }
  quantities.push({key:"eau",label:"Eau de coulage",percent:s.water,grams:round(flour*s.water/100)});
  if (s.bassinage > 0) quantities.push({key:"bassinage",label:"Eau de bassinage",percent:s.bassinage,grams:round(flour*s.bassinage/100),approximate:true});
  quantities.push({key:"sel",label:"Sel",percent:s.salt,grams:round(flour*s.salt/100)});
  if (s.yeast > 0) quantities.push({key:"levure",label:"Levure fraîche",percent:s.yeast,grams:round(flour*s.yeast/100)});
  if (s.levain > 0) quantities.push({key:"levain",label:"Levain naturel",percent:s.levain,grams:round(flour*s.levain/100)});
  if (s.oil > 0) quantities.push({key:"huile",label:"Huile d’olive",percent:s.oil,grams:round(flour*s.oil/100)});
  if (s.potato > 0) quantities.push({key:"pomme-de-terre",label:"Pommes de terre cuites",percent:s.potato,grams:round(flour*s.potato/100)});

  const levainFlour = s.levain > 0 && s.levainHydration !== null
    ? flour*s.levain/100/(1+s.levainHydration/100) : 0;
  const levainWater = s.levain > 0 && s.levainHydration !== null
    ? flour*s.levain/100 - levainFlour : 0;
  const effectiveHydration = s.levain > 0 && s.levainHydration === null
    ? null
    : 100*(flour*(s.water+s.bassinage)/100 + levainWater)/(flour + levainFlour);
  const nominalHydration = s.water+s.bassinage;

  return {
    settings:s,
    variant,
    flour:round(flour),
    dough:round(dough),
    quantities,
    nominalHydration:round(nominalHydration),
    effectiveHydration:effectiveHydration === null ? null : round(effectiveHydration),
    levainFlour:round(levainFlour),
    levainWater:round(levainWater),
    pieces: s.pieces,
    pieceWeight:s.pieceWeight,
    trays:s.trays,
    area,
  };
}

export function recipeContextForTutor(recipe: Recipe, settings: RecipeSettings): string {
  const calculation=calculateRecipe(recipe,settings);
  const s=calculation.settings;
  const same= !recipeIsModified(recipe,s);
  const amounts=calculation.quantities.map(i=>i.label+": "+i.grams.toFixed(1)+" g ("+i.percent+" % farine)").join("; ");
  return [
    "Contexte de recette EPPPN transmis par l'utilisateur (calcul arithmétique déterministe).",
    "Source : Fiches recettes EPPPN 2025, fiche page "+recipe.page+", document de connaissance n°5.",
    "Recette : "+recipe.name+" — "+recipe.subtitle+".",
    "Formule : "+(same?"taux documentaires inchangés":"VARIANTE PERSONNELLE des taux de la fiche originale")+".",
    "Cible : "+(recipe.mode==="plaques"
      ? s.trays+" plaque(s) de "+s.trayWidth+" x "+s.trayHeight+" cm"
      : s.pieces+(recipe.kind==="focaccia"?" focaccias":" pâtons")+" de "+s.pieceWeight+" g")+".",
    "Farine : "+recipe.flour+". Masse farine ajoutée "+calculation.flour.toFixed(1)+" g.",
    "Eau de coulage "+s.water+" %, bassinage indicatif "+s.bassinage+" %, sel "+s.salt+" %, levure fraîche "+s.yeast+" %, levain "+s.levain+" %, huile "+s.oil+" %, pommes de terre "+s.potato+" %.",
    "Doses calculées : "+amounts+". Masse totale "+calculation.dough.toFixed(1)+" g.",
    "Hydratation ajoutée "+calculation.nominalHydration.toFixed(1)+" %."+
      (calculation.effectiveHydration===null
        ? " Hydratation réelle avec levain NON calculable : taux d'hydratation du levain absent de la fiche."
        : " Hydratation calculée avec l'eau/la farine du levain : "+calculation.effectiveHydration.toFixed(1)+" %."),
    "Protocole documenté : "+recipe.steps.map(step=>step.name+" — "+step.detail).join("; ")+".",
    recipe.bake ? "Cuisson documentée : "+recipe.bake+"." : "",
    "IMPORTANT : les valeurs de bassinage notées « ~ » sont approximatives et dépendent de la farine. Les calculs de grammes sont arithmétiques, pas de nouvelles recommandations EPPPN. Distingue toujours original et adaptation personnelle.",
    "Les pourcentages de levain portent sur la farine AJOUTÉE ; la farine et l'eau contenues dans le levain sont prises en compte seulement lorsque son hydratation est spécifiée.",
  ].filter(Boolean).join("\n");
}
