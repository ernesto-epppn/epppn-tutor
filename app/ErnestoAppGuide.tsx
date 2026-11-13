"use client";

import {useEffect,useId,useRef,useState} from "react";
import {createPortal} from "react-dom";

type Phone="iphone"|"android";

const steps:Record<Phone,string[]>={
  iphone:[
    "Ouvrez le lien ernesto.epppn.fr sur votre iPhone.",
    "Touchez le bouton Partager (carré avec une flèche vers le haut).",
    "Choisissez « Sur l’écran d’accueil ».",
    "Activez « Ouvrir comme app web » si proposé, puis touchez « Ajouter »."
  ],
  android:[
    "Ouvrez le lien ernesto.epppn.fr sur votre Android.",
    "Touchez le menu ⋮ dans votre navigateur.",
    "Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».",
    "Confirmez. L’icône Ernesto App apparaît sur l’écran d’accueil."
  ]
};

function PhoneIcon(){
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10 18.5h4"/>
  </svg>;
}

export default function ErnestoAppGuide(){
  const titleId=useId();
  const panelId=useId();
  const triggerRef=useRef<HTMLButtonElement>(null);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const [mounted,setMounted]=useState(false);
  const [visible,setVisible]=useState(false);
  const [phone,setPhone]=useState<Phone>("iphone");

  useEffect(()=>{
    setMounted(true);
    return ()=>{if(dialogRef.current?.open)dialogRef.current.close();};
  },[]);

  useEffect(()=>{
    if(visible&&dialogRef.current&&!dialogRef.current.open)dialogRef.current.showModal();
  },[visible,mounted]);

  function openGuide(){setPhone("iphone");setVisible(true);}
  function closeGuide(){
    if(dialogRef.current?.open)dialogRef.current.close();
    else setVisible(false);
  }
  function onDialogClosed(){
    setVisible(false);
    triggerRef.current?.focus({preventScroll:true});
  }
  const currentSteps=steps[phone];

  return <>
    <button ref={triggerRef} type="button" className="ernestoAppEntry"
      onClick={openGuide} aria-haspopup="dialog" aria-expanded={visible}>
      <span className="ernestoAppEntryIcon"><PhoneIcon/></span>
      <span className="ernestoAppEntryText"><strong>Ernesto App</strong>
        <small>Un accès direct depuis votre téléphone.</small></span>
      <span className="ernestoAppEntryAction">Voir la méthode <span aria-hidden="true">↗</span></span>
    </button>
    {mounted&&visible?createPortal(
      <dialog ref={dialogRef} className="ernestoAppDialog" aria-labelledby={titleId}
        onClose={onDialogClosed} onClick={event=>{if(event.target===event.currentTarget)closeGuide();}}>
        <div className="ernestoAppDialogHeader">
          <div className="ernestoAppDialogHeading">
            <span className="ernestoAppDialogKicker">ACCÈS RAPIDE</span>
            <h2 id={titleId}>Ernesto App sur votre téléphone</h2>
            <p>Ajoutez Ernesto App à votre écran d’accueil pour l’ouvrir d’un geste.</p>
          </div>
          <button type="button" className="ernestoAppClose" onClick={closeGuide} aria-label="Fermer la méthode">×</button>
        </div>
        <div className="ernestoAppDialogBody">
          <div className="ernestoAppDeviceTabs" role="tablist" aria-label="Choisir votre téléphone">
            <button type="button" role="tab" aria-controls={panelId} aria-selected={phone==="iphone"}
              className={phone==="iphone"?"is-active":""} onClick={()=>setPhone("iphone")}>iPhone</button>
            <button type="button" role="tab" aria-controls={panelId} aria-selected={phone==="android"}
              className={phone==="android"?"is-active":""} onClick={()=>setPhone("android")}>Android</button>
          </div>
          <section id={panelId} role="tabpanel" className="ernestoAppInstructions">
            <ol className="ernestoAppSteps">
              {currentSteps.map((step,index)=><li key={phone+index}>
                <span className="ernestoAppStepNumber" aria-hidden="true">{String(index+1).padStart(2,"0")}</span>
                <span>{step}</span>
              </li>)}
            </ol>
            <div className="ernestoAppDone">
              <strong>Une fois ajouté</strong>
              <p>Touchez l’icône Ernesto App sur votre écran d’accueil. L’accès est gratuit et ne passe pas par l’App Store ou le Play Store.</p>
            </div>
            <p className="ernestoAppNote">Les intitulés des menus peuvent varier. Une connexion Internet reste nécessaire pour utiliser le tuteur.</p>
          </section>
        </div>
      </dialog>,
      document.body
    ):null}
  </>;
}
