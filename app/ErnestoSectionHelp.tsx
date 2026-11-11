"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HELP_TOPICS, type HelpTopic } from "./ernestoHelpTopics";

export default function ErnestoSectionHelp({ topic }: { topic: HelpTopic }) {
  const help = HELP_TOPICS[topic];
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // Keep the dialog outside the scrollable, overflow-hidden recipe and commercial panels.
  useEffect(() => {
    setMounted(true);
    return () => {
      if (dialogRef.current?.open) dialogRef.current.close();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (visible && dialog && !dialog.open) dialog.showModal();
  }, [visible, mounted]);

  function openHelp() {
    setVisible(true);
  }

  function closeHelp() {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else setVisible(false);
  }

  function onDialogClosed() {
    setVisible(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <button
        type="button"
        className="ernestoHelpTrigger"
        aria-haspopup="dialog"
        aria-expanded={visible}
        aria-label={"Aide : " + help.title}
        onClick={openHelp}
        ref={triggerRef}
      >
        <span className="ernestoHelpMark" aria-hidden="true">?</span>
        Aide
      </button>
      {mounted && visible ? createPortal(
        <dialog
          ref={dialogRef}
          className="ernestoHelpDialog"
          aria-labelledby={titleId}
          onClose={onDialogClosed}
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
            {topic !== "home" ? <a href="/aide" target="_blank" rel="noopener noreferrer">Toutes les aides</a> : null}
          </div>
        </dialog>,
        document.body
      ) : null}
    </>
  );
}
