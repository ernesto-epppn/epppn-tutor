"use client";

import { useEffect } from "react";

const QUESTIONS = [
  "Service à 19 h : mes pâtons sont déjà très détendus à 15 h. Que puis-je corriger maintenant sans casser la fermentation ?",
  "Pâte à 70 %, farine W300, 48 h au froid et labo à 25 °C : pourquoi devient-elle trop molle avant le service ?",
  "Four électrique : le dessous colore trop vite alors que le dessus reste pâle. Quels réglages tester, et dans quel ordre ?",
  "Mon levain est très acide et pousse peu après les rafraîchis. Comment le remettre en force pour produire demain ?",
  "Je dois sortir 60 pizzas entre 19 h 30 et 21 h avec deux personnes. Comment organiser pâte, garniture, banc et cuisson ?",
  "Après 48 h au froid, mon cornicione reste serré malgré une pâte assez extensible. Quelles causes vérifier en priorité ?",
  "Je travaille à 65 % d’hydratation avec une farine W280 sur 24 h. Que dois-je contrôler avant de passer à 48 h ?",
  "Je suis passé de 65 à 70 % d’hydratation : la pâte colle davantage et le service est moins régulier. Que modifier en premier ?",
  "Je veux passer d’un four à bois à un four électrique sans changer immédiatement ma pâte. Quels paramètres dois-je comparer pendant les essais ?",
  "Mes pâtons sont beaux à la sortie du froid mais s’affaissent après deux heures à température ambiante. Comment lire ce phénomène ?",
  "À la première pizza du service la cuisson est correcte, puis la sole devient trop agressive pendant le rush. Comment stabiliser le four ?",
  "Ma pâte se déchire à l’ouverture uniquement en fin de service. Est-ce plutôt un problème de fermentation, de température ou de manipulation ?",
  "Je prépare aujourd’hui pour un service demain soir : comment construire une timeline réaliste de pétrissage, froid, sortie et apprêt ?",
  "Je veux une pizza plus légère sans simplement allonger la fermentation. Quels leviers techniques ont réellement du sens ?",
];

function setReactTextareaValue(value: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea.chatTextarea");
  if (!textarea) return;
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus({ preventScroll: true });
}

function patchQuickQuestions() {
  const section = document.querySelector<HTMLElement>(".quickSection");
  if (section) section.classList.add("v1454-contextual-questions");

  const mobileTitle = section?.querySelector<HTMLElement>(".mobileFaqToggle span:first-child");
  if (mobileTitle) mobileTitle.textContent = "Situations concrètes";

  const desktopTitle = section?.querySelector<HTMLElement>(".quickSectionHeader > div");
  if (desktopTitle) desktopTitle.textContent = "Situations concrètes à explorer";

  const cards = Array.from(document.querySelectorAll<HTMLButtonElement>(".quickCard.v13chip"));
  cards.forEach((card, index) => {
    if (index >= QUESTIONS.length) {
      card.style.display = "none";
      return;
    }
    card.style.removeProperty("display");
    const prompt = QUESTIONS[index];
    card.dataset.v1454Question = prompt;
    card.setAttribute("aria-label", prompt);
    card.title = "Utiliser cette situation comme point de départ";
    const text = card.querySelector<HTMLElement>(".quickText");
    if (text && text.textContent !== prompt) text.textContent = prompt;
  });

  const row = document.querySelector<HTMLElement>(".quickRow.questionTickerMask");
  row?.classList.add("v1454-question-ticker");
}

export default function ErnestoQuickQuestionsV1454() {
  useEffect(() => {
    patchQuickQuestions();

    const observer = new MutationObserver(() => patchQuickQuestions());
    observer.observe(document.body, { childList: true, subtree: true });

    const clickCapture = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".quickCard[data-v1454-question]") : null;
      if (!target?.dataset.v1454Question) return;
      const prompt = target.dataset.v1454Question;
      window.setTimeout(() => setReactTextareaValue(prompt), 0);
    };
    document.addEventListener("click", clickCapture, true);

    let frame = 0;
    let last = performance.now();
    let direction: 1 | -1 = 1;
    let interacting = false;
    let pauseUntil = 0;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    const row = () => document.querySelector<HTMLElement>(".quickRow.v1454-question-ticker");
    const pause = () => {
      interacting = true;
    };
    const resume = () => {
      interacting = false;
      pauseUntil = performance.now() + 1600;
    };

    const onPointerDown = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".v1454-question-ticker")) pause();
    };
    const onPointerUp = () => resume();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);

    const animate = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const node = row();

      if (node && !reducedMotion && !interacting && now >= pauseUntil) {
        const maxScroll = Math.max(0, node.scrollWidth - node.clientWidth);
        if (maxScroll > 1) {
          if (node.scrollLeft >= maxScroll - 2) direction = -1;
          if (node.scrollLeft <= 2) direction = 1;
          const speed = window.innerWidth <= 860 ? 30 : 22;
          node.scrollLeft += direction * speed * (dt / 1000);
        }
      }

      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", clickCapture, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
