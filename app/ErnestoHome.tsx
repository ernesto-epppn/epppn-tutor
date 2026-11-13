"use client";

import ErnestoSectionHelp from "./ErnestoSectionHelp";
import ErnestoAppGuide from "./ErnestoAppGuide";

import type {ErnestoSection,RecentSection} from "./ernestoRecentSections";

type Props = {
  recentActivities:RecentSection[];
  onTutor:()=>void;
  onRecipes:()=>void;
  onCarnet:()=>void;
  onCommercial:()=>void;
};

const timeFormat=new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
const sectionTitles:Record<ErnestoSection,string>={
  chat:"Tuteur Ernesto",
  recipes:"Recettes",
  commercial:"Commercial",
  carnet:"Mon carnet",
};

function MiniIcon({ name }: { name: "chat" | "recipes" | "carnet" | "commercial" }) {
  const path = {
    chat: <><path d="M4 5h16v12H9l-5 3V5z"/><path d="M8 9h8M8 13h5"/></>,
    recipes: <><path d="M3 5c3-1 6-1 9 1v13c-3-2-6-2-9-1z"/><path d="M12 6c3-2 6-2 9-1v13c-3-1-6-1-9 1z"/></>,
    carnet: <><path d="M5 3h13v18H5zM9 7h6M9 11h6M9 15h4"/><path d="m16 19 5-5"/></>,
    commercial: <><path d="M4 19V5m0 14h17M8 15l4-5 3 2 5-7"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path[name]}</svg>;
}

export default function ErnestoHome({
  recentActivities,onTutor,onRecipes,onCarnet,onCommercial,
}:Props){
  const actions=[
    {key:"chat" as const,title:"Tuteur Ernesto",action:onTutor},
    {key:"recipes" as const,title:"Recettes",action:onRecipes},
    {key:"commercial" as const,title:"Commercial",action:onCommercial},
    {key:"carnet" as const,title:"Mon carnet",action:onCarnet},
  ];
  const openSection:Record<ErnestoSection,()=>void>={
    chat:onTutor,recipes:onRecipes,commercial:onCommercial,carnet:onCarnet,
  };
  const recent=recentActivities.slice(0,4);

  return <section className="ernestoHomeDashboard" aria-labelledby="ernesto-home-title">
    <header className="ernestoHomeIntro">
      <h1 id="ernesto-home-title">Mon espace</h1>
      <ErnestoSectionHelp topic="home"/>
    </header>

    <div className="ernestoHomeCards" aria-label="Choisir un outil">
      {actions.map(action => <button type="button" key={action.key}
        className={`ernestoHomeCard ernestoHomeCard--${action.key}`}
        onClick={action.action}>
        <span className="ernestoHomeCardIcon"><MiniIcon name={action.key}/></span>
        <span className="ernestoHomeCardBody">
          <strong>{action.title}</strong>
        </span>
      </button>)}
    </div>
    <ErnestoAppGuide/>

    <section className="ernestoHomeRecent" aria-label="Quatre dernières activités">
      <div className="ernestoHomeRecentHeading">
        <div><h2>Activités récentes</h2><p>Les derniers espaces consultés sur cet appareil.</p></div>
      </div>
      <div className="ernestoHomeActivityList">
        {recent.length?recent.map(item=><button type="button" key={item.section}
          className="ernestoHomeActivity" onClick={openSection[item.section]}
          aria-label={`Ouvrir ${sectionTitles[item.section]}, utilisé le ${timeFormat.format(item.visitedAt)}`}>
          <span className="ernestoHomeActivityIcon"><MiniIcon name={item.section}/></span>
          <span className="ernestoHomeActivityName">{sectionTitles[item.section]}</span>
          <time dateTime={new Date(item.visitedAt).toISOString()}>{timeFormat.format(item.visitedAt)}</time>
        </button>):<p className="ernestoHomeNoActivity">Vos derniers espaces utilisés apparaîtront ici.</p>}
      </div>
    </section>

  </section>;
}
