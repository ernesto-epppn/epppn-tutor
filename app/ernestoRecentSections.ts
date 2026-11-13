"use client";

import {useEffect,useState} from "react";

export type ErnestoSection="chat"|"recipes"|"commercial"|"carnet";
export type RecentSection={section:ErnestoSection;visitedAt:number};

const RECENT_STORAGE="ernesto-recent-sections-v1:";
const KEYS:readonly ErnestoSection[]=["chat","recipes","commercial","carnet"];
const MAX_RECENT=4;

function isSection(value:unknown):value is ErnestoSection{
  return typeof value==="string"&&KEYS.some(key=>key===value);
}

/** Never trust persisted browser data and never mix activity between accounts. */
export function normalizeRecentSections(value:unknown):RecentSection[]{
  if(!Array.isArray(value))return [];
  const valid=value.filter((row):row is RecentSection=>{
    if(!row||typeof row!=="object")return false;
    const item=row as Partial<RecentSection>;
    return isSection(item.section)&&typeof item.visitedAt==="number"&&
      Number.isSafeInteger(item.visitedAt)&&item.visitedAt>0&&item.visitedAt<=Date.now()+60_000;
  }).sort((a,b)=>b.visitedAt-a.visitedAt);
  const seen=new Set<ErnestoSection>();
  return valid.filter(item=>{
    if(seen.has(item.section))return false;
    seen.add(item.section);
    return true;
  }).slice(0,MAX_RECENT);
}

export function recordRecentSection(previous:RecentSection[],section:ErnestoSection,visitedAt:number):RecentSection[]{
  return normalizeRecentSections([{section,visitedAt},...previous.filter(item=>item.section!==section)]);
}

/** Recent section openings, not chat dossiers or claimed edits. Stored only in this browser. */
export function useErnestoRecentSections(accountId:string|null,activeSection:ErnestoSection|null){
  const [entries,setEntries]=useState<RecentSection[]>([]);
  const [loadedAccount,setLoadedAccount]=useState<string|null>(null);
  useEffect(()=>{
    if(!accountId){setEntries([]);setLoadedAccount(null);return;}
    try{
      const stored=JSON.parse(localStorage.getItem(RECENT_STORAGE+accountId)||"[]");
      setEntries(normalizeRecentSections(stored));
    }catch{setEntries([]);}
    setLoadedAccount(accountId);
  },[accountId]);

  useEffect(()=>{
    if(!accountId||loadedAccount!==accountId||!activeSection)return;
    const now=Date.now();
    // Always re-read to avoid overwriting an update from another tab.
    let previous:RecentSection[]=[];
    try{previous=normalizeRecentSections(JSON.parse(localStorage.getItem(RECENT_STORAGE+accountId)||"[]"));}catch{}
    const next=recordRecentSection(previous,activeSection,now);
    try{localStorage.setItem(RECENT_STORAGE+accountId,JSON.stringify(next));}catch{
      // Browsers with disabled storage can still show this session's recent openings.
    }
    setEntries(next);
  },[accountId,loadedAccount,activeSection]);

  return accountId&&loadedAccount===accountId?entries:[];
}
