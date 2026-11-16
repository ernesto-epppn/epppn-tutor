"use client";
import {useEffect,useMemo,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Recipe} from "./recipeData";
import {calculateRecipe,recipeDefaults} from "./recipeMath";
import {advisePizzaPriceHt,PIZZA_COST_COEFFICIENT,PIZZA_REFERENCE_SHARE} from "./pizzaPricing";
import type {PizzaArea} from "./pizzaPricing";
import {pizzaMoneyMetrics} from "./pizzaCostMetrics";

type Line={id:string;name:string;grams:number;priceKg:number|null;kind:"pate"|"garniture"};
type Area=PizzaArea;
type Costing={id:string;name:string;recipeId:string;lines:Line[];packagingHt:number|null;otherHt:number;
  laborHt:number;energyHt:number;sellingHt:number;monthlyFixedHt:number;monthlyVolume:number;
  targetPct:number;segment:"simple"|"standard"|"speciale";area:Area;version:3};
type RecordRow={id:string;kind:string;payload:Record<string,unknown>;updated_at:string};
type Props={supabase:SupabaseClient;userId?:string;records:RecordRow[];recipes:Recipe[];onStored:()=>void};
const money=new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:2});
const fmt=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2});
function number(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=1000000?n:0;}
function initial(recipe?:Recipe):Costing{
 const id="pizza:"+crypto.randomUUID();
 const calc=recipe?calculateRecipe(recipe,recipeDefaults(recipe)):null;
 const units=calc?(recipe?.mode==="plaques"?calc.trays:calc.pieces):1;
 const lines:Line[]=calc?.quantities.map(i=>({
  id:i.key,name:i.label,grams:Math.round(i.grams/units*100)/100,priceKg:null,kind:"pate" as const
 }))||[{id:"farine",name:"Farine",grams:160,priceKg:null,kind:"pate"},
      {id:"sauce",name:"Sauce tomate",grams:90,priceKg:null,kind:"garniture"},
      {id:"fromage",name:"Mozzarella",grams:80,priceKg:null,kind:"garniture"}];
 return {id,name:recipe?.name||"Ma pizza",recipeId:recipe?.id||"",lines,packagingHt:null,otherHt:0,laborHt:0,energyHt:0,
  sellingHt:0,monthlyFixedHt:0,monthlyVolume:0,targetPct:28,segment:"standard",area:"quartier",version:3};
}
function parseCost(payload:Record<string,unknown>):Costing|null{
 if((payload.version!==2&&payload.version!==3)||!Array.isArray(payload.lines)||typeof payload.id!=="string")return null;
 const lines=payload.lines.slice(0,80).map((v:unknown)=>{const l=(v||{}) as Partial<Line>;
  return {id:String(l.id||crypto.randomUUID()),name:String(l.name||"").slice(0,100),
   grams:number(l.grams),priceKg:l.priceKg===null||l.priceKg===undefined?null:number(l.priceKg),
   kind:l.kind==="pate"?"pate":"garniture"} as Line;});
 return {id:payload.id,name:String(payload.name||"Pizza"),recipeId:String(payload.recipeId||""),
  lines,packagingHt:payload.packagingHt===null||payload.packagingHt===undefined||
    (payload.version===2 && Number(payload.packagingHt)===0)?null:number(payload.packagingHt),
  otherHt:number(payload.otherHt),laborHt:number(payload.laborHt),
  energyHt:number(payload.energyHt),sellingHt:number(payload.sellingHt),monthlyFixedHt:number(payload.monthlyFixedHt),
  monthlyVolume:number(payload.monthlyVolume),targetPct:number(payload.targetPct)||28,
  segment:payload.segment==="simple"||payload.segment==="speciale"?payload.segment:"standard",
  area:(["centre","quartier","peripherie","bourg","rural"].includes(String(payload.area))?String(payload.area):"quartier") as Area,version:3};
}
function PriceField({value,onChange,unit="€",nullable=false}:{value:number|null;onChange:(n:number|null)=>void;unit?:string;nullable?:boolean}){
 return <span className="epcPrice"><input type="number" min="0" step="any" inputMode="decimal" value={value===null?"":value}
   placeholder={nullable?"":"0"} onChange={e=>onChange(e.target.value===""&&nullable?null:number(e.target.value))}/>
   <small>{unit}</small></span>;
}
export default function ErnestoPizzaCosting({supabase,userId,records,recipes,onStored}:Props){
 const saved=useMemo(()=>records.filter(r=>r.kind==="costing").map(row=>({row,cost:parseCost(row.payload)}))
  .filter((item):item is {row:RecordRow;cost:Costing}=>Boolean(item.cost)),[records]);
 const [cost,setCost]=useState<Costing|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 const [advice,setAdvice]=useState(false);
 const [newRecipe,setNewRecipe]=useState("");
 useEffect(()=>{if(!cost)setCost(initial());},[cost]);
 if(!cost)return null;
 const activeCost:Costing=cost;
 const patch=(next:Partial<Costing>)=>{setCost(v=>v?{...v,...next}:v);setAdvice(false);setNotice("");};
 const patchLine=(id:string,next:Partial<Line>)=>patch({lines:activeCost.lines.map(l=>l.id===id?{...l,...next}:l)});
 const unknown=activeCost.lines.filter(l=>l.grams>0&&l.priceKg===null);
 const ingredients=activeCost.lines.reduce((n,l)=>n+l.grams/1000*(l.priceKg||0),0);
 const packaging=activeCost.packagingHt;
 const grossCost=ingredients+(packaging??0);
 const ready=unknown.length===0&&activeCost.lines.some(l=>l.grams>0)&&ingredients>0&&packaging!==null;
 // Le prix conseillé sert de référence tant qu'aucun prix de vente n'est saisi.
 const pricing=advisePizzaPriceHt(grossCost,activeCost.area);
 const recommended=pricing.recommendedHt;
 const metrics=pizzaMoneyMetrics({
  ingredientHt:ingredients,packagingHt:packaging,sellingHt:activeCost.sellingHt,
  recommendedHt:recommended,complete:ready,
 });
 const gross=metrics?.grossMarginHt??null;
 const grossPct=metrics?.grossMarginPct??null;
 const foodPct=metrics?.foodCostPct??null;
 const donutStyle=metrics&&!metrics.isLoss?{
  background:`conic-gradient(#547d70 0 ${metrics.foodCostPct}%,#bba477 ${metrics.foodCostPct}% ${metrics.directCostPct}%,#dce8dc ${metrics.directCostPct}% 100%)`,
 }:undefined;
 function load(row:{cost:Costing}){setNewRecipe(row.cost.recipeId);setCost(row.cost);setAdvice(false);setError("");setNotice("");}
 function create(recipeId:string){
  const r=recipes.find(x=>x.id===recipeId);
  setCost(initial(r));setNewRecipe(recipeId);setAdvice(false);setError("");setNotice("");
 }
 function addLine(){
  patch({lines:[...activeCost.lines,{id:crypto.randomUUID(),name:"",grams:0,priceKg:null,kind:"garniture"}]});
 }
 async function save(){
  if(!userId)return;
  if(!ready||!activeCost.name.trim()||activeCost.lines.some(l=>!l.name.trim())){setError("Renseignez les ingrédients, les prix HT/kg et l’emballage HT par pizza avant d’enregistrer.");return;}
  setBusy(true);setError("");setNotice("");
  try{
   const item=saved.find(x=>x.cost.id===activeCost.id);
   const payload={...activeCost,name:activeCost.name.slice(0,120),lines:activeCost.lines.map(l=>({...l,name:l.name.slice(0,100)}))};
   const db=supabase.from("ernesto_activity_records");
   const query=item?db.update({payload,updated_at:new Date().toISOString()}).eq("id",item.row.id).eq("user_id",userId):
     db.insert({user_id:userId,kind:"costing",payload});
   const {error:err}=await query;
   if(err)throw Error(err.message);
   setNotice("Fiche de coût HT enregistrée.");onStored();
  }catch(e){setError(e instanceof Error?e.message:"Enregistrement impossible.");}
  finally{setBusy(false);}
 }
 async function remove(){
  const item=saved.find(x=>x.cost.id===activeCost.id);
  if(!item||!userId||!window.confirm("Supprimer cette fiche de coût ?"))return;
  setBusy(true);
  const {error:err}=await supabase.from("ernesto_activity_records").delete().eq("id",item.row.id).eq("user_id",userId);
  setBusy(false);
  if(err)setError("Suppression impossible.");else{setCost(initial());setNotice("Fiche supprimée.");onStored();}
 }
 return <div className="epc">
  <div className="epcTop">
   <div><h3>Food cost · par pizza</h3><p>Coûts, emballage, marge et prix de vente : tous les montants sont HT.</p></div>
   <button type="button" onClick={()=>create("")}>+ Nouvelle pizza</button>
  </div>
  <div className="epcChoose">
   <label>Mes fiches enregistrées<select value={saved.some(x=>x.cost.id===activeCost.id)?activeCost.id:""}
      onChange={e=>{const item=saved.find(x=>x.cost.id===e.target.value);if(item)load(item);}}>
      <option value="">Nouvelle fiche</option>{saved.map(x=><option key={x.cost.id} value={x.cost.id}>{x.cost.name}</option>)}
    </select></label>
   <label>Partir d'une pâte<select value={newRecipe} onChange={e=>create(e.target.value)}>
      <option value="">Pizza personnalisée</option>{recipes.filter(r=>r.mode==="pâtons").map(r=><option key={r.id} value={r.id}>{r.name} · {r.subtitle}</option>)}
    </select></label>
  </div>
  {error?<div className="epcError" role="alert">{error}</div>:null}
  {notice?<div className="epcNotice" role="status">{notice}</div>:null}
  <div className="epcGrid">
   <div className="epcCard">
    <label className="epcName">Nom de la pizza<input maxLength={120} value={activeCost.name} onChange={e=>patch({name:e.target.value})}/></label>
    {activeCost.recipeId?<p className="epcMuted">Pâte de départ : {recipes.find(r=>r.id===activeCost.recipeId)?.name||"recette personnelle"} · quantités ramenées à une unité, modifiables.</p>:null}
    <div className="epcTableHeading"><span>Ingrédient</span><span>Quantité g</span><span>Prix HT/kg</span><span>Coût HT</span><span/></div>
    {activeCost.lines.map(l=><div className="epcLine" key={l.id}>
      <input aria-label="Ingrédient" value={l.name} maxLength={100} onChange={e=>patchLine(l.id,{name:e.target.value})}/>
      <PriceField unit="g" value={l.grams} onChange={v=>patchLine(l.id,{grams:v||0})}/>
      <PriceField unit="€/kg" nullable value={l.priceKg} onChange={v=>patchLine(l.id,{priceKg:v})}/>
      <strong>{l.priceKg===null?"—":money.format(l.grams*l.priceKg/1000)}</strong>
      <button type="button" aria-label={"Retirer "+l.name} onClick={()=>patch({lines:activeCost.lines.filter(x=>x.id!==l.id)})}>×</button>
    </div>)}
    <button className="epcAdd" type="button" onClick={addLine}>+ Ajouter un ingrédient</button>
    <div className="epcOther">
      <label>Emballage HT / pizza <span className="epcRequired">À renseigner</span>
        <PriceField nullable value={packaging} onChange={v=>patch({packagingHt:v})}/>
      </label>
    </div>
    <div className="epcAdvice epcAdviceLeft">
      <div className="epcAdviceHeader"><strong>Prix de vente conseillé</strong><span>Estimation HT selon le coût et l'environnement commercial.</span></div>
      <label>Environnement de la pizzeria
        <select value={activeCost.area} onChange={e=>patch({area:e.target.value as Area})}>
          <option value="centre">Centre-ville / secteur très fréquenté</option>
          <option value="quartier">Quartier urbain</option>
          <option value="peripherie">Périphérie / commune voisine</option>
          <option value="bourg">Petite ville / bourg</option>
          <option value="rural">Commune rurale</option>
        </select>
      </label>
      <button type="button" disabled={!ready} className="epcRecommend" onClick={()=>setAdvice(true)}>
        <span>Calculer le prix conseillé</span><span aria-hidden="true">↗</span>
      </button>
      {advice&&ready?<div className="epcProposal" role="status">
        <small>PRIX CONSEILLÉ · HT / PIZZA</small>
        <div className="epcProposalAmount"><strong>{money.format(recommended)}</strong>
          <button type="button" onClick={()=>patch({sellingHt:recommended})}>Appliquer ce prix</button>
        </div>
        <div className="epcPriceMethod">
          <strong>Comment le prix est calculé</strong>
          <div><span>Coût direct × {fmt.format(PIZZA_COST_COEFFICIENT)}</span><b>{money.format(pricing.costPartHt)}</b></div>
          <div><span>Base commerciale de la zone</span><b>{money.format(pricing.areaReferenceHt)}</b></div>
          <div className="epcPriceMethodTotal"><span>Total avant arrondi</span><b>{money.format(pricing.unroundedHt)}</b></div>
          <div><span>Part des coûts directs au prix conseillé</span><b>{fmt.format(grossCost/recommended*100)} %</b></div>
          <small>Base = {fmt.format(PIZZA_REFERENCE_SHARE*100)} % du repère national HT ajusté selon l'environnement. Chaque 1 € supplémentaire de matières et d'emballage ajoute {money.format(PIZZA_COST_COEFFICIENT)} avant l'arrondi supérieur à 0,50 €.</small>
        </div>
        <p>Repère indicatif basé sur le coût direct et l'<a href="https://www.giraconseil.fr/newsletter-no43" target="_blank" rel="noopener noreferrer">Indice Pizza GIRA 2026</a> (13,24 € TTC, converti en HT avec une hypothèse de TVA à 10 %). Les coefficients géographiques sont illustratifs et non issus de relevés locaux. Ce prix ne garantit pas la rentabilité : confrontez-le aux prix voisins et à vos charges réelles.</p>
      </div>:null}
    </div>
    <div className="epcSaveArea">
      <button className="epcSave" type="button" disabled={busy||!ready} onClick={()=>void save()}>Enregistrer cette pizza</button>
      {saved.some(x=>x.cost.id===activeCost.id)?<button className="epcDelete" type="button" disabled={busy} onClick={()=>void remove()}>Supprimer la fiche</button>:null}
    </div>
    {metrics?<section className="epcCirclePanel" aria-label="Répartition du prix de vente HT">
      <div className="epcCircleHeader"><strong>Répartition du prix de vente</strong>
        <span>{metrics.origin==="conseillé"?"Sur la base du prix conseillé HT":"Sur la base du prix saisi HT"}</span></div>
      {metrics.isLoss?<p className="epcCostWarning">Le prix saisi est inférieur au coût direct : marge brute négative de {money.format(Math.abs(metrics.grossMarginHt))}.</p>:
      <div className="epcCircleLayout">
        <div className="epcDonut" style={donutStyle} role="img" aria-label={`Répartition du prix HT : matières ${fmt.format(metrics.foodCostPct)} %, emballage ${fmt.format(metrics.packagingPct)} %, marge brute ${fmt.format(metrics.grossMarginPct)} %`}>
          <div className="epcDonutCenter"><small>Marge brute</small><strong>{fmt.format(metrics.grossMarginPct)} %</strong><span>{money.format(metrics.grossMarginHt)} HT</span></div>
        </div>
        <div className="epcCircleLegend">
          <div><span><i className="epcCircleDot is-matiere"/>Matières</span><strong>{money.format(ingredients)}</strong></div>
          <div><span><i className="epcCircleDot is-emballage"/>Emballage</span><strong>{money.format(packaging??0)}</strong></div>
          <div><span><i className="epcCircleDot is-marge"/>Marge brute</span><strong>{money.format(metrics.grossMarginHt)}</strong></div>
          <div className="epcCircleFoot"><span>Prix de vente HT</span><strong>{money.format(metrics.saleHt)}</strong></div>
        </div>
      </div>}
      <p>La marge brute n’est pas le bénéfice net : elle ne déduit pas les autres charges.</p>
    </section>:null}
        <p className="epcMuted">Saisissez tous les prix HT/kg et l’emballage. Indiquez 0 € pour l’emballage seulement si vous n’en utilisez pas. La farine est incluse dans le coût.</p>
   </div>
   <div className="epcCard epcSummary">
    <label>Prix de vente HT / pizza (modifiable)<PriceField nullable value={activeCost.sellingHt>0?activeCost.sellingHt:null} onChange={v=>patch({sellingHt:v||0})}/></label>
    <p className="epcPriceBasis">{metrics?(metrics.origin==="conseillé"?
      <>Calculs basés sur le prix conseillé de <strong>{money.format(recommended)}</strong>. Saisissez un prix pour recalculer.</>:
      <>Calculs basés sur votre prix de vente saisi.</>):"Renseignez les prix des matières et l’emballage pour afficher les marges."}</p>
    <div className="epcMetrics">
      <div><span>Food cost matières HT</span><strong>{ready?money.format(ingredients):"Incomplet"}</strong></div>
      <div><span>Emballage HT</span><strong>{packaging===null?"À renseigner":money.format(packaging)}</strong></div>
      <div><span>Coût direct HT (matières + emballage)</span><strong>{ready?money.format(grossCost):"Incomplet"}</strong></div>
      <div><span>Marge brute HT (vente − matières − emballage)</span><strong>{ready&&gross!==null?money.format(gross):"—"}</strong></div>
      <div><span>Taux de marge brute</span><strong>{ready&&grossPct!==null?fmt.format(grossPct)+" %":"—"}</strong></div>
      <div><span>Food cost / prix HT</span><strong>{ready&&foodPct!==null?fmt.format(foodPct)+" %":"—"}</strong></div>

    </div>
    <div className="epcFloor"><span>Coût direct HT / pizza</span>
      <strong>{ready?money.format(grossCost):"—"}</strong>
      <small>Matières et emballage uniquement. Les autres charges ne sont pas déduites de la marge brute.</small>
    </div>

    <p className="epcMuted">Les frais fixes et les autres charges restent à couvrir par la marge brute.</p>
   </div>
  </div>
 </div>;
}