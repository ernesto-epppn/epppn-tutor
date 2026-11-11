"use client";

import { useEffect, useId, useRef } from "react";
import { HELP_TOPICS, type HelpTopic } from "./ernestoHelpTopics";

export default function ErnestoSectionHelp({ topic }: { topic: HelpTopic }) {
  const help = HELP_TOPICS[topic];
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openHelp() {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeHelp() {
    if (dialogRef.current?.open) dialogRef.current.close();
  }

  useEffect(() => {
    return () => {
      if (dialogRef.current?.open) dialogRef.current.close();
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className="ernestoHelpTrigger"
        aria-haspopup="dialog"
        aria-label={"Aide : " + help.title}
        onClick={openHelp}
        ref={triggerRef}
      >
        <span className="ernestoHelpMark" aria-hidden="true">?</span>
        Aide
      </button>
      <dialog
        ref={dialogRef}
        className="ernestoHelpDialog"
        aria-labelledby={titleId}
        onClose={() => triggerRef.current?.focus({ preventScroll: true })}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeHelp();
        }}
      >
        <div className="ernestoHelpDialogHeader">
          <h2 id={titleId}>{help.title}</h2>
          <button
            type="button"
            className="ernestoHelpClose"
            aria-label="Fermer l'aide"
            onClick={closeHelp}
          >×</button>
        </div>
        <div className="ernestoHelpDialogBody">
          <ol>
            {help.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {help.note ? <p className="ernestoHelpNote">{help.note}</p> : null}
          <a href="/aide" target="_blank" rel="noopener noreferrer">Toutes les aides</a>
        </div>
      </dialog>
    </>
  );
}
