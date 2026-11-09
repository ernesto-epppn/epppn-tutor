"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EPPPN_RECIPES, EPPPN_RECIPE_COUNT, GROUP_LABELS, type Recipe, type RecipeGroup } from "./recipeData";
import {
  calculateRecipe,
  normalizeRecipeSettings,
  recipeContextForTutor,
  recipeDefaults,
  recipeIsModified,
  type RecipeSettings,
} from "./recipeMath";

type Props = {
  open: boolean;
  onClose: () => void;
  onAsk: (question: string, context: string, name: string) => void;
  accountId?: string;
};
type Filter = "all" | RecipeGroup | "focaccia" | "favorites";

const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const gram = (v: number) => fmt.format(Math.round(v * 10) / 10) + " g";
const KEY = "ernesto-epppn-recipe-studio-v1:";

function Field({
  label, value, onChange, min = 0, max = 10000, step = 1, suffix = "", note
}:{
  label: string; value: number; onChange: (v:number)=>void;
  min?:number; max?:number; step?:number; suffix?:string;note?:string
}) {
  return <label className="ers-field">
    <span className="ers-fieldLabel">{label}</span>
    <span className="ers-inputWrap"><input
      type="number" value={value} min={min} max={max} step={step} inputMode="decimal"
      onChange={e => {
        const n = Number(e.currentTarget.value);
        if(e.currentTarget.value!=="" && Number.isFinite(n) && n>=min && n<=max) onChange(n);
      }}
    />{suffix ? <em>{suffix}</em> : null}</span>
    {note ? <span className="ers-fieldNote">{note}</span> : null}
  </label>;
}

function Chip({ active, children, onClick }:{
  active:boolean;children:React.ReactNode;onClick:()=>void
}) {
  return <button type="button" className={"ers-chip"+(active?" is-active":"")} onClick={onClick}>{children}</button>;
}

export default function ErnestoRecipeStudio({open,onClose,onAsk,accountId}:Props) {
  const [selectedId,setSelectedId]=useState(EPPPN_RECIPES[0].id);
  const [filter,setFilter]=useState<Filter>("all");
  const [search,setSearch]=useState("");
  const [settings,setSettings]=useState<Record<string,Partial<RecipeSettings>>>({});
  const [favorites,setFavorites]=useState<string[]>([]);
  const [question,setQuestion]=useState("");
  const [showAdjust,setShowAdjust]=useState(false);
  const [notice,setNotice]=useState("");
  const [ready,setReady]=useState(false);
  const closeRef=useRef<HTMLButtonElement>(null);

  const storageKey = accountId ? KEY+accountId : "";
  useEffect(()=>{
    if(!storageKey){setSettings({});setFavorites([]);setReady(true);return;}
    setReady(false);
    try{
      const item=JSON.parse(localStorage.getItem(storageKey)||"{}");
      setSettings(item?.settings && typeof item.settings==="object" ? item.settings : {});
      setFavorites(Array.isArray(item?.favorites)?item.favorites.filter((v:unknown)=>typeof v==="string"):[]);
      if(typeof item?.selectedId==="string" && EPPPN_RECIPES.some(r=>r.id===item.selectedId)) setSelectedId(item.selectedId);
    }catch{setSettings({});setFavorites([]);}
    setReady(true);
  },[storageKey]);

  useEffect(()=>{
    if(!storageKey||!ready) return;
    try{localStorage.setItem(storageKey,JSON.stringify({settings,favorites,selectedId}));}
    catch{ /* le calcul reste disponible sans stockage local */ }
  },[settings,favorites,selectedId,storageKey,ready]);

  useEffect(()=>{
    if(!open)return;
    const old=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const closeOnEsc=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};
    document.addEventListener("keydown",closeOnEsc);
    const timeout=window.setTimeout(()=>closeRef.current?.focus(),60);
    return ()=>{document.body.style.overflow=old;document.removeEventListener("keydown",closeOnEsc);window.clearTimeout(timeout);};
  },[open,onClose]);

  const recipe=EPPPN_RECIPES.find(r=>r.id===selectedId)||EPPPN_RECIPES[0];
  const values=useMemo(()=>normalizeRecipeSettings(recipe,settings[recipe.id]),[recipe,settings]);
  const amount=useMemo(()=>calculateRecipe(recipe,values),[recipe,values]);
  const modified=recipeIsModified(recipe,values);
  const filtered=useMemo(()=>EPPPN_RECIPES.filter(r=>{
    if(filter==="favorites"&&!favorites.includes(r.id))return false;
    if(filter==="focaccia"&&r.kind!=="focaccia")return false;
    if(filter!=="all"&&filter!=="favorites"&&filter!=="focaccia"&&r.group!==filter)return false;
    const term=search.trim().toLocaleLowerCase("fr");
    return !term || [r.name,r.subtitle,r.flour,GROUP_LABELS[r.group]].join(" ").toLocaleLowerCase("fr").includes(term);
  }),[filter,search,favorites]);

  if(!open)return null;

  function choose(id:string){
    if(!EPPPN_RECIPES.some(r=>r.id===id))return;
    setSelectedId(id);
    setQuestion("");setShowAdjust(false);setNotice("");
  }

  function patch(change:Partial<RecipeSettings>){
    setSettings(p=>({...p,[recipe.id]:{...normalizeRecipeSettings(recipe,p[recipe.id]),...change}}));
    setNotice("");
  }

  function chooseVariant(variantId:string){
    const variant=recipe.variants?.find(v=>v.id===variantId);
    if(!variant)return;
    patch({variantId,oil:variant.oil});
  }

  function resetRecipe(){
    setSettings(p=>({...p,[recipe.id]:recipeDefaults(recipe)}));
    setNotice("Formule EPPPN rétablie.");
  }

  async function copyRecipe(){
    const lines=[
      "EPPPN · Fiches recettes 2025 · p. "+recipe.page,
      recipe.name+" — "+recipe.subtitle,
      (modified?"Version personnelle":"Formule EPPPN")+" · "+recipe.fermentation,
      recipe.mode==="plaques"
        ? values.trays+" plaque(s) · "+values.trayWidth+" × "+values.trayHeight+" cm"
        : values.pieces+" pâtons · "+values.pieceWeight+" g",
      "",
      ...amount.quantities.map(i=>i.label+": "+gram(i.grams)+" · "+i.percent+" %"+(i.approximate?" (≈)":"")),
      "",
      "Total : "+gram(amount.dough),
      "Hydratation ajoutée : "+fmt.format(amount.nominalHydration)+" %"+(amount.effectiveHydration===null?" (hydratation du levain non précisée)":"" ),
      "",
      "Protocole :",
      ...recipe.steps.map(s=>s.name+" : "+s.detail),
      ...(recipe.bake?[recipe.bake]:[]),
      "",
      "Les valeurs ajustées ne remplacent pas la fiche officielle."
    ];
    try{
      await navigator.clipboard.writeText(lines.join("\n"));
      setNotice("Doses copiées.");
    }catch{
      setNotice("Copie non disponible dans ce navigateur.");
    }
  }

  function sendToErnesto(){
    const q=question.trim() || "Quels sont les points de vigilance pour réussir cette recette dans mon contexte de travail ?";
    const context=recipeContextForTutor(recipe,values);
    onAsk(q,context,recipe.name);
    setNotice("");
    onClose();
  }

  const shortPrompts=[
    "Comment gérer le bassinage ?",
    "Quels risques avec ma farine ?",
    "Que surveiller pendant la fermentation ?"
  ];

  return <div className="ers-layer" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="ers-shell" role="dialog" aria-modal="true" aria-labelledby="ers-title">
      <header className="ers-topbar">
        <div className="ers-brand">
          <span className="ers-brandMark" aria-hidden="true">E</span>
          <div><span className="ers-eyebrow">ERNESTO / EPPPN</span><h2 id="ers-title">Le Ricettario</h2></div>
          <span className="ers-year">Édition 2025</span>
        </div>
        <button ref={closeRef} className="ers-close" type="button" onClick={onClose} aria-label="Fermer le ricettario">
          Retour à Ernesto <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="ers-layout">
        <aside className="ers-library" aria-label="Bibliothèque de recettes">
          <div className="ers-libraryIntro"><span>01 / BIBLIOTHÈQUE</span><strong>{EPPPN_RECIPE_COUNT} recettes officielles</strong></div>
          <label className="ers-search"><span aria-hidden="true">⌕</span><input
            type="search" placeholder="Chercher une recette…" value={search} onChange={e=>setSearch(e.target.value)}
          /></label>
          <div className="ers-filters" role="group" aria-label="Filtrer les recettes">
            <Chip active={filter==="all"} onClick={()=>setFilter("all")}>Toutes</Chip>
            <Chip active={filter==="froid"} onClick={()=>setFilter("froid")}>J+1</Chip>
            <Chip active={filter==="direct"} onClick={()=>setFilter("direct")}>Directe</Chip>
            <Chip active={filter==="levain"} onClick={()=>setFilter("levain")}>Levain</Chip>
            <Chip active={filter==="focaccia"} onClick={()=>setFilter("focaccia")}>Focaccia</Chip>
            <Chip active={filter==="favorites"} onClick={()=>setFilter("favorites")}>★</Chip>
          </div>
          <div className="ers-recipeList">
            {filtered.map(r=><div key={r.id} className={"ers-recipeRow"+(r.id===recipe.id?" is-selected":"")}>
              <button className="ers-selectRecipe" onClick={()=>choose(r.id)} type="button" aria-current={r.id===recipe.id?"true":undefined}>
                <span className="ers-page">P. {String(r.page).padStart(2,"0")}</span>
                <strong>{r.name}</strong>
                <span>{r.subtitle}</span>
              </button>
              <button className={"ers-favorite"+(favorites.includes(r.id)?" is-favorite":"")} type="button"
                onClick={()=>setFavorites(p=>p.includes(r.id)?p.filter(x=>x!==r.id):[...p,r.id])}
                aria-label={(favorites.includes(r.id)?"Retirer des favoris : ":"Ajouter aux favoris : ")+r.name}
                title="Favori">{favorites.includes(r.id)?"★":"☆"}</button>
            </div>)}
            {!filtered.length&&<p className="ers-empty">Aucune recette correspondante.</p>}
          </div>
          <div className="ers-libraryFoot">Source : <strong>Fiches recettes EPPPN 2025</strong><span>Une formule d'origine, des variantes contrôlées.</span></div>
        </aside>

        <div className="ers-content">
          <div className="ers-mobileChoose">
            <label>Choisir une recette
              <select value={selectedId} onChange={e=>choose(e.target.value)}>
                {EPPPN_RECIPES.map(r=><option key={r.id} value={r.id}>{r.name} · {r.subtitle}</option>)}
              </select>
            </label>
          </div>

          <div className="ers-titleRow">
            <div>
              <div className="ers-super">02 / FICHE N° {String(recipe.page).padStart(2,"0")} <span>·</span> {GROUP_LABELS[recipe.group]}</div>
              <h3>{recipe.name}</h3>
              <p>{recipe.subtitle}</p>
            </div>
            <div className="ers-formulaState"><span className={modified?"ers-personal":"ers-original"}>{modified?"Ma variante":"Formule EPPPN"}</span><span>Page {recipe.page} / 21</span></div>
          </div>

          <div className="ers-infoLine"><span>FARINE</span><strong>{recipe.flour}</strong></div>
          <div className="ers-work">
            <div className="ers-calculator">
              <div className="ers-blockTitle"><span>03 / CALCULATEUR</span><strong>Vos quantités</strong></div>

              {recipe.variants?.length ? <div className="ers-variantSwitch" role="group" aria-label="Type de produit">
                {recipe.variants.map(v=><button key={v.id} type="button"
                  className={values.variantId===v.id?"is-active":""}
                  onClick={()=>chooseVariant(v.id)}>{v.label}</button>)}
              </div>:null}

              <div className="ers-countGrid">
                {recipe.mode==="pâtons" ? <>
                  <Field label="Nombre de pâtons" min={1} max={5000} value={values.pieces} onChange={v=>patch({pieces:v})}/>
                  <Field label="Poids par pâton" value={values.pieceWeight} min={50} max={2000} step={5} suffix="g" onChange={v=>patch({pieceWeight:v})}/>
                </> : <>
                  <Field label="Nombre de plaques" min={1} max={300} value={values.trays} onChange={v=>patch({trays:v})}/>
                  <Field label="Largeur" min={10} max={200} value={values.trayWidth} suffix="cm" onChange={v=>patch({trayWidth:v})}/>
                  <Field label="Longueur" min={10} max={200} value={values.trayHeight} suffix="cm" onChange={v=>patch({trayHeight:v})}/>
                </>}
              </div>

              <div className="ers-total">
                <span>PÂTE À PRÉPARER</span>
                <strong aria-live="polite">{gram(amount.dough)}</strong>
                <span>{recipe.mode==="pâtons"
                  ? values.pieces+" × "+fmt.format(values.pieceWeight)+" g"
                  : fmt.format(values.trays)+" plaque(s) · "+values.trayWidth+" × "+values.trayHeight+" cm"}</span>
              </div>

              <div className="ers-tableHead"><strong>Ingrédients</strong><span>% farine <b>Poids</b></span></div>
              <div className="ers-ingredients">
                {amount.quantities.map((i,index)=><div className={"ers-ingredient"+(index===0?" main":"")} key={i.key}>
                  <span>{i.label}{i.approximate ? <small>≈ selon farine</small>:null}</span>
                  <span className="ers-percentage">{fmt.format(i.percent)} %</span>
                  <strong>{gram(i.grams)}</strong>
                </div>)}
              </div>

              <div className="ers-hydrationRow">
                <div><small>Eau ajoutée / farine</small><strong>{fmt.format(amount.nominalHydration)} %</strong></div>
                <div><small>Hydratation totale*</small><strong>{amount.effectiveHydration===null?"À préciser":fmt.format(amount.effectiveHydration)+" %"}</strong></div>
              </div>
              <p className="ers-mathCaption">
                * Avec la farine et l’eau du levain lorsque son hydratation est connue.
                {recipe.potato>0?" L’eau contenue dans les pommes de terre n’est pas estimée.":""}
                {" "}Bassinage indicatif, à adapter à l’absorption réelle de la farine.
              </p>

              <details className="ers-adjust" open={showAdjust} onToggle={e=>setShowAdjust(e.currentTarget.open)}>
                <summary>Adapter la formule <span>{modified?"Paramètres personnalisés":"Voir les pourcentages"} ＋</span></summary>
                <div className="ers-adjustBody">
                  <p>Les modifications créent une variante personnelle. La fiche EPPPN reste inchangée.</p>
                  <div className="ers-adjustGrid">
                    <Field label="Eau de coulage" value={values.water} suffix="%" step={0.5} max={120} onChange={v=>patch({water:v})}/>
                    <Field label="Bassinage ≈" value={values.bassinage} suffix="%" step={0.5} max={120} onChange={v=>patch({bassinage:v})}/>
                    <Field label="Sel" value={values.salt} suffix="%" step={0.1} max={20} onChange={v=>patch({salt:v})}/>
                    {recipe.yeast>0?<Field label="Levure fraîche" value={values.yeast} suffix="%" step={0.05} max={20} onChange={v=>patch({yeast:v})}/>:null}
                    {recipe.levain>0?<Field label="Levain naturel" value={values.levain} suffix="%" step={0.5} max={100} onChange={v=>patch({levain:v})}/>:null}
                    {recipe.oil>0?<Field label="Huile d’olive" value={values.oil} suffix="%" step={0.5} max={50} onChange={v=>patch({oil:v})}/>:null}
                    {recipe.potato>0?<Field label="Pommes de terre" value={values.potato} suffix="%" step={0.5} max={100} onChange={v=>patch({potato:v})}/>:null}
                    {recipe.levain>0?<div className="ers-hydrInput"><Field label="Hydratation du levain" value={values.levainHydration??0} suffix="%" step={5} max={250} onChange={v=>patch({levainHydration:v})}/>
                      {values.levainHydration===null?<small>Non précisée par la fiche : saisissez votre valeur réelle pour calculer le TH total.</small>:<button type="button" onClick={()=>patch({levainHydration:null})}>Non précisée</button>}
                    </div>:null}
                  </div>
                  <button className="ers-reset" type="button" onClick={resetRecipe}>↺ Rétablir la fiche originale</button>
                </div>
              </details>

              <div className="ers-actions">
                <button type="button" onClick={()=>void copyRecipe()}>⧉ Copier les doses</button>
                <button type="button" onClick={()=>window.print()}>⎙ Imprimer</button>
              </div>
              {notice?<div role="status" className="ers-notice">{notice}</div>:null}
            </div>

            <aside className="ers-protocol">
              <div className="ers-blockTitle"><span>04 / PROCÉDÉ</span><strong>De la pâte au four</strong></div>
              <div className="ers-processMeta">
                <div><span>Fermentation</span><strong>{recipe.fermentation}</strong></div>
                {recipe.targetDoughTemp?<div><span>Température pâte</span><strong>{recipe.targetDoughTemp}</strong></div>:null}
              </div>
              <ol className="ers-steps">
                {recipe.steps.map((step,i)=><li key={i}><span className="ers-stepIndex">{String(i+1).padStart(2,"0")}</span><div><strong>{step.name}</strong><p>{step.detail}</p></div></li>)}
              </ol>
              {recipe.bake?<div className="ers-bake"><span>CUISSON · SOURCE</span><strong>{recipe.bake}</strong></div>:null}
              {recipe.sourceNotes?.length?<div className="ers-note"><strong>Repères EPPPN</strong>{recipe.sourceNotes.map((n,i)=><p key={i}>{n}</p>)}</div>:null}
              {recipe.caution?<div className="ers-caution"><strong>Point à vérifier</strong><p>{recipe.caution}</p></div>:null}

              <div className="ers-tutor">
                <div className="ers-tutorTop"><span aria-hidden="true">✳</span><div><strong>Un doute ? Ernesto est là.</strong><small>La recette et vos doses suivent la question.</small></div></div>
                <div className="ers-promptOptions">
                  {shortPrompts.map(q=><button key={q} type="button" onClick={()=>setQuestion(q)}>{q}</button>)}
                </div>
                <label className="ers-askLabel" htmlFor="ers-ask">Votre question</label>
                <textarea id="ers-ask" rows={2} placeholder="Ex. Ma farine absorbe moins d’eau…" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1800}/>
                <button className="ers-askBtn" type="button" onClick={sendToErnesto}>Demander à Ernesto <span aria-hidden="true">↗</span></button>
              </div>
            </aside>
          </div>
          <div className="ers-bottomNotes">Fiches recettes EPPPN 2025 · Source p. {recipe.page} · Calcul en pourcentages boulangers, sans génération IA. {storageKey?"Vos préférences restent sur cet appareil.":""}</div>
        </div>
      </div>
    </section>
  </div>;
}
