"use client";

type RecentDossier = {
  id: string;
  title: string;
  count: number;
  updatedAt: number;
  active: boolean;
  color: string;
};

type Props = {
  dossiers: RecentDossier[];
  onTutor: () => void;
  onRecipes: () => void;
  onStocks: () => void;
  onCommercial: () => void;
  onSelectDossier: (id: string) => void;
  onAllDossiers: () => void;
};

function MiniIcon({ name }: { name: "chat" | "recipes" | "stocks" | "commercial" }) {
  const path = {
    chat: <><path d="M4 5h16v12H9l-5 3V5z"/><path d="M8 9h8M8 13h5"/></>,
    recipes: <><path d="M3 5c3-1 6-1 9 1v13c-3-2-6-2-9-1z"/><path d="M12 6c3-2 6-2 9-1v13c-3-1-6-1-9 1z"/></>,
    stocks: <><path d="M4 7h16v13H4zM4 11h16M9 7V4h6v3"/></>,
    commercial: <><path d="M4 19V5m0 14h17M8 15l4-5 3 2 5-7"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path[name]}</svg>;
}

export default function ErnestoHome({
  dossiers, onTutor, onRecipes, onStocks, onCommercial, onSelectDossier, onAllDossiers,
}: Props) {
  const actions = [
    { key: "chat" as const, title: "Tuteur Ernesto", action: onTutor },
    { key: "recipes" as const, title: "Le carnet des recettes", action: onRecipes },
    { key: "stocks" as const, title: "Stocks", action: onStocks },
    { key: "commercial" as const, title: "Commercial", action: onCommercial },
  ];

  const recent = [...dossiers]
    .filter((dossier) => dossier.count > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);

  return <section className="ernestoHomeDashboard" aria-labelledby="ernesto-home-title">
    <header className="ernestoHomeIntro">
      <h1 id="ernesto-home-title">Mon espace</h1>
    </header>

    <div className="ernestoHomeCards" aria-label="Choisir un outil">
      {actions.map(action => <button type="button" key={action.key}
        className={`ernestoHomeCard ernestoHomeCard--${action.key}`}
        onClick={action.action}>
        <span className="ernestoHomeCardIcon"><MiniIcon name={action.key}/></span>
        <span className="ernestoHomeCardBody">
          <strong>{action.title}</strong>
        </span>
        <span className="ernestoHomeCardArrow" aria-hidden="true">↗</span>
      </button>)}
    </div>

    {recent.length ? <section className="ernestoHomeRecent" aria-label="Reprendre un dossier">
      <div className="ernestoHomeRecentHeading">
        <div><h2>Dossiers récents</h2></div>
        <button type="button" onClick={onAllDossiers}>Voir tous</button>
      </div>
      <div className="ernestoHomeDossierList">
        {recent.map(p => <button type="button" key={p.id} onClick={() => onSelectDossier(p.id)}
          className="ernestoHomeDossier">
          <span className="ernestoHomeDossierDot" style={{background:p.color}}/>
          <span className="ernestoHomeDossierName">{p.title || "Dossier général"}</span>
          <span className="ernestoHomeDossierMeta">{p.count} message{p.count!==1?"s":""}</span>
          <span className="ernestoHomeDossierGo" aria-hidden="true">↗</span>
        </button>)}
      </div>
    </section> : <div className="ernestoHomeEmpty">
      <p>Vos derniers dossiers apparaîtront ici lorsque vous aurez commencé à utiliser le tuteur.</p>
    </div>}

  </section>;
}
