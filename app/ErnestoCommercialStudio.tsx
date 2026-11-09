"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Recipe } from "./recipeData";
import { calculateRecipe, recipeDefaults } from "./recipeMath";

type RecordRow = { id:string; kind:string; payload:Record<string,unknown>; updated_at:string };
type LedgerKind = "vente" | "depense";
type VatChoice = "" | "0" | "5.5" | "10" | "20";
type Ledger = {
  kind:LedgerKind; date:string; title:string; category:string;
  amountTtc:number; vatRate:VatChoice; payment:string; note:string;
};
type CostSettings = {
  recipeId:string; prices:Record<string,number>;
  sellingPriceTtc:number; vatRate:VatChoice;
  packagingPerUnit:number; energyPerUnit:number; laborPerUnit:number;
  otherPerUnit:number;
};
type Props = { open:boolean; onClose:()=>void; supabase:SupabaseClient; userId?:string; accessToken?:string };
const EUR=new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:2});
const N=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2});
const P=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1});
const NOW=()=>new Date().toLocaleDateString("en-CA");
const MONTH=()=>NOW().slice(0,7);
const VAT:VatChoice[]=["","0","5.5","10","20"];
const CHOICES=["Espèces","Carte","Virement","Autre"];
const CAT_IN=["Pizzas","Pains","Focaccias","Boissons","Autres ventes"];
const CAT_OUT=["Matières premières","Emballages","Énergie","Loyer","Matériel","Salaires","Transport","Autres charges"];
const safeText=(x:unknown,size=160)=>String(x??"").trim().slice(0,size);
const safeNumber=(x:unknown,cap=10000000)=>{
 const n=Number(x);return Number.isFinite(n)&&n>=0?Math.min(n,cap):0;
};
const parsedVat=(value:unknown):VatChoice => {
 const s=String(value??"");return VAT.includes(s as VatChoice)?s as VatChoice:"";
};
function parseLedger(row:RecordRow):Ledger{
 const x=row.payload;
 return {kind:x.kind==="depense"?"depense":"vente",date:safeText(x.date,10)||NOW(),
  title:safeText(x.title),category:safeText(x.category,70),amountTtc:safeNumber(x.amountTtc),
  vatRate:parsedVat(x.vatRate),payment:safeText(x.payment,30),note:safeText(x.note,500)};
}
function blankLedger(kind:LedgerKind="vente"):Ledger {
 return {kind,date:NOW(),title:"",category:kind==="vente"?CAT_IN[0]:CAT_OUT[0],
 amountTtc:0,vatRate:"",payment:"Carte",note:""};
}
function taxable(ttc:number,rate:VatChoice){
 if(rate==="")return null;
 const ht=ttc/(1+Number(rate)/100);
 return {ht,vat:ttc-ht};
}
function cleanCsv(v:string|number){
 const text=String(v).replace(/"/g,'""');
 const guarded=/^[\s]*[=+@\-\t\r]/.test(text)?"'"+text:text;
 return '"'+guarded+'"';
}
function CostNumber({value,onChange,unit="€",disabled=false}:{
 value:number;onChange:(n:number)=>void;unit?:string;disabled?:boolean
}){
 const display=(v:number)=>String(v).replace(".",",");
 const [raw,setRaw]=useState(display(value));
 useEffect(()=>setRaw(display(value)),[value]);
 function parse(s:string){
  if(!/^\d+(?:[.,]\d+)?$/.test(s))return null;
  const n=Number(s.replace(",","."));return Number.isFinite(n)&&n>=0&&n<=1000000?n:null;
 }
 return <span className="ecf-number"><input type="text" inputMode="decimal" disabled={disabled}
  value={raw} onChange={e=>{const next=e.target.value;if(!/^\d*(?:[.,]\d*)?$/.test(next))return;setRaw(next);const n=parse(next);if(n!==null)onChange(n);}}
  onBlur={()=>{const n=parse(raw);if(n===null)setRaw(display(value));else{setRaw(display(n));onChange(n);}}}/><small>{unit}</small></span>;
}
function VatSelect({value,onChange}:{value:VatChoice;onChange:(value:VatChoice)=>void}){
 return <select value={value} onChange={e=>onChange(e.target.value as VatChoice)}>
  <option value="">À préciser</option><option value="0">0 %</option>
  <option value="5.5">5,5 %</option><option value="10">10 %</option><option value="20">20 %</option>
 </select>;
}
export default function ErnestoCommercialStudio({open,onClose,supabase,userId,accessToken}:Props){
 const [tab,setTab]=useState<"cost"|"journal">("cost");
 const [rows,setRows]=useState<RecordRow[]>([]);
 const [recipes,setRecipes]=useState<Recipe[]>([]);
 const [recipeLoading,setRecipeLoading]=useState(false);
 const [loading,setLoading]=useState(false);
 const [working,setWorking]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [refresh,setRefresh]=useState(0);
 const [recipeId,setRecipeId]=useState("classique-j1");
 const [cost,setCost]=useState<CostSettings>({
   recipeId:"classique-j1",prices:{},sellingPriceTtc:0,vatRate:"",
   packagingPerUnit:0,energyPerUnit:0,laborPerUnit:0,otherPerUnit:0
 });
 const [month,setMonth]=useState(MONTH);
 const [ledger,setLedger]=useState<Ledger>(blankLedger());
 const [editingId,setEditingId]=useState<string|null>(null);
 const [showForm,setShowForm]=useState(false);
 const closeRef=useRef<HTMLButtonElement>(null);
 const latest=useRef("");
 const costs=useMemo(()=>rows.filter(r=>r.kind==="costing"),[rows]);
 const entries=useMemo(()=>rows.filter(r=>r.kind==="transaction"),[rows]);
 const recipe=recipes.find(r=>r.id===recipeId)||recipes[0];
 const calc=useMemo(()=>recipe?calculateRecipe(recipe,recipeDefaults(recipe)):null,[recipe]);
 const recorded=useMemo(()=>{
  const saved=costs.find(r=>safeText(r.payload.recipeId)===recipeId)?.payload;
  if(!saved)return null;
  const prices:Record<string,number>={};
  if(saved.prices&&typeof saved.prices==="object"){
   for(const [k,v] of Object.entries(saved.prices as Record<string,unknown>))prices[k]=safeNumber(v,100000);
  }
  return {recipeId,prices,sellingPriceTtc:safeNumber(saved.sellingPriceTtc),vatRate:parsedVat(saved.vatRate),
   packagingPerUnit:safeNumber(saved.packagingPerUnit),energyPerUnit:safeNumber(saved.energyPerUnit),
   laborPerUnit:safeNumber(saved.laborPerUnit),otherPerUnit:safeNumber(saved.otherPerUnit)} as CostSettings;
 },[costs,recipeId]);
 useEffect(()=>{
  if(recorded)setCost(recorded);
  else setCost({recipeId,prices:{},sellingPriceTtc:0,vatRate:"",
   packagingPerUnit:0,energyPerUnit:0,laborPerUnit:0,otherPerUnit:0});
 },[recorded,recipeId]);

 useEffect(()=>{
  if(!open||!userId||!accessToken)return;
  let cancelled=false;
  setLoading(true);setError("");
  void supabase.from("ernesto_activity_records")
   .select("id,kind,payload,updated_at")
   .eq("user_id",userId).in("kind",["costing","transaction"])
   .order("updated_at",{ascending:false}).limit(1000)
   .then(({data,error})=>{
    if(cancelled)return;
    if(error)setError("Impossible de récupérer le carnet commercial.");
    else setRows((data||[]) as RecordRow[]);
   }).then(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;};
 },[open,userId,accessToken,supabase,refresh]);
 useEffect(()=>{
  if(!open||!accessToken||recipes.length===19)return;
  let cancelled=false;
  setRecipeLoading(true);
  void fetch("/api/recettes",{headers:{Authorization:"Bearer "+accessToken},cache:"no-store"})
   .then(async r=>{if(!r.ok)throw Error("Catalogue inaccessible");return r.json();})
   .then(d=>{if(!cancelled&&Array.isArray(d.recipes))setRecipes(d.recipes);})
   .catch(()=>{if(!cancelled)setError("Le carnet des recettes est momentanément indisponible.")})
   .finally(()=>{if(!cancelled)setRecipeLoading(false)});
  return ()=>{cancelled=true;};
 },[open,accessToken,recipes.length]);
 useEffect(()=>{
  if(!open)return;
  const focus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const old=document.body.style.overflow;
  document.body.style.overflow="hidden";
  const esc=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
  document.addEventListener("keydown",esc);
  const timer=window.setTimeout(()=>closeRef.current?.focus(),50);
  return ()=>{document.body.style.overflow=old;document.removeEventListener("keydown",esc);window.clearTimeout(timer);focus?.focus();};
 },[open,onClose]);

 const totals=useMemo(()=>{
  const relevant=entries.map(r=>parseLedger(r)).filter(v=>v.date.startsWith(month));
  const incomes=relevant.filter(x=>x.kind==="vente").reduce((v,x)=>v+x.amountTtc,0);
  const outgoings=relevant.filter(x=>x.kind==="depense").reduce((v,x)=>v+x.amountTtc,0);
  const withVat=relevant.filter(x=>x.vatRate!=="");
  const taxCollected=withVat.filter(x=>x.kind==="vente").reduce((v,x)=>v+(taxable(x.amountTtc,x.vatRate)?.vat||0),0);
  const taxPaid=withVat.filter(x=>x.kind==="depense").reduce((v,x)=>v+(taxable(x.amountTtc,x.vatRate)?.vat||0),0);
  return {relevant,incomes,outgoings,balance:incomes-outgoings,taxCollected,taxPaid,
   vatUnknown:relevant.filter(x=>x.vatRate==="").length};
 },[entries,month]);
 const formulaPrices=cost.prices;
 const ingredients=calc?.quantities||[];
 const subtotal=ingredients.reduce((sum,i)=>sum+i.grams/1000*(formulaPrices[i.key]||0),0);
 const isTray=recipe?.mode==="plaques";
 const units=calc?(isTray?calc.trays:calc.pieces):1;
 const ingredientPerUnit=units>0?subtotal/units:0;
 const extra=cost.packagingPerUnit+cost.energyPerUnit+cost.laborPerUnit+cost.otherPerUnit;
 const totalPerUnit=ingredientPerUnit+extra;
 const selling=taxable(cost.sellingPriceTtc,cost.vatRate);
 const margin=selling?selling.ht-totalPerUnit:null;
 const marginRate=margin!==null&&selling&&selling.ht>0?margin/selling.ht*100:null;
 const costRate=selling&&selling.ht>0?totalPerUnit/selling.ht*100:null;

 if(!open)return null;

 function patchCost(next:Partial<CostSettings>){setCost(p=>({...p,...next}));setNotice("");}
 async function storeCost(){
  if(!userId||!recipe)return;
  setWorking(true);setError("");setNotice("");
  try{
   const existing=costs.find(r=>safeText(r.payload.recipeId)===recipeId);
   const body={...cost,recipeId,prices:Object.fromEntries(Object.entries(cost.prices).map(([k,v])=>[k,safeNumber(v,100000)]))};
   const query=supabase.from("ernesto_activity_records");
   const {error}=existing?
     await query.update({payload:body,updated_at:new Date().toISOString()}).eq("id",existing.id).eq("user_id",userId):
     await query.insert({user_id:userId,kind:"costing",payload:body});
   if(error)throw Error(error.message);
   setRefresh(n=>n+1);setNotice("Calcul sauvegardé dans votre compte.");
  }catch(e){setError(e instanceof Error?e.message:"Sauvegarde impossible.");}
  finally{setWorking(false);}
 }
 async function storeLedger(e:React.FormEvent){
  e.preventDefault();
  if(!userId||!ledger.title.trim()||ledger.amountTtc<=0||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(ledger.date)){
   setError("Complétez la date, le libellé et un montant TTC positif.");return;
  }
  setWorking(true);setError("");setNotice("");
  try{
   const payload={...ledger,title:safeText(ledger.title,160),note:safeText(ledger.note,500),
    amountTtc:safeNumber(ledger.amountTtc)};
   const query=supabase.from("ernesto_activity_records");
   const {error}=editingId?
    await query.update({payload,updated_at:new Date().toISOString()}).eq("id",editingId).eq("user_id",userId):
    await query.insert({user_id:userId,kind:"transaction",payload});
   if(error)throw Error(error.message);
   setEditingId(null);setLedger(blankLedger());setShowForm(false);setRefresh(n=>n+1);setNotice("Opération enregistrée.");
  }catch(e){setError(e instanceof Error?e.message:"Enregistrement impossible.");}
  finally{setWorking(false);}
 }
 async function removeRow(id:string){
  if(!userId||!window.confirm("Supprimer cette opération ?"))return;
  setWorking(true);setError("");
  const {error}=await supabase.from("ernesto_activity_records").delete().eq("id",id).eq("user_id",userId);
  if(error)setError("Suppression impossible.");else{setRefresh(n=>n+1);setNotice("Opération supprimée.");}
  setWorking(false);
 }
 function exportCsv(){
  const records=entries.map(r=>parseLedger(r)).filter(v=>v.date.startsWith(month))
   .sort((a,b)=>a.date.localeCompare(b.date));
  const lines=[
   ["Date","Type","Catégorie","Libellé","Montant TTC EUR","TVA %","Montant HT EUR","TVA EUR","Règlement","Note"].map(cleanCsv).join(";"),
   ...records.map(r=>{
    const t=taxable(r.amountTtc,r.vatRate);
    return [r.date,r.kind,r.category,r.title,r.amountTtc.toFixed(2).replace(".",","),
      r.vatRate===""?"":r.vatRate,t?t.ht.toFixed(2).replace(".",","):"",
      t?t.vat.toFixed(2).replace(".",","):"",r.payment,r.note].map(cleanCsv).join(";");
   })
  ];
  const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download="ernesto-journal-"+month+".csv";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),500);
 }
 function editRow(row:RecordRow){setLedger(parseLedger(row));setEditingId(row.id);setShowForm(true);}
 function newRow(kind:LedgerKind){setLedger(blankLedger(kind));setEditingId(null);setShowForm(true);setError("");}

 return <div className="ecf-layer" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section className="ecf-shell" role="dialog" aria-modal="true" aria-labelledby="ecf-title">
   <header className="ecf-head"><div className="ecf-monogram" aria-hidden="true">E</div><div>
    <small>ERNESTO / OUTILS PROFESSIONNELS</small><h2 id="ecf-title">Commercial</h2>
    </div><button type="button" className="ecf-close" ref={closeRef} onClick={onClose}>Retour à Ernesto <span aria-hidden="true">×</span></button>
   </header>
   <div className="ecf-tabs" role="tablist" aria-label="Commercial">
    <button type="button" role="tab" aria-selected={tab==="cost"} className={tab==="cost"?"active":""}
     onClick={()=>setTab("cost")}>Coût & marge</button>
    <button type="button" role="tab" aria-selected={tab==="journal"} className={tab==="journal"?"active":""}
     onClick={()=>setTab("journal")}>Journal des ventes & dépenses</button>
   </div>
   <div className="ecf-content">
    {error?<div className="ecf-error" role="alert">{error}</div>:null}
    {notice?<div className="ecf-ok" role="status">{notice}</div>:null}
    {loading?<div className="ecf-muted">Chargement de vos données…</div>:null}
    {tab==="cost" ? <>
      <div className="ecf-sectionTitle"><small>01 / RENTABILITÉ</small><h3>Combien me rapporte chaque vente ?</h3>
       <p>Choisissez une fiche EPPPN, puis saisissez vos prix d’achat réels. Les grammes viennent directement du carnet des recettes.</p>
      </div>
      <div className="ecf-costGrid">
       <section className="ecf-card">
        <label className="ecf-field"><span>Recette EPPPN</span><select value={recipeId} onChange={e=>setRecipeId(e.target.value)}>
          {recipes.map(r=><option value={r.id} key={r.id}>{r.name} · {r.subtitle}</option>)}</select></label>
        {!recipe? <p className="ecf-muted">{recipeLoading?"Chargement des recettes…":"Recettes indisponibles."}</p> :
        <><p className="ecf-batch">Formule originale · {isTray?calc?.trays+" plaque":calc?.pieces+" pâtons"} · {N.format(calc?.dough||0)} g de pâte</p>
         <div className="ecf-priceHead"><span>Ingrédient</span><span>Dans la formule</span><span>Prix d'achat HT / kg</span></div>
         {ingredients.map(i=><div key={i.key} className="ecf-ingredientRow">
          <span>{i.label}</span><small>{N.format(i.grams)} g</small>
          <CostNumber value={cost.prices[i.key]||0} unit="€/kg" onChange={v=>patchCost({prices:{...formulaPrices,[i.key]:v}})}/>
         </div>)}
        </>}
        <p className="ecf-hint">Prix en € HT/kg, eau et produits compris. Une valeur à 0 € signifie « non chiffré » : le résultat sous-estime alors le coût réel.</p>
        <div className="ecf-inputColumns">
         {([["packagingPerUnit","Emballage"],["energyPerUnit","Énergie"],["laborPerUnit","Main-d’œuvre directe"],["otherPerUnit","Autres coûts variables"]] as [keyof CostSettings,string][]).map(([k,label])=>
          <label className="ecf-field" key={k}><span>{label} · €/unité</span>
           <CostNumber value={Number(cost[k])||0} onChange={v=>patchCost({[k]:v})}/></label>
         )}
        </div>
       </section>
       <section className="ecf-card ecf-result">
        <div className="ecf-blockLabel">VOTRE PRIX DE VENTE</div>
        <label className="ecf-field"><span>Prix affiché TTC / {isTray?"plaque":"pizza ou pain"}</span>
         <CostNumber value={cost.sellingPriceTtc} onChange={v=>patchCost({sellingPriceTtc:v})}/></label>
        <label className="ecf-field"><span>TVA applicable au produit (à vérifier)</span><VatSelect value={cost.vatRate} onChange={v=>patchCost({vatRate:v})}/></label>
        <div className="ecf-kpis">
         <div><small>Coût matières / unité</small><strong>{EUR.format(ingredientPerUnit)}</strong></div>
         <div><small>Coût variable estimé / unité</small><strong>{EUR.format(totalPerUnit)}</strong></div>
         <div><small>Marge sur coûts variables / unité</small>
          <strong className={margin!==null&&margin<0?"negative":""}>{margin===null?"TVA à préciser":EUR.format(margin)}</strong></div>
         <div><small>Taux de marge sur prix HT</small><strong>{marginRate===null?"—":P.format(marginRate)+" %"}</strong></div>
        </div>
        <div className="ecf-marginBar" aria-hidden="true"><span style={{width:(costRate===null?0:Math.min(100,Math.max(0,costRate)))+"%"}}/></div>
        <p className="ecf-hint">Marge = prix de vente HT − coût variable estimé. Ce n'est <strong>pas</strong> le bénéfice net : loyer, cotisations, charges fixes, amortissements et fiscalité restent à traiter séparément.</p>
        <button type="button" className="ecf-primary" disabled={working||!recipe} onClick={()=>void storeCost()}>Enregistrer ce calcul</button>
       </section>
      </div>
    </> : <>
     <div className="ecf-sectionTitle"><small>02 / JOURNAL SIMPLIFIÉ</small><h3>Suivre les entrées et les sorties</h3>
      <p>Une opération en quelques secondes. Les montants sont TTC ; l'export CSV peut être transmis au comptable.</p></div>
     <div className="ecf-journalBar"><label>Choisir le mois <input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
       <div><button type="button" onClick={()=>newRow("vente")}>+ Encaissement</button>
       <button type="button" onClick={()=>newRow("depense")}>+ Dépense</button></div>
     </div>
     <div className="ecf-ledgerTotals">
      <div><small>VENTES ENCAISSÉES TTC</small><strong>{EUR.format(totals.incomes)}</strong></div>
      <div><small>DÉCAISSEMENTS TTC</small><strong>{EUR.format(totals.outgoings)}</strong></div>
      <div><small>SOLDE ENREGISTRÉ TTC</small><strong>{EUR.format(totals.balance)}</strong></div>
     </div>
     {showForm?<form className="ecf-form" onSubmit={e=>void storeLedger(e)}>
      <div className="ecf-formTitle"><strong>{editingId?"Modifier l'opération":"Nouvelle opération"}</strong>
       <button type="button" onClick={()=>setShowForm(false)} aria-label="Fermer la saisie">×</button></div>
      <div className="ecf-formGrid">
       <label className="ecf-field"><span>Type</span><select value={ledger.kind} onChange={e=>{
         const kind=e.target.value as LedgerKind;setLedger(p=>({...p,kind,category:kind==="vente"?CAT_IN[0]:CAT_OUT[0]}));}}>
        <option value="vente">Encaissement</option><option value="depense">Dépense</option></select></label>
       <label className="ecf-field"><span>Date</span><input type="date" required value={ledger.date} onChange={e=>setLedger(p=>({...p,date:e.target.value}))}/></label>
       <label className="ecf-field"><span>Libellé</span><input required maxLength={160} value={ledger.title}
        placeholder="Ex. Service du samedi, commande farine…" onChange={e=>setLedger(p=>({...p,title:e.target.value}))}/></label>
       <label className="ecf-field"><span>Catégorie</span><select value={ledger.category} onChange={e=>setLedger(p=>({...p,category:e.target.value}))}>
         {(ledger.kind==="vente"?CAT_IN:CAT_OUT).map(v=><option key={v}>{v}</option>)}</select></label>
       <label className="ecf-field"><span>Montant TTC</span><CostNumber value={ledger.amountTtc} onChange={v=>setLedger(p=>({...p,amountTtc:v}))}/></label>
       <label className="ecf-field"><span>TVA de l'opération</span><VatSelect value={ledger.vatRate} onChange={v=>setLedger(p=>({...p,vatRate:v}))}/></label>
       <label className="ecf-field"><span>Mode de règlement</span><select value={ledger.payment} onChange={e=>setLedger(p=>({...p,payment:e.target.value}))}>
        {CHOICES.map(x=><option key={x}>{x}</option>)}</select></label>
       <label className="ecf-field"><span>Note facultative</span><input maxLength={500} value={ledger.note} onChange={e=>setLedger(p=>({...p,note:e.target.value}))}/></label>
      </div>
      <div className="ecf-formActions"><button type="submit" className="ecf-primary" disabled={working}>Enregistrer</button>
        <button type="button" onClick={()=>setShowForm(false)}>Annuler</button></div>
     </form>:null}
     <div className="ecf-rowsHead"><strong>{totals.relevant.length} opérations · {month}</strong>
      <button type="button" disabled={!totals.relevant.length} onClick={exportCsv}>Exporter CSV</button></div>
     <div className="ecf-ledgerList">
       {entries.filter(r=>parseLedger(r).date.startsWith(month))
        .sort((a,b)=>parseLedger(b).date.localeCompare(parseLedger(a).date))
        .map(row=>{const entry=parseLedger(row);return <div className="ecf-ledgerRow" key={row.id}>
          <span className="ecf-date">{entry.date.slice(8,10)}/{entry.date.slice(5,7)}</span>
          <div><strong>{entry.title}</strong><small>{entry.category} · {entry.payment}{entry.vatRate===""?" · TVA non précisée":""}</small></div>
          <strong className={entry.kind==="depense"?"negative":"positive"}>{entry.kind==="depense"?"−":"+"}{EUR.format(entry.amountTtc)}</strong>
          <div className="ecf-actions"><button type="button" onClick={()=>editRow(row)}>Modifier</button>
           <button type="button" onClick={()=>void removeRow(row.id)} aria-label="Supprimer" disabled={working}>×</button></div>
         </div>;})}
       {!totals.relevant.length?<div className="ecf-empty">Aucune opération sur ce mois. Ajoutez votre première vente ou dépense.</div>:null}
     </div>
     <p className="ecf-hint ecf-bottomHint">Journal de trésorerie simplifié, non une comptabilité certifiée. Les sommes ne sont pas rapprochées des factures ni des comptes bancaires. La TVA n'est calculée que si un taux a été explicitement choisi.</p>
    </>}
   </div>
  </section>
 </div>;
}
