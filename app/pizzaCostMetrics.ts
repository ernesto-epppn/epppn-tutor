/** Calculs HT pour une pizza, sans confondre marge brute et bénéfice net. */
export type PizzaMoneyMetrics={
  saleHt:number;
  origin:"saisi"|"conseillé";
  ingredientHt:number;
  packagingHt:number;
  directCostHt:number;
  grossMarginHt:number;
  grossMarginPct:number;
  foodCostPct:number;
  packagingPct:number;
  directCostPct:number;
  isLoss:boolean;
};
export function pizzaMoneyMetrics(params:{
  ingredientHt:number;
  packagingHt:number|null;
  sellingHt:number;
  recommendedHt:number;
  complete:boolean;
}):PizzaMoneyMetrics|null{
  const {ingredientHt,packagingHt,sellingHt,recommendedHt,complete}=params;
  if(!complete)return null;
  // Packaging is optional; an empty field counts as zero without altering the saved value.
  const effectivePackagingHt=packagingHt??0;
  if(![ingredientHt,effectivePackagingHt,sellingHt,recommendedHt].every(Number.isFinite))return null;
  if(ingredientHt<0||effectivePackagingHt<0)return null;
  const origin=sellingHt>0?"saisi" as const:"conseillé" as const;
  const saleHt=origin==="saisi"?sellingHt:recommendedHt;
  if(saleHt<=0)return null;
  const directCostHt=ingredientHt+effectivePackagingHt;
  const grossMarginHt=saleHt-directCostHt;
  return {
    saleHt,origin,ingredientHt,packagingHt:effectivePackagingHt,directCostHt,grossMarginHt,
    grossMarginPct:grossMarginHt/saleHt*100,
    foodCostPct:ingredientHt/saleHt*100,
    packagingPct:effectivePackagingHt/saleHt*100,
    directCostPct:directCostHt/saleHt*100,
    isLoss:grossMarginHt<0,
  };
}
