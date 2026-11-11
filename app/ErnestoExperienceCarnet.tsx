"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type ExperienceNote = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  experience_date: string | null;
  use_in_answers: boolean;
  created_at: string;
  updated_at: string;
};
type Prefill = { text: string; key: number } | null;
type Props = {
  open: boolean;
  onClose: () => void;
  onHome: () => void;
  supabase: SupabaseClient;
  userId?: string;
  prefill?: Prefill;
};
const todayLocalISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
};
const noteDate = (date: string) => {
  try {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(date+"T12:00:00")
      : new Date(date);
    return Number.isNaN(parsed.getTime()) ? "" :
      new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",year:"numeric"}).format(parsed);
  } catch { return ""; }
};

export default function ErnestoExperienceCarnet({open,onClose,onHome,supabase,userId,prefill}:Props){
  const [notes,setNotes]=useState<ExperienceNote[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [title,setTitle]=useState("");
  const [body,setBody]=useState("");
  const [experienceDate,setExperienceDate]=useState(todayLocalISO);
  const [useInAnswers,setUseInAnswers]=useState(true);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0);
  const inputRef=useRef<HTMLTextAreaElement>(null);

  useEffect(()=>{
    if(!open||!userId)return;
    let cancelled=false;
    setLoading(true);
    setError("");
    void supabase.from("ernesto_experience_notes")
      .select("id,user_id,title,body,experience_date,use_in_answers,created_at,updated_at")
      .eq("user_id",userId)
      .order("updated_at",{ascending:false})
      .limit(200)
      .then(({data,error:loadError})=>{
        if(cancelled)return;
        if(loadError)setError("Impossible de charger vos notes.");
        else setNotes((data||[]) as ExperienceNote[]);
      }).then(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[open,userId,supabase,refresh]);

  useEffect(()=>{
    if(!open||!prefill?.key)return;
    setEditingId(null);
    setTitle("Note issue d’une conversation");
    setBody(prefill.text.slice(0,6000));
    setExperienceDate("");
    // A copied AI answer should not silently become a personal observation.
    setUseInAnswers(false);
    setNotice("");
    inputRef.current?.focus();
  },[open,prefill?.key,prefill?.text]);

  useEffect(()=>{
    if(!open)return;
    const old=document.body.style.overflow;
    const focused=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.body.style.overflow="hidden";
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};
    document.addEventListener("keydown",onKey);
    return ()=>{
      document.body.style.overflow=old;
      document.removeEventListener("keydown",onKey);
      focused?.focus();
    };
  },[open,onClose]);

  if(!open)return null;

  function reset(){
    setEditingId(null);setTitle("");setBody("");setExperienceDate(todayLocalISO());setUseInAnswers(true);
    setError("");setNotice("");
  }
  function edit(note:ExperienceNote){
    setEditingId(note.id);setTitle(note.title);setBody(note.body);
    setExperienceDate(note.experience_date||"");
    setUseInAnswers(note.use_in_answers);setNotice("");setError("");
    inputRef.current?.focus();
  }
  async function save(event:React.FormEvent){
    event.preventDefault();
    if(!userId||saving)return;
    const cleanBody=body.trim().slice(0,6000);
    if(!cleanBody){setError("Écrivez quelques lignes avant d'enregistrer.");return;}
    setSaving(true);setError("");setNotice("");
    const payload={title:title.trim().slice(0,140),body:cleanBody,
      experience_date:experienceDate||null,
      use_in_answers:useInAnswers,updated_at:new Date().toISOString()};
    try{
      const result=editingId
        ? await supabase.from("ernesto_experience_notes").update(payload)
            .eq("id",editingId).eq("user_id",userId).select("id").single()
        : await supabase.from("ernesto_experience_notes").insert({...payload,user_id:userId})
            .select("id").single();
      if(result.error)throw result.error;
      reset();setRefresh(n=>n+1);setNotice(editingId?"Note mise à jour.":"Note enregistrée.");
    }catch{setError("Enregistrement impossible. Vérifiez votre connexion.");}
    finally{setSaving(false);}
  }
  async function remove(note:ExperienceNote){
    if(!userId||saving||!window.confirm("Supprimer définitivement cette note ?"))return;
    setSaving(true);setError("");
    const {error:deleteError}=await supabase.from("ernesto_experience_notes")
      .delete().eq("id",note.id).eq("user_id",userId);
    if(deleteError)setError("Suppression impossible.");
    else{
      if(editingId===note.id)reset();
      setRefresh(n=>n+1);
      setNotice("Note supprimée.");
    }
    setSaving(false);
  }
  async function toggle(note:ExperienceNote){
    if(!userId||saving)return;
    setSaving(true);setError("");setNotice("");
    const {error:toggleError}=await supabase.from("ernesto_experience_notes")
      .update({use_in_answers:!note.use_in_answers,updated_at:new Date().toISOString()})
      .eq("id",note.id).eq("user_id",userId);
    if(toggleError)setError("Modification impossible.");
    else{
      if(editingId===note.id)setUseInAnswers(!note.use_in_answers);
      setRefresh(n=>n+1);
    }
    setSaving(false);
  }

  return <div className="enote-layer" role="presentation"
    onMouseDown={e=>{if(e.currentTarget===e.target)onClose();}}>
    <section className="enote-shell" role="dialog" aria-modal="true" aria-labelledby="enote-title">
      <header className="enote-header">
        <div className="enote-mark" aria-hidden="true">✎</div>
        <div className="enote-heading">
          <h2 id="enote-title">Mon carnet</h2>
        </div>
        <div className="enote-nav">
          <button type="button" onClick={onHome}>Accueil</button>
          <button type="button" onClick={onClose} aria-label="Fermer Mon carnet">×</button>
        </div>
      </header>
      <div className="enote-scroll">
        {error?<p className="enote-error" role="alert">{error}</p>:null}
        {notice?<p className="enote-notice" role="status">{notice}</p>:null}
        <form className="enote-form" onSubmit={e=>void save(e)}>
          <div className="enote-formHead">
            <h3>{editingId?"Modifier une note":"Nouvelle note"}</h3>
            {editingId?<button type="button" className="enote-textButton" onClick={reset}>Annuler</button>:null}
          </div>
          <label className="enote-field">
            <span>Titre <small>facultatif</small></span>
            <input value={title} onChange={e=>setTitle(e.target.value.slice(0,140))}
              placeholder="Ex. Pâte trop collante avec la T80" maxLength={140}/>
          </label>
          <label className="enote-field enote-dateField">
            <span>Date de l’expérience <small>facultative</small></span>
            <input type="date" value={experienceDate} onChange={e=>setExperienceDate(e.target.value)}
              aria-label="Date à laquelle l'expérience a eu lieu" />
          </label>
          <label className="enote-field">
            <span>Votre observation</span>
            <textarea ref={inputRef} rows={5} value={body}
              onChange={e=>setBody(e.target.value.slice(0,6000))} maxLength={6000}
              placeholder="Ce que vous avez essayé, ce qui s'est passé, ce que vous changeriez…"/>
          </label>
          <label className="enote-consent">
            <input type="checkbox" checked={useInAnswers} onChange={e=>setUseInAnswers(e.target.checked)}/>
            <span>Permettre à Ernesto d'utiliser cette note dans mes réponses, lorsqu'elle est pertinente.</span>
          </label>
          <div className="enote-formFooter">
            <span>{body.length}/6000</span>
            <button type="submit" className="enote-save" disabled={saving||!body.trim()}>
              {saving?"Enregistrement…":editingId?"Enregistrer les modifications":"Enregistrer"}
            </button>
          </div>
        </form>
        <section className="enote-history" aria-label="Mes notes">
          <h3>Mes notes <span>{notes.length}</span></h3>
          {loading?<p className="enote-empty">Chargement…</p>:null}
          {!loading&&!notes.length?<p className="enote-empty">Vos notes apparaîtront ici après votre première observation.</p>:null}
          {notes.map(note=><article key={note.id} className="enote-entry">
            <div className="enote-entryTop">
              <h4>{note.title||"Sans titre"}</h4>
              {note.experience_date
                ? <time dateTime={note.experience_date} title="Date de l’expérience">
                    Expérience du {noteDate(note.experience_date)}
                  </time>
                : <time dateTime={note.created_at} title="Date d’enregistrement">
                    Ajoutée le {noteDate(note.created_at)}
                  </time>}
            </div>
            <p>{note.body}</p>
            <div className="enote-entryActions">
              <button type="button" className="enote-use" onClick={()=>void toggle(note)}
                disabled={saving} aria-pressed={note.use_in_answers}
                title={note.use_in_answers?"Exclure des réponses":"Autoriser dans les réponses"}>
                {note.use_in_answers?"Autorisée pour les réponses":"Exclue des réponses"}
              </button>
              <button type="button" onClick={()=>edit(note)}>Modifier</button>
              <button type="button" className="enote-remove" onClick={()=>void remove(note)}
                disabled={saving}>Supprimer</button>
            </div>
          </article>)}
        </section>
      </div>
    </section>
  </div>;
}
