import Link from "next/link";
import { HELP_TOPICS, type HelpTopic } from "../ErnestoSectionHelp";
import "./aide.css";

const sections: { key: HelpTopic; label: string }[] = [
  { key: "home", label: "Mon espace" },
  { key: "tutor", label: "Tuteur Ernesto" },
  { key: "recipes", label: "Recettes" },
  { key: "cost", label: "Coût & marge" },
  { key: "journal", label: "Journal" },
  { key: "stock", label: "Mes stocks" },
  { key: "suppliers", label: "Fournisseurs" },
  { key: "carnet", label: "Mon carnet" },
];

export default function AidePage() {
  return (
    <main className="ernestoAidePage">
      <div className="ernestoAideContainer">
        <header className="ernestoAideHeader">
          <Link className="ernestoAideBack" href="/">Retour à Ernesto</Link>
          <h1>Aide</h1>
          <p>Choisissez une rubrique pour savoir comment l'utiliser.</p>
        </header>

        <nav className="ernestoAideNav" aria-label="Rubriques d'aide">
          {sections.map(({ key, label }) => (
            <a key={key} href={"#" + key}>{label}</a>
          ))}
        </nav>

        <div className="ernestoAideSections">
          {sections.map(({ key }) => {
            const topic = HELP_TOPICS[key];
            return (
              <section className="ernestoAideSection" id={key} key={key}>
                <h2>{topic.title}</h2>
                <ol>
                  {topic.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
                {topic.note ? <p className="ernestoAideNote">{topic.note}</p> : null}
              </section>
            );
          })}
        </div>

        <footer className="ernestoAideFooter">
          <Link href="/">Retour à Ernesto</Link>
        </footer>
      </div>
    </main>
  );
}
