"use client";

import {useEffect,useId,useRef,useState} from "react";
import {createPortal} from "react-dom";

type Phone="iphone"|"android";
type Browser="safari"|"chrome";

const steps: Record<Phone,Record<Browser,string[]>>={
  iphone:{
    safari:[
      "Ouvrez le lien https://ernesto.epppn.fr dans Safari.",
      "Touchez Partager (ou Menu de la page, puis Partager).",
      "Choisissez « Sur l’écran d’accueil » et activez « Ouvrir comme app web » si proposé.",
      "Touchez « Ajouter ». L’icône Ernesto apparaît sur l’écran d’accueil."
    ],
    chrome:[
      "Ouvrez le lien https://ernesto.epppn.fr dans Chrome.",
      "Touchez Partager, à droite de la barre d’adresse.",
      "Choisissez « Ajouter à l’écran d’accueil ».",
      "Vérifiez le nom Ernesto puis touchez « Ajouter »."
    ]
  },
  android:{
    safari:[],
    chrome:[
      "Ouvrez le lien https://ernesto.epppn.fr dans Chrome.",
      "Touchez le menu ⋮, à droite de la barre d’adresse.",
      "Choisissez « Installer et créer un raccourci », « Installer l’application » ou « Ajouter à l’écran d’accueil » selon votre version.",
      "Confirmez l’installation ou l’ajout. Retrouvez Ernesto sur l’écran d’accueil."
    ]
  }
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
  const [browser,setBrowser]=useState<Browser>("safari");

  useEffect(()=>{
    setMounted(true);
    return ()=>{if(dialogRef.current?.open)dialogRef.current.close();};
  },[]);

  useEffect(()=>{
    if(visible&&dialogRef.current&&!dialogRef.current.open)dialogRef.current.showModal();
  },[visible,mounted]);

  function openGuide(){setPhone("iphone");setBrowser("safari");setVisible(true);}
  function closeGuide(){
    if(dialogRef.current?.open)dialogRef.current.close();
    else setVisible(false);
  }
  function onDialogClosed(){
    setVisible(false);
    triggerRef.current?.focus({preventScroll:true});
  }
  function choosePhone(next:Phone){
    setPhone(next);
    setBrowser(next==="android"?"chrome":"safari");
  }
  const currentSteps=steps[phone][browser];

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
              className={phone==="iphone"?"is-active":""} onClick={()=>choosePhone("iphone")}>iPhone</button>
            <button type="button" role="tab" aria-controls={panelId} aria-selected={phone==="android"}
              className={phone==="android"?"is-active":""} onClick={()=>choosePhone("android")}>Android</button>
          </div>
          <section id={panelId} role="tabpanel" className="ernestoAppInstructions">
            <div className="ernestoAppBrowserHeading">
              <span>Avec {browser==="safari"?"Safari":"Chrome"}</span>
              {phone==="iphone"?<div className="ernestoAppBrowserChoice" role="group" aria-label="Choisir le navigateur">
                <button type="button" aria-pressed={browser==="safari"} className={browser==="safari"?"is-active":""}
                  onClick={()=>setBrowser("safari")}>Safari</button>
                <button type="button" aria-pressed={browser==="chrome"} className={browser==="chrome"?"is-active":""}
                  onClick={()=>setBrowser("chrome")}>Chrome</button>
              </div>:null}
            </div>
            <ol className="ernestoAppSteps">
              {currentSteps.map((step,index)=><li key={phone+browser+index}>
                <span className="ernestoAppStepNumber" aria-hidden="true">{String(index+1).padStart(2,"0")}</span>
                <span>{step}</span>
              </li>)}
            </ol>
            <div className="ernestoAppDone">
              <strong>Une fois ajouté</strong>
              <p>Touchez l’icône Ernesto sur votre écran d’accueil. L’accès est gratuit et ne passe pas par l’App Store ou le Play Store.</p>
            </div>
            <p className="ernestoAppNote">Les intitulés des menus peuvent varier. Une connexion Internet reste nécessaire pour utiliser le tuteur.</p>
          </section>
        </div>
      </dialog>,
      document.body
    ):null}
  </>;
}
