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
      <span className="ernestoHomeLead">ERNESTO  /  EPPPN</span>
      <h1 id="ernesto-home-title">L’atelier</h1>
    </header>

    <div className="ernestoHomeCards" aria-label="Choisir un outil">
      {actions.map(action => <button type="button" key={action.key}
        className={`ernestoHomeCard ernestoHomeCard--${action.key}`}
        onClick={action.action}>
        <span className="ernestoHomeCardBody">
          <strong>{action.title}</strong>
        </span>
        <span className="ernestoHomeCardArrow" aria-hidden="true">→</span>
      </button>)}
    </div>

    {recent.length ? <section className="ernestoHomeRecent" aria-label="Reprendre un dossier">
      <div className="ernestoHomeRecentHeading">
        <div><h2>Reprendre un dossier</h2></div>
        <button type="button" onClick={onAllDossiers}>Tous les dossiers <span aria-hidden="true">↗</span></button>
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
