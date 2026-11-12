import assert from "node:assert/strict";
import {advisePizzaPriceHt,PIZZA_COST_COEFFICIENT,PIZZA_REFERENCE_SHARE,PIZZA_AREA_FACTOR} from "../app/pizzaPricing";

const cheap=advisePizzaPriceHt(1.94,"quartier");
const expensive=advisePizzaPriceHt(4.44,"quartier");
assert.equal(PIZZA_COST_COEFFICIENT,2);
assert.equal(PIZZA_REFERENCE_SHARE,0.6);
assert.equal(cheap.recommendedHt,11.5,"1,94 EUR in a regular urban neighborhood → 11,50 EUR HT");
assert.equal(expensive.recommendedHt,16.5,"4,44 EUR in the same neighborhood → 16,50 EUR HT");
assert.ok(expensive.recommendedHt-cheap.recommendedHt>=5,"Price follows direct costs; no dominant national price floor");
assert.ok(Math.abs(expensive.unroundedHt-cheap.unroundedHt-(4.44-1.94)*PIZZA_COST_COEFFICIENT)<1e-8,"Every additional euro costs the same markup");
assert.ok(Math.abs(cheap.areaReferenceHt-expensive.areaReferenceHt)<1e-8,"Area basis is independent of pizza composition");
assert.ok(cheap.recommendedHt>=10.5,"Entry-level pizza has sufficient direct contribution");
assert.ok(1.94/cheap.recommendedHt<0.20,"Simple pizza stays below 20 % direct-cost ratio");
assert.ok(4.44/expensive.recommendedHt<0.30,"Higher-cost pizza stays below 30 % direct-cost ratio");

const zones=["rural","bourg","peripherie","quartier","centre"] as const;
for(let i=1;i<zones.length;i++){
  assert.ok(PIZZA_AREA_FACTOR[zones[i]]>=PIZZA_AREA_FACTOR[zones[i-1]]);
  assert.ok(advisePizzaPriceHt(2.5,zones[i]).unroundedHt>advisePizzaPriceHt(2.5,zones[i-1]).unroundedHt);
}
for(const zone of zones){
  let previous=0;
  for(let c=0;c<=25;c+=0.25){
    const advised=advisePizzaPriceHt(c,zone);
    assert.ok(advised.recommendedHt>=previous,"Price never falls when ingredients become costlier");
    assert.ok(advised.recommendedHt>=advised.unroundedHt-1e-7,"Half-euro rounding is upwards");
    previous=advised.recommendedHt;
  }
}
console.log("Pizza pricing: transparent progressive cost formula, urban examples, zone hierarchy and rounding OK");
