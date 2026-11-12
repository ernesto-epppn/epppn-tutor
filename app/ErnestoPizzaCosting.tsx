"use client";
import {useEffect,useMemo,useState} from "react";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Recipe} from "./recipeData";
import {calculateRecipe,recipeDefaults} from "./recipeMath";

type Line={id:string;name:string;grams:number;priceKg:number|null;kind:"pate"|"garniture"};
type Costing={id:string;name:string;recipeId:string;lines:Line[];packagingHt:number;otherHt:number;
  laborHt:number;energyHt:number;sellingHt:number;monthlyFixedHt:number;monthlyVolume:number;
  targetPct:number;segment:"simple"|"standard"|"speciale";version:2};
type RecordRow={id:string;kind:string;payload:Record<string,unknown>;updated_at:string};
type Props={supabase:SupabaseClient;userId?:string;records:RecordRow[];recipes:Recipe[];onStored:()=>void};
const money=new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:2});
const fmt=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2});
const MARKET_FR_HT=13.24/1.10; // GIRA Indice Pizza 2026, 13.24 EUR TTC, conversion illustrative at VAT 10%.
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
 return {id,name:recipe?.name||"Ma pizza",recipeId:recipe?.id||"",lines,packagingHt:0,otherHt:0,laborHt:0,energyHt:0,
  sellingHt:0,monthlyFixedHt:0,monthlyVolume:0,targetPct:28,segment:"standard",version:2};
}
function parseCost(payload:Record<string,unknown>):Costing|null{
 if(payload.version!==2||!Array.isArray(payload.lines)||typeof payload.id!=="string")return null;
 const lines=payload.lines.slice(0,80).map((v:unknown)=>{const l=(v||{}) as Partial<Line>;
  return {id:String(l.id||crypto.randomUUID()),name:String(l.name||"").slice(0,100),
   grams:number(l.grams),priceKg:l.priceKg===null||l.priceKg===undefined?null:number(l.priceKg),
   kind:l.kind==="pate"?"pate":"garniture"} as Line;});
 return {id:payload.id,name:String(payload.name||"Pizza"),recipeId:String(payload.recipeId||""),
  lines,packagingHt:number(payload.packagingHt),otherHt:number(payload.otherHt),laborHt:number(payload.laborHt),
  energyHt:number(payload.energyHt),sellingHt:number(payload.sellingHt),monthlyFixedHt:number(payload.monthlyFixedHt),
  monthlyVolume:number(payload.monthlyVolume),targetPct:number(payload.targetPct)||28,
  segment:payload.segment==="simple"||payload.segment==="speciale"?payload.segment:"standard",version:2};
}
function PriceField({value,onChange,unit="€",nullable=false}:{value:number|null;onChange:(n:number|null)=>void;unit?:string;nullable?:boolean}){
 return <span className="epcPrice"><input type="number" min="0" step="any" inputMode="decimal" value={value===null?"":value}
   placeholder={nullable?"—":"0"} onChange={e=>onChange(e.target.value===""&&nullable?null:number(e.target.value))}/>
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
 const totalVar=ingredients+packaging+activeCost.energyHt+activeCost.laborHt+activeCost.otherHt;
 const grossCost=ingredients+packaging;
 const gross=activeCost.sellingHt>0&&unknown.length===0?activeCost.sellingHt-grossCost:null;
 const grossPct=gross!==null?gross/activeCost.sellingHt*100:null;
 const contribution=activeCost.sellingHt>0&&unknown.length===0?activeCost.sellingHt-totalVar:null;
 const foodPct=activeCost.sellingHt>0&&unknown.length===0?ingredients/activeCost.sellingHt*100:null;
 const fixedPerUnit=activeCost.monthlyVolume>0?activeCost.monthlyFixedHt/activeCost.monthlyVolume:0;
 const minimum=totalVar+fixedPerUnit;
 const targetRatio=Math.max(.15,Math.min(.5,activeCost.targetPct/100));
 const segmentFactor=activeCost.segment==="simple"?.85:activeCost.segment==="speciale"?1.2:1;
 const marketGuide=MARKET_FR_HT*segmentFactor;
 const targetMaterials=ingredients/targetRatio;
 const targetVariable=totalVar/0.55;
 const recommended=Math.ceil(Math.max(minimum*1.08,targetMaterials,targetVariable,marketGuide)*2)/2;
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
  if(!activeCost.name.trim()||!activeCost.lines.length||unknown.length||activeCost.lines.some(l=>!l.name.trim())){setError("Renseignez le nom, les ingrédients et chaque prix HT/kg (0 autorisé pour l'eau).");return;}
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
 const ready=unknown.length===0&&activeCost.lines.some(l=>l.grams>0)&&ingredients>0;
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
      <label>Emballage HT / pizza<PriceField value={packaging} onChange={v=>patch({packagingHt:v||0})}/></label>
      <label>Énergie HT / pizza<PriceField value={activeCost.energyHt} onChange={v=>patch({energyHt:v||0})}/></label>
      <label>Main-d'œuvre directe HT / pizza<PriceField value={activeCost.laborHt} onChange={v=>patch({laborHt:v||0})}/></label>
      <label>Autres variables HT / pizza<PriceField value={activeCost.otherHt} onChange={v=>patch({otherHt:v||0})}/></label>
    </div>
    <p className="epcMuted">Un prix vide signifie « non renseigné ». Saisissez 0 uniquement si le coût est réellement nul. Le calcul de la pâte inclut la farine.</p>
   </div>
   <div className="epcCard epcSummary">
    <label>Prix de vente actuel HT / pizza<PriceField value={activeCost.sellingHt} onChange={v=>patch({sellingHt:v||0})}/></label>
    <div className="epcMetrics">
      <div><span>Food cost matières HT</span><strong>{ready?money.format(ingredients):"Incomplet"}</strong></div>
      <div><span>Emballage HT</span><strong>{money.format(packaging)}</strong></div>
      <div><span>Total variable HT</span><strong>{ready?money.format(totalVar):"Incomplet"}</strong></div>
      <div><span>Marge brute HT (vente − matières − emballage)</span><strong>{ready&&gross!==null?money.format(gross):"—"}</strong></div>
      <div><span>Taux de marge brute</span><strong>{ready&&grossPct!==null?fmt.format(grossPct)+" %":"—"}</strong></div>
      <div><span>Food cost / prix HT</span><strong>{ready&&foodPct!==null?fmt.format(foodPct)+" %":"—"}</strong></div>
      <div><span>Marge contributive HT (après autres variables)</span><strong>{ready&&contribution!==null?money.format(contribution):"—"}</strong></div>
    </div>
    <div className="epcOther">
      <label>Charges fixes HT / mois (facultatif)<PriceField value={activeCost.monthlyFixedHt} onChange={v=>patch({monthlyFixedHt:v||0})}/></label>
      <label>Pizzas / mois prévues<PriceField unit="pcs" value={activeCost.monthlyVolume} onChange={v=>patch({monthlyVolume:v||0})}/></label>
    </div>
    <div className="epcFloor"><span>Prix plancher HT estimé / pizza</span>
      <strong>{ready?money.format(minimum):"—"}</strong>
      <small>Coûts variables + part des charges fixes, si volume mensuel renseigné. Sans bénéfice.</small>
    </div>
    <div className="epcAdvice">
      <label>Food cost cible <PriceField value={activeCost.targetPct} unit="%" onChange={v=>patch({targetPct:Math.min(50,Math.max(15,v||28))})}/></label>
      <label>Positionnement<select value={activeCost.segment} onChange={e=>patch({segment:e.target.value as Costing["segment"]})}>
        <option value="simple">Simple</option><option value="standard">Standard</option><option value="speciale">Spéciale / premium</option>
      </select></label>
      <button type="button" disabled={!ready} className="epcRecommend" onClick={()=>setAdvice(true)}>Conseiller un prix de vente HT</button>
      {advice&&ready?<div className="epcProposal" role="status">
        <small>PRIX CONSEILLÉ · HT</small><strong>{money.format(recommended)}</strong>
        <button type="button" onClick={()=>patch({sellingHt:recommended})}>Utiliser ce prix</button>
        <p>Calcul : coût matière cible {fmt.format(activeCost.targetPct)} %, couverture des coûts variables et repère national indicatif France.
        Moyenne Indice Pizza GIRA 2026 : {money.format(MARKET_FR_HT)} HT (conversion indicative du prix TTC de 13,24 € avec TVA 10 %).
        Ajustement par positionnement, non par relevé local. À vérifier face aux pizzerias voisines. Sources : <a href="https://www.giraconseil.fr/newsletter-no43" target="_blank" rel="noopener noreferrer">GIRA 2026</a> et <a href="https://www.metro.fr/conseil-service/conseil/rentabilite-restaurant" target="_blank" rel="noopener noreferrer">METRO (ratio matière)</a>.</p>
      </div>:null}
    </div>
    <button className="epcSave" type="button" disabled={busy||!ready} onClick={()=>void save()}>Enregistrer cette pizza</button>
    {saved.some(x=>x.cost.id===activeCost.id)?<button className="epcDelete" type="button" disabled={busy} onClick={()=>void remove()}>Supprimer la fiche</button>:null}
    <p className="epcMuted">La marge brute n'est pas un bénéfice net. Le prix proposé est un outil d'aide à la décision, pas une garantie de rentabilité.</p>
   </div>
  </div>
 </div>;
}