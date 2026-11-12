"use client";
import { useEffect,useState } from "react";
import type { Recipe,RecipeGroup } from "./recipeData";

type Props={base?:Recipe;accessToken:string;onClose:()=>void;onSaved:(id:string)=>void};
const defaults:Recipe={id:"",page:0,name:"Ma nouvelle pizza",subtitle:"Recette personnelle",
  group:"direct",kind:"pizza",mode:"pâtons",flour:"Farine de blé",water:60,bassinage:0,
  salt:2,yeast:0.4,levain:0,levainHydration:null,oil:0,potato:0,defaultPieces:8,pieceWeight:260,
  fermentation:"Directe",steps:[{name:"Pétrissage",detail:"Décrire la méthode."}]};
const fields:[keyof Recipe,string][]=[
  ["water","Eau"],["bassinage","Bassinage"],["salt","Sel"],
  ["yeast","Levure"],["levain","Levain"],["oil","Huile"],["potato","Pommes de terre"]
];
export default function ErnestoPersonalRecipeEditor({base,accessToken,onClose,onSaved}:Props){
  const [draft,setDraft]=useState<Recipe>(defaults);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    setDraft(base?{...base,id:base.id.startsWith("personal:")?base.id:"",
      name:base.id.startsWith("personal:")?base.name:base.name+" · ma version",
      subtitle:"Recette personnelle",page:0,sourceNotes:[],
      steps:base.steps.map(s=>({...s}))}:{...defaults});
    setError("");
  },[base]);
  function patch(value:Partial<Recipe>){setDraft(v=>({...v,...value}));setError("");}
  async function save(){
    if(!draft.name.trim()||!draft.flour.trim()||!draft.steps.some(s=>s.name&&s.detail)){setError("Complétez le nom, la farine et les étapes.");return;}
    setBusy(true);setError("");
    try{
      const res=await fetch("/api/recettes",{method:"POST",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+accessToken},
        body:JSON.stringify({scope:"personal",id:draft.id,recipe:draft})});
      const body=await res.json();
      if(!res.ok)throw Error("Recette non enregistrée : "+String(body.error||res.status));
      onSaved(body.recipe.id);
    }catch(e){setError(e instanceof Error?e.message:"Erreur.");}
    finally{setBusy(false);}
  }
  async function remove(){
    if(!draft.id.startsWith("personal:")||!window.confirm("Supprimer ma recette ?"))return;
    setBusy(true);
    try{
      const res=await fetch("/api/recettes?id="+encodeURIComponent(draft.id),{
        method:"DELETE",headers:{Authorization:"Bearer "+accessToken}});
      if(!res.ok)throw Error("Suppression impossible.");
      onSaved("classique-j1");
    }catch(e){setError(e instanceof Error?e.message:"Erreur.");}
    finally{setBusy(false);}
  }
  return <section className="ers-personalEditor" aria-label="Éditeur de recette personnelle">
    <div className="ers-personalHead"><strong>{draft.id?"Modifier ma recette":"Créer ma recette"}</strong>
      <button type="button" onClick={onClose}>Fermer ×</button></div>
    <div className="ers-personalGrid">
      <label>Nom<input maxLength={100} value={draft.name} onChange={e=>patch({name:e.target.value})}/></label>
      <label>Farine<input maxLength={160} value={draft.flour} onChange={e=>patch({flour:e.target.value})}/></label>
      <label>Fermentation<select value={draft.group} onChange={e=>patch({group:e.target.value as RecipeGroup})}>
        <option value="direct">Directe</option><option value="froid">J+1 / froid</option><option value="levain">Levain</option>
      </select></label>
      <label>Type<select value={draft.kind} onChange={e=>patch({kind:e.target.value as Recipe["kind"]})}>
        <option value="pizza">Pizza</option><option value="focaccia">Focaccia</option>
      </select></label>
      <label>Forme<select value={draft.mode} onChange={e=>patch({mode:e.target.value as Recipe["mode"]})}>
        <option value="pâtons">Pâtons</option><option value="plaques">Plaques</option>
      </select></label>
      <label>Protocole de fermentation<input value={draft.fermentation} onChange={e=>patch({fermentation:e.target.value})}/></label>
      {fields.map(([k,label])=><label key={k}>{label} · % farine
        <input type="number" min={0} max={250} step=".1" value={Number(draft[k]??0)}
          onChange={e=>patch({[k]:Number(e.target.value)})}/>
      </label>)}
      {draft.mode==="pâtons"?<label>Poids d'un pâton · g<input type="number" min="50" max="10000"
        value={draft.pieceWeight||260} onChange={e=>patch({pieceWeight:Number(e.target.value)})}/></label>:
        <label>Farine par plaque 60×40 · g<input type="number" min="1" max="100000"
        value={draft.baseFlourPerTray||1400} onChange={e=>patch({baseFlourPerTray:Number(e.target.value),baseTrayWidth:60,baseTrayHeight:40})}/></label>}
    </div>
    <label className="ers-stepEditor">Préparation · une ligne par étape (« Nom : description »)
      <textarea rows={4} value={draft.steps.map(s=>s.name+" : "+s.detail).join("\n")}
        onChange={e=>patch({steps:e.target.value.split("\n").slice(0,16).map(line=>{
          const k=line.indexOf(":");return {name:(k<0?"Étape":line.slice(0,k)).trim(),
            detail:(k<0?line:line.slice(k+1)).trim()};
        })})}/>
    </label>
    <div className="ers-personalActions">
      <button type="button" className="ers-savePersonal" disabled={busy} onClick={()=>void save()}>Enregistrer</button>
      {draft.id.startsWith("personal:")?<button type="button" disabled={busy} onClick={()=>void remove()}>Supprimer</button>:null}
      <button type="button" onClick={onClose}>Annuler</button>
    </div>
    {error?<p role="alert" className="ers-editorError">{error}</p>:null}
    <p>Cette recette est privée, et ne modifie aucune fiche EPPPN.</p>
  </section>;
}
