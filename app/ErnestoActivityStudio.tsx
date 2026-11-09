"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Category = "supplier" | "stock" | "profile";
type Section = "overview" | "suppliers" | "stock" | "opening";
type ActivityKind = "pizzeria" | "ambulant" | "boulangerie" | "atelier" | "evenementiel";
type Row = { id:string; user_id:string; kind:Category; payload:Record<string,unknown>; created_at:string; updated_at:string };
type Supplier = { name:string; speciality:string; contact:string; phone:string; email:string; notes:string };
type Stock = {
  name:string; quantity:number; unit:"kg"|"L"|"pièce"; minimum:number;
  expiry:string; dateType:"DLC"|"DDM"|"Aucune"; lot:string; storage:string;
  supplierId:string; price:number; notes:string;
};
type Props = { open:boolean; onClose:()=>void; accountId?:string; supabase:SupabaseClient };

const ACTIVITY_LABELS:Record<ActivityKind,string> = {
  pizzeria:"Pizzeria", ambulant:"Camion / ambulant", boulangerie:"Panification",
  atelier:"Atelier / laboratoire", evenementiel:"Événementiel",
};
const SUPPLIER_EMPTY:Supplier={name:"",speciality:"Farines",contact:"",phone:"",email:"",notes:""};
const STOCK_EMPTY:Stock={name:"",quantity:0,unit:"kg",minimum:0,expiry:"",dateType:"DLC",lot:"",storage:"Sec",supplierId:"",price:0,notes:""};
const fmt=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2});
const money=new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:2});

function txt(value:unknown,max=300){return String(value??"").trim().slice(0,max);}
function n(value:unknown,max=1000000){const x=Number(value);return Number.isFinite(x)&&x>=0?Math.min(max,x):0;}
function supplierOf(row:Row):Supplier{
 const p=row.payload;
 return {name:txt(p.name,120),speciality:txt(p.speciality,80),contact:txt(p.contact,120),
 phone:txt(p.phone,60),email:txt(p.email,140),notes:txt(p.notes,500)};
}
function stockOf(row:Row):Stock{
 const p=row.payload;
 return {name:txt(p.name,120),quantity:n(p.quantity),unit:p.unit==="L"?"L":p.unit==="pièce"?"pièce":"kg",
 minimum:n(p.minimum),expiry:txt(p.expiry,10),dateType:p.dateType==="DDM"?"DDM":p.dateType==="Aucune"?"Aucune":"DLC",
 lot:txt(p.lot,100),storage:txt(p.storage,80)||"Sec",supplierId:txt(p.supplierId,100),
 price:n(p.price),notes:txt(p.notes,500)};
}
function dateDiff(date:string) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const [y,m,d]=date.split("-").map(Number);
 const target=Date.UTC(y,m-1,d);
 const current=new Date();
 const today=Date.UTC(current.getFullYear(),current.getMonth(),current.getDate());
 return Math.round((target-today)/86400000);
}
function stockWarnings(s:Stock) {
 const days=s.dateType!=="Aucune"&&s.expiry?dateDiff(s.expiry):null;
 const low=s.quantity<=s.minimum;
 const expiry=days!==null&&days<0;
 const approaching=days!==null&&days>=0&&days<=7;
 return {low,expiry,approaching,days};
}

type CheckItem={id:string;label:string;detail:string;url?:string};
const COMMON_CHECKS:CheckItem[]=[
 {id:"hygiene",label:"Hygiène et plan de maîtrise sanitaire",
  detail:"Vérifier les procédures adaptées au lieu, à l'équipe et aux produits : nettoyage, températures, traçabilité, allergènes et formation.",
  url:"https://agriculture.gouv.fr/la-securite-sanitaire-de-lalimentation-que-controle-t-dans-un-restaurant"},
 {id:"denrees",label:"Déclaration liée aux denrées d'origine animale",
  detail:"Examiner la déclaration applicable lorsque l'activité manipule notamment fromages, produits laitiers ou œufs.",
  url:"https://entreprendre.service-public.gouv.fr/vosdroits/F33822"},
 {id:"fournisseurs",label:"Référencer les fournisseurs et matières premières",
  detail:"Documenter produits, conditions d'approvisionnement, lots, allergènes et possibilités de remplacement."},
 {id:"budget",label:"Calculer les coûts de revient et le prix de vente",
  detail:"Intégrer matières, emballages, énergie, personnel, pertes, taxes et volume d'activité."}
];
const ACTIVITY_CHECKS:Record<ActivityKind,CheckItem[]>={
 pizzeria:[
  {id:"restaurant",label:"Vérifier les démarches d'ouverture d'un restaurant",
   detail:"Statut, local, sécurité, hygiène et obligations selon la vente sur place ou à emporter.",
   url:"https://entreprendre.service-public.gouv.fr/vosdroits/F33794"}
 ],
 ambulant:[
  {id:"ambulant",label:"Carte et statut du commerce ambulant",
   detail:"Vérifier les exigences de carte ambulante et les éventuelles exceptions selon le lieu d'exercice.",
   url:"https://entreprendre.service-public.gouv.fr/vosdroits/F21856"},
  {id:"occupation",label:"Emplacements, marchés et autorisations (AOT)",
   detail:"Chaque lieu peut impliquer une autorisation spécifique, un droit de place ou une convention.",
   url:"https://entreprendre.service-public.gouv.fr/vosdroits/F10003"},
  {id:"foodtruck",label:"Démarches spécifiques à la restauration ambulante",
   detail:"Contrôler les règles propres au véhicule, à l'énergie, à l'eau, à l'hygiène et à l'installation.",
   url:"https://entreprendre.service-public.gouv.fr/vosdroits/F36831"}
 ],
 boulangerie:[
  {id:"boulangerie",label:"Conditions d'exercice et d'appellation",
   detail:"Vérifier les qualifications, la fabrication sur place et les règles applicables à l'appellation « boulangerie ».",
   url:"https://entreprendre.service-public.gouv.fr/vosdroits/F38497"}
 ],
 atelier:[
  {id:"atelier",label:"Définir les clients et le périmètre de production",
   detail:"Vérifier les règles adaptées à la fabrication, au stockage et à la vente directe ou à d'autres professionnels.",
   url:"https://entreprendre.service-public.gouv.fr/vosdroits/F33822"}
 ],
 evenementiel:[
  {id:"evenements",label:"Vérifier les autorisations pour chaque événement",
   detail:"Marché, foire, festival, espace privé : vérifier occupation, accès, puissance électrique et obligations sanitaires.",
   url:"https://entreprendre.service-public.gouv.fr/vosdroits/F21856"}
 ]
};

function TextField({label,value,onChange,placeholder,type="text"}:{
 label:string;value:string;onChange:(v:string)=>void;placeholder?:string;type?:string;
}) {
 return <label className="eas-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} /></label>;
}
function NumberField({label,value,onChange,min=0,suffix}:{
 label:string;value:number;onChange:(v:number)=>void;min?:number;step?:string;suffix?:string;
}) {
 const display=(x:number)=>String(x).replace(".",",");
 const [draft,setDraft]=useState(display(value));
 useEffect(()=>setDraft(display(value)),[value]);
 function parse(raw:string){
  const text=raw.trim().replace(",",".");
  if(!/^\d+(?:\.\d+)?$/.test(text))return null;
  const x=Number(text);
  return Number.isFinite(x)&&x>=min&&x<=1000000?x:null;
 }
 return <label className="eas-field"><span>{label}</span><div className="eas-number">
  <input type="text" inputMode="decimal" value={draft} onChange={e=>{
    const raw=e.currentTarget.value;
    if(!/^\d*(?:[.,]\d*)?$/.test(raw))return;
    setDraft(raw);
    const next=parse(raw);
    if(next!==null && next!==value)onChange(next);
  }} onBlur={()=>{
    const next=parse(draft);
    if(next===null)setDraft(display(value));
    else {setDraft(display(next));if(next!==value)onChange(next);}
  }} />{suffix?<small>{suffix}</small>:null}</div></label>;
}

export default function ErnestoActivityStudio({open,onClose,accountId,supabase}:Props){
 const [section,setSection]=useState<Section>("stock");
 const [records,setRecords]=useState<Row[]>([]);
 const [loading,setLoading]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const [refresh,setRefresh]=useState(0);
 const [kind,setKind]=useState<ActivityKind>("pizzeria");
 const [checks,setChecks]=useState<string[]>([]);
 const [supplier,setSupplier]=useState<Supplier>(SUPPLIER_EMPTY);
 const [stock,setStock]=useState<Stock>(STOCK_EMPTY);
 const [editingId,setEditingId]=useState<string|null>(null);
 const [showForm,setShowForm]=useState(false);
 const closeRef=useRef<HTMLButtonElement>(null);

 useEffect(()=>{
  if(!open||!accountId)return;
  let cancelled=false;
  setLoading(true);setError("");setSuccess("");setRecords([]);
  void supabase.from("ernesto_activity_records")
   .select("id,user_id,kind,payload,created_at,updated_at")
   .eq("user_id",accountId).order("updated_at",{ascending:false}).limit(400)
   .then(({data,error})=>{
     if(cancelled)return;
     if(error){setError("Impossible de charger vos données. "+error.message);return;}
     const next=(data||[]) as Row[];
     setRecords(next);
     const p=next.find(r=>r.kind==="profile")?.payload;
     const k=String(p?.businessType||"pizzeria");
     setKind(k in ACTIVITY_LABELS ? k as ActivityKind : "pizzeria");
     setChecks(Array.isArray(p?.completed)?p.completed.filter((x:unknown)=>typeof x==="string"):[]);
   })
   .then(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;};
 },[open,accountId,supabase,refresh]);

 useEffect(()=>{
  if(!open)return;
  const focused=document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const previous=document.body.style.overflow;
  document.body.style.overflow="hidden";
  const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
  document.addEventListener("keydown",onKey);
  const timer=window.setTimeout(()=>closeRef.current?.focus(),40);
  return ()=>{document.body.style.overflow=previous;document.removeEventListener("keydown",onKey);window.clearTimeout(timer);focused?.focus();};
 },[open,onClose]);

 const suppliers=useMemo(()=>records.filter(r=>r.kind==="supplier"),[records]);
 const stocks=useMemo(()=>records.filter(r=>r.kind==="stock"),[records]);
 const stockAlerts=useMemo(()=>stocks.map(row=>({row,stock:stockOf(row)}))
   .filter(x=>{const w=stockWarnings(x.stock);return w.low||w.expiry||w.approaching;}),[stocks]);
 const stockValue=useMemo(()=>stocks.reduce((sum,r)=>{
  const s=stockOf(r);return sum+s.quantity*s.price;
 },0),[stocks]);
 const checklist=[...COMMON_CHECKS,...ACTIVITY_CHECKS[kind]];
 const doneCount=checklist.filter(i=>checks.includes(i.id)).length;

 if(!open)return null;

 async function save(kindValue:Category,payload:Record<string,unknown>,id:string|null=null){
  if(!accountId)throw new Error("Session requise");
  const query=supabase.from("ernesto_activity_records");
  const result=id
   ? await query.update({payload,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",accountId).select("id").single()
   : await query.insert({user_id:accountId,kind:kindValue,payload}).select("id").single();
  if(result.error)throw new Error(result.error.message);
  setRefresh(v=>v+1);
 }

 async function saveProfile(nextKind:ActivityKind,nextChecks:string[]){
  setKind(nextKind);setChecks(nextChecks);
  try{
   const profile=records.find(r=>r.kind==="profile");
   await save("profile",{businessType:nextKind,completed:nextChecks},profile?.id||null);
  }catch(e){setError(e instanceof Error?e.message:"Enregistrement impossible.");}
 }

 function switchTab(tab:Section){
  setSection(tab);setShowForm(false);setEditingId(null);setError("");setSuccess("");
 }

 async function submitSupplier(e:React.FormEvent) {
  e.preventDefault();
  if(!supplier.name.trim()){setError("Indiquez le nom du fournisseur.");return;}
  setSaving(true);setError("");
  try{
   await save("supplier",Object.fromEntries(Object.entries(supplier).map(([k,v])=>[k,txt(v,500)])),editingId);
   setSupplier(SUPPLIER_EMPTY);setEditingId(null);setShowForm(false);setSuccess("Fournisseur enregistré.");
  }catch(e){setError(e instanceof Error?e.message:"Enregistrement impossible.");}
  finally{setSaving(false);}
 }
 async function submitStock(e:React.FormEvent) {
  e.preventDefault();
  if(!stock.name.trim()){setError("Indiquez le nom du produit.");return;}
  setSaving(true);setError("");
  try{
   await save("stock",{
    ...stock,name:txt(stock.name,120),quantity:n(stock.quantity),minimum:n(stock.minimum),
    price:n(stock.price),lot:txt(stock.lot,100),notes:txt(stock.notes,500),
   },editingId);
   setStock(STOCK_EMPTY);setEditingId(null);setShowForm(false);setSuccess("Stock enregistré.");
  }catch(e){setError(e instanceof Error?e.message:"Enregistrement impossible.");}
  finally{setSaving(false);}
 }
 async function removeRecord(record:Row){
  if(!accountId||!window.confirm("Supprimer définitivement cet élément de votre carnet professionnel ?"))return;
  setSaving(true);setError("");
  try{
   const {error}=await supabase.from("ernesto_activity_records").delete().eq("id",record.id).eq("user_id",accountId);
   if(error)throw new Error(error.message);
   setRefresh(v=>v+1);setSuccess("Élément supprimé.");
  }catch(e){setError(e instanceof Error?e.message:"Suppression impossible.");}
  finally{setSaving(false);}
 }
 function editSupplier(row:Row){setSupplier(supplierOf(row));setEditingId(row.id);setShowForm(true);setSection("suppliers");}
 function editStock(row:Row){setStock(stockOf(row));setEditingId(row.id);setShowForm(true);setSection("stock");}
 function newSupplier(){setSupplier(SUPPLIER_EMPTY);setEditingId(null);setShowForm(true);setSection("suppliers");setError("");}
 function newStock(){setStock(STOCK_EMPTY);setEditingId(null);setShowForm(true);setSection("stock");setError("");}

 return <div className="eas-layer" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section className="eas-shell" role="dialog" aria-modal="true" aria-labelledby="eas-title">
   <header className="eas-header">
    <div className="eas-logo" aria-hidden="true">E</div>
    <div className="eas-heading"><span>ERNESTO / VOTRE ATELIER</span><h2 id="eas-title">Stocks</h2></div>
    <span className="eas-subheading">Matières et fournisseurs</span>
    <button ref={closeRef} className="eas-close" type="button" onClick={onClose}>Retour à Ernesto <span aria-hidden="true">×</span></button>
   </header>

   <div className="eas-tabs" role="tablist" aria-label="Gestion des stocks">
    {([["stock","Mes stocks"],["suppliers","Fournisseurs"]] as [Section,string][]).map(([id,label])=>
     <button key={id} role="tab" aria-selected={section===id} className={section===id?"active":""}
      type="button" onClick={()=>switchTab(id)}>{label}</button>)}
   </div>

   <div className="eas-body">
    {error?<div className="eas-error" role="alert">{error}</div>:null}
    {success?<div className="eas-success" role="status">{success}</div>:null}
    {loading?<div className="eas-loading">Chargement de vos données professionnelles…</div>:null}

    {!loading && section==="suppliers" ? <>
     <div className="eas-sectionTitle"><div><span>01 / PARTENAIRES</span><h3>Mes fournisseurs</h3><p>Farines, levains, mozzarella, légumes, emballages, matériel…</p></div>
      <button type="button" className="eas-primary" onClick={newSupplier}>+ Ajouter</button></div>
     {showForm?<form className="eas-form" onSubmit={e=>void submitSupplier(e)}>
      <h4>{editingId?"Modifier le fournisseur":"Nouveau fournisseur"}</h4>
      <div className="eas-formGrid">
       <TextField label="Nom *" value={supplier.name} onChange={v=>setSupplier(p=>({...p,name:v}))} placeholder="Nom de l'entreprise"/>
       <label className="eas-field"><span>Catégorie</span><select value={supplier.speciality} onChange={e=>setSupplier(p=>({...p,speciality:e.target.value}))}>
        {["Farines","Produits frais","Fromages","Légumes","Emballages","Équipement","Logistique","Autre"].map(v=><option key={v}>{v}</option>)}</select></label>
       <TextField label="Contact" value={supplier.contact} onChange={v=>setSupplier(p=>({...p,contact:v}))}/>
       <TextField label="Téléphone" type="tel" value={supplier.phone} onChange={v=>setSupplier(p=>({...p,phone:v}))}/>
       <TextField label="E-mail" type="email" value={supplier.email} onChange={v=>setSupplier(p=>({...p,email:v}))}/>
       <TextField label="Notes / conditions" value={supplier.notes} onChange={v=>setSupplier(p=>({...p,notes:v}))} placeholder="Délais, minimum de commande…"/>
      </div>
      <div className="eas-formActions"><button type="submit" className="eas-primary" disabled={saving}>Enregistrer</button><button type="button" onClick={()=>setShowForm(false)}>Annuler</button></div>
     </form>:null}
     <div className="eas-cardList">{suppliers.map(row=>{const p=supplierOf(row);return <article className="eas-card" key={row.id}>
      <div><span>{p.speciality||"Fournisseur"}</span><h4>{p.name}</h4><p>{[p.contact,p.phone,p.email].filter(Boolean).join(" · ")||"Contact à renseigner"}</p>
       {p.notes?<small>{p.notes}</small>:null}</div>
      <div className="eas-cardActions"><button onClick={()=>editSupplier(row)}>Modifier</button><button className="remove" onClick={()=>void removeRecord(row)} disabled={saving}>Supprimer</button></div>
     </article>})}
      {!suppliers.length?<div className="eas-blank"><strong>Votre réseau commence ici.</strong><p>Ajoutez vos meuniers, fournisseurs de produits frais et partenaires logistiques.</p></div>:null}
     </div>
    </>:null}

    {!loading && section==="stock" ? <>
     <div className="eas-sectionTitle"><div><span>02 / MATIÈRES & TRAÇABILITÉ</span><h3>Mes stocks</h3><p>Quantité, seuil d'approvisionnement, lot, emplacement et DLC / DDM.</p></div>
      <button type="button" className="eas-primary" onClick={newStock}>+ Ajouter</button></div>
     {showForm?<form className="eas-form" onSubmit={e=>void submitStock(e)}>
      <h4>{editingId?"Modifier le produit":"Nouveau produit en stock"}</h4>
      <div className="eas-formGrid">
       <TextField label="Produit *" value={stock.name} onChange={v=>setStock(p=>({...p,name:v}))} placeholder="Farine T65, mozzarella, carton…"/>
       <label className="eas-field"><span>Fournisseur</span><select value={stock.supplierId} onChange={e=>setStock(p=>({...p,supplierId:e.target.value}))}>
        <option value="">Non renseigné</option>{suppliers.map(r=><option key={r.id} value={r.id}>{supplierOf(r).name}</option>)}</select></label>
       <NumberField label="Quantité disponible" value={stock.quantity} onChange={v=>setStock(p=>({...p,quantity:v}))}/>
       <label className="eas-field"><span>Unité</span><select value={stock.unit} onChange={e=>setStock(p=>({...p,unit:e.target.value as Stock["unit"]}))}>
        <option value="kg">kg</option><option value="L">L</option><option value="pièce">pièce</option></select></label>
       <NumberField label="Seuil minimal" value={stock.minimum} onChange={v=>setStock(p=>({...p,minimum:v}))}/>
       <NumberField label={"Prix d'achat indicatif HT (€/"+stock.unit+")"} value={stock.price} onChange={v=>setStock(p=>({...p,price:v}))}/>
       <label className="eas-field"><span>Type de date</span><select value={stock.dateType} onChange={e=>setStock(p=>({...p,dateType:e.target.value as Stock["dateType"]}))}>
        <option value="DLC">DLC · limite de consommation</option>
        <option value="DDM">DDM · durabilité minimale</option>
        <option value="Aucune">Pas de date à suivre</option></select></label>
       <TextField label="Date indiquée" type="date" value={stock.expiry} onChange={v=>setStock(p=>({...p,expiry:v}))}/>
       <TextField label="Numéro de lot" value={stock.lot} onChange={v=>setStock(p=>({...p,lot:v}))}/>
       <label className="eas-field"><span>Zone de stockage</span><select value={stock.storage} onChange={e=>setStock(p=>({...p,storage:e.target.value}))}>
        {["Sec","Réfrigéré","Congelé","Autre"].map(v=><option key={v}>{v}</option>)}</select></label>
       <TextField label="Notes" value={stock.notes} onChange={v=>setStock(p=>({...p,notes:v}))}/>
      </div>
      <div className="eas-formActions"><button type="submit" className="eas-primary" disabled={saving}>Enregistrer</button><button type="button" onClick={()=>setShowForm(false)}>Annuler</button></div>
      <p className="eas-privateNote">La date est celle que vous saisissez : Ernesto n'infère jamais une DLC ni une durée de conservation.</p>
     </form>:null}
     <div className="eas-valueSummary">
      <div><small>RÉFÉRENCES</small><strong>{stocks.length}</strong></div>
      <div><small>POINTS À CONTRÔLER</small><strong>{stockAlerts.length}</strong></div>
      <div><small>VALORISATION SAISIE · HT</small><strong>{money.format(stockValue)}</strong></div>
     </div>
     <div className="eas-cardList">{stocks.map(row=>{const p=stockOf(row),w=stockWarnings(p);const supp=suppliers.find(r=>r.id===p.supplierId);
      return <article className="eas-card" key={row.id}><div className="eas-stockInfo">
       <div className="eas-stockTitle"><h4>{p.name}</h4>
        {w.low?<span className="eas-state alert">Stock bas</span>:null}
        {w.expiry?<span className="eas-state alert">{p.dateType} dépassée</span>:w.approaching?<span className="eas-state warning">{p.dateType} proche</span>:null}
       </div>
       <div className="eas-stockDetails"><strong>{fmt.format(p.quantity)} {p.unit}</strong>
        <span>Seuil : {fmt.format(p.minimum)} {p.unit}</span>
        {p.expiry&&p.dateType!=="Aucune"?<span>{p.dateType} : {p.expiry.split("-").reverse().join("/")}</span>:null}
        {p.lot?<span>Lot : {p.lot}</span>:null}
        <span>{p.storage}</span>{supp?<span>{supplierOf(supp).name}</span>:null}
       </div></div>
       <div className="eas-cardActions"><button onClick={()=>editStock(row)}>Actualiser</button><button className="remove" onClick={()=>void removeRecord(row)} disabled={saving}>Supprimer</button></div>
      </article>})}
      {!stocks.length?<div className="eas-blank"><strong>Un stock lisible, sans tableur.</strong><p>Ajoutez votre première matière première et son niveau minimum.</p></div>:null}
     </div>
     <p className="eas-legalNote">Ce suivi manuel ne remplace ni un plan de maîtrise sanitaire, ni le contrôle des températures, ni le système réglementaire de traçabilité.</p>
    </>:null}

   </div>
  </section>
 </div>;
}
