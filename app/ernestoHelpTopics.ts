export type HelpTopic =
  | "home"
  | "tutor"
  | "recipes"
  | "cost"
  | "journal"
  | "stock"
  | "suppliers"
  | "carnet";

type HelpEntry = {
  title: string;
  steps: readonly string[];
  note?: string;
};

export const HELP_TOPICS: Record<HelpTopic, HelpEntry> = {
  home: {
    title: "Mon espace",
    steps: [
      "Tuteur Ernesto : posez une question ou reprenez un dossier.",
      "Recettes : consultez une formule et calculez les quantités.",
      "Commercial : calculez vos coûts, notez les opérations et suivez les stocks.",
      "Mon carnet : gardez vos observations et vos essais.",
    ],
  },
  tutor: {
    title: "Tuteur Ernesto",
    steps: [
      "Décrivez votre situation : pâte, farine, temps, température, four ou problème rencontré.",
      "Utilisez un dossier pour retrouver les échanges sur le même sujet.",
      "Ajoutez une photo si elle aide à comprendre le problème.",
      "Vérifiez les conseils avant de les appliquer à votre production.",
    ],
    note: "Vous pouvez préciser votre contexte de travail pour obtenir une réponse plus adaptée.",
  },
  recipes: {
    title: "Recettes",
    steps: [
      "Choisissez une fiche EPPPN dans la liste.",
      "Indiquez la quantité de pâte ou le nombre de pièces voulu.",
      "Modifiez les paramètres si nécessaire. Vous pouvez revenir à la formule d'origine.",
      "Envoyez une question à Ernesto avec la recette et vos quantités.",
    ],
    note: "Les favoris et les ajustements sont conservés dans ce navigateur, pas automatiquement sur vos autres appareils.",
  },
  cost: {
    title: "Coût & marge",
    steps: [
      "Choisissez une recette EPPPN ou saisissez les coûts de votre propre produit.",
      "Renseignez les prix des ingrédients et les autres coûts par unité.",
      "Indiquez votre prix de vente TTC et le taux de TVA applicable.",
      "Comparez le coût estimé et la marge, puis enregistrez le calcul si vous le souhaitez.",
    ],
    note: "La marge affichée n'est pas un bénéfice net. Vérifiez la TVA et les charges qui ne sont pas incluses.",
  },
  journal: {
    title: "Journal",
    steps: [
      "Choisissez un mois.",
      "Ajoutez chaque vente ou dépense avec sa date et son montant.",
      "Consultez le total des entrées et des sorties.",
      "Corrigez une opération ou exportez le mois en CSV si nécessaire.",
    ],
    note: "Ce journal est un suivi simple. Il ne remplace pas une comptabilité.",
  },
  stock: {
    title: "Mes stocks",
    steps: [
      "Ajoutez un produit, son unité et sa quantité.",
      "Indiquez un seuil minimum pour repérer les stocks bas.",
      "Saisissez une date limite seulement si vous la connaissez.",
      "Actualisez les quantités à chaque réception ou utilisation.",
    ],
    note: "Les quantités et les dates sont saisies manuellement. Les alertes ne remplacent pas les contrôles sanitaires.",
  },
  suppliers: {
    title: "Fournisseurs",
    steps: [
      "Ajoutez le nom d'un fournisseur.",
      "Complétez sa catégorie et ses coordonnées si vous les connaissez.",
      "Associez-le à un produit dans Mes stocks.",
      "Modifiez sa fiche si ses informations changent.",
    ],
  },
  carnet: {
    title: "Mon carnet",
    steps: [
      "Donnez un titre à votre observation, si utile.",
      "Vérifiez ou modifiez la date de l'expérience.",
      "Notez ce que vous avez essayé et ce que vous avez observé.",
      "Enregistrez la note. Vous pourrez la modifier ou la supprimer.",
    ],
    note: "Vous pouvez autoriser Ernesto à consulter une note pour ses réponses. Cette autorisation ne signifie pas qu'il l'utilise à chaque fois.",
  },
};
