/**
 * Repère pédagogique de prix HT par pizza.
 *
 * Le repère national sert de contribution commerciale de base, jamais de
 * prix plancher. Chaque euro supplémentaire de matières + emballage
 * augmente de 1,50 euro le prix conseillé avant l'arrondi au demi-euro.
 * Les coefficients géographiques sont hypothétiques : aucun relevé local.
 */
export type PizzaArea="centre"|"quartier"|"peripherie"|"bourg"|"rural";

export const PIZZA_REFERENCE_TTC=13.24; // Indice Pizza GIRA 2026
export const PIZZA_REFERENCE_VAT=0.10; // Conversion indicative TTC → HT
export const PIZZA_COST_COEFFICIENT=1.5;
export const PIZZA_REFERENCE_SHARE=0.50;
export const PIZZA_ROUNDING_STEP=0.5;
export const PIZZA_AREA_FACTOR:Record<PizzaArea,number>={
  centre:1.08,quartier:1.04,peripherie:1,bourg:0.97,rural:0.95,
};

export function advisePizzaPriceHt(directCostHt:number,area:PizzaArea){
  const cost=Number.isFinite(directCostHt)?Math.max(0,directCostHt):0;
  const marketReferenceHt=PIZZA_REFERENCE_TTC/(1+PIZZA_REFERENCE_VAT);
  const areaReferenceHt=marketReferenceHt*PIZZA_REFERENCE_SHARE*PIZZA_AREA_FACTOR[area];
  const costPartHt=cost*PIZZA_COST_COEFFICIENT;
  const unroundedHt=areaReferenceHt+costPartHt;
  const recommendedHt=Math.ceil((unroundedHt-1e-9)/PIZZA_ROUNDING_STEP)*PIZZA_ROUNDING_STEP;
  return {marketReferenceHt,areaReferenceHt,costPartHt,unroundedHt,recommendedHt};
}
