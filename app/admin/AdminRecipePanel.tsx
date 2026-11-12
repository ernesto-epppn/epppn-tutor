"use client";
import { useEffect,useMemo,useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { Recipe } from "../recipeData";
import ErnestoPersonalRecipeEditor from "../ErnestoPersonalRecipeEditor";

export default function AdminRecipePanel(){
 const supabase=useMemo(()=>{const u=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;return u&&k?createClient(u,k):null;},[]);
 const [recipes,setRecipes]=useState<Recipe[]>([]);
 const [token,setToken]=useState("");
 const [selected,setSelected]=useState<Recipe|null|undefined>(undefined);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [search,setSearch]=useState("");
 const [rev,setRev]=useState(0);
 useEffect(()=>{
  if(!supabase)return;
  let active=true;
  (async()=>{
   setLoading(true);setError("");
   try{
    const {data}=await supabase.auth.getSession(),accessToken=data.session?.access_token;
    if(!accessToken)throw Error("Session administrateur absente.");
    const res=await fetch("/api/recettes",{headers:{Authorization:"Bearer "+accessToken},cache:"no-store"});
    const d=await res.json();
    if(!res.ok||!d.isAdmin)throw Error("Accès administrateur refusé.");
    if(active){setToken(accessToken);setRecipes(d.recipes.filter((r:Recipe)=>!r.id.startsWith("personal:")));}
   }catch(e){if(active)setError(e instanceof Error?e.message:"Catalogue inaccessible.");}
   finally{if(active)setLoading(false);}
  })();
  return ()=>{active=false;};
 },[supabase,rev]);
 const displayed=recipes.filter(r=>(r.name+" "+r.subtitle+" "+r.flour).toLowerCase().includes(search.toLowerCase()));
 return <section className="adminRecipes">
  <div className="adminRecipesHead"><div><h2>Recettes · catalogue</h2><p>19 fiches EPPPN originales, modifications administrateur et recettes d'atelier.</p></div>
   <button type="button" onClick={()=>setSelected(null)}>+ Ajouter une recette</button></div>
  {error?<p role="alert">{error}</p>:null}
  <div className="adminRecipesLayout">
   <aside><input type="search" placeholder="Rechercher…" value={search} onChange={e=>setSearch(e.target.value)} aria-label="Rechercher une recette"/>
   {loading?<p>Chargement…</p>:displayed.map(r=>
    <button key={r.id} type="button" onClick={()=>setSelected(r)} className={selected?.id===r.id?"active":""}>
     <strong>{r.name}</strong><span>{r.subtitle||r.fermentation} · {r.id.startsWith("admin:")?"Atelier":"EPPPN"}</span>
    </button>)}</aside>
   <div className="adminRecipesEdit">
    {selected!==undefined&&token?
     <ErnestoPersonalRecipeEditor key={selected?.id||"new"} base={selected||undefined}
       accessToken={token} scope="official" onClose={()=>setSelected(undefined)}
       onSaved={()=>{setSelected(undefined);setRev(n=>n+1);}}/>:
     <p>Choisissez une formule à modifier ou créez une nouvelle recette. Les changements sont publiés dans le carnet pour tous les comptes autorisés.</p>}
   </div>
  </div>
 </section>;
}