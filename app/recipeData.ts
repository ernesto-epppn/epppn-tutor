/* Fiches recettes EPPPN 2025 — transcription structurée, pages 2–20.
   Les pourcentages sont exprimés par rapport à la farine AJOUTÉE.
   Le bassinage « ~ » est indicatif dans le document ; il n'est pas un seuil strict.
   Ne pas supposer l'hydratation du levain lorsque la fiche ne l'indique pas.
   Les dosages personnalisés ne sont jamais présentés comme originaux. */

export type RecipeGroup = "froid" | "direct" | "levain";
export type RecipeMode = "pâtons" | "plaques";
export type RecipeStep = { name: string; detail: string };
export type Recipe = {
  id: string;
  managed?: boolean;
  page: number;
  name: string;
  subtitle?: string;
  group: RecipeGroup;
  kind: "pizza" | "focaccia";
  mode: RecipeMode;
  flour: string;
  flourParts?: {name: string; percent: number}[];
  flourNote?: string;
  sourceHydration?: string;
  water: number;
  bassinage: number;
  salt: number;
  yeast: number;
  levain: number;
  levainHydration: number | null;
  oil: number;
  potato: number;
  defaultPieces?: number;
  pieceWeight?: number;
  baseFlourPerTray?: number;
  baseTrayWidth?: number;
  baseTrayHeight?: number;
  variants?: { id: string; label: string; flourPerTray: number; oil: number }[];
  targetDoughTemp?: string;
  fermentation: string;
  steps: RecipeStep[];
  bake?: string;
  sourceNotes?: string[];
  caution?: string;
};

const pizza = {
  kind:"pizza" as const, mode:"pâtons" as const,
  defaultPieces:8, salt:2, oil:0, potato:0, levain:0,
  levainHydration:null, baseTrayWidth:undefined, baseTrayHeight:undefined,
  baseFlourPerTray:undefined
};
const plaque = {
  kind:"focaccia" as const, mode:"plaques" as const,
  defaultPieces:1, pieceWeight:undefined, salt:2, potato:0,
  baseTrayWidth:60, baseTrayHeight:40
};
const p=(name:string,detail:string):RecipeStep=>({name,detail});

export const EPPPN_RECIPES: Recipe[] = [
  {
    ...pizza,id:"classique-j1",page:2,name:"Pizza classique",subtitle:"J+1 · fermentation au froid",
    group:"froid",flour:"Farine 00 ou 0 · T45–T55 · 230 < W < 300 · P/L 0,55–0,65",
    sourceHydration:"55–65 %",water:55,bassinage:10,yeast:0.4,pieceWeight:260,
    targetDoughTemp:"25 °C",fermentation:"J+1 · froid",
    steps:[p("Pétrissage","8 min + 8 min"),p("Pointage","60 min"),p("Apprêt","≈ 16–24 h au froid ; prolongation selon farine et hydratation"),p("Avant cuisson","> 2 h à température ambiante selon le schéma")],
    sourceNotes:["Autolyse : 30–180 min selon la farine.","Le document indique qu'un pétrissage de faible volume peut nécessiter une adaptation de la levure, sans règle universelle."]
  },
  {
    ...pizza,id:"classique-complete-j1",page:3,name:"Pizza classique & farine complète",
    subtitle:"J+1 · mélange de farines",group:"froid",flour:"Farine 00 / T45–T55 et farine complète type 1 ou 2",
    flourParts:[{name:"Farine blanche",percent:80},{name:"Farine complète",percent:20}],
    flourNote:"20 % de farine complète dans la recette ; le type de farine complète est variable.",
    sourceHydration:"55–65 % (encadré)",water:60,bassinage:10,yeast:0.4,pieceWeight:260,
    targetDoughTemp:"24 °C",fermentation:"J+1 · froid",
    steps:[p("Pétrissage","8 min + 8 min (2e vitesse)"),p("Pointage","60–90 min selon la farine, l'hydratation et la température"),p("Apprêt","≈ 16–24 h au froid, prolongeable selon conditions"),p("Avant cuisson","2–4 h à température ambiante (schéma)")],
    sourceNotes:["Tamiser le son, le torréfier et l'hydrater davantage.","Cuisson plus douce, inférieure à 380 °C, recommandée par la fiche."],
    caution:"L'encadré indique 55–65 % d'hydratation, tandis que les ingrédients indiquent 60 % + ~10 % de bassinage. Les deux indications originales sont conservées."
  },
  {
    ...pizza,id:"napolitaine-j1",page:4,name:"Pizza napolitaine",subtitle:"J+1 · levure fraîche",
    group:"froid",flour:"Farine 00 · W 260–300 · P/L 0,6",
    sourceHydration:"> 65 %",water:65,bassinage:10,yeast:0.4,pieceWeight:300,
    targetDoughTemp:"24–25 °C",fermentation:"J+1 · froid",
    steps:[p("Pétrissage","10 min + 10 min (2e vitesse)"),p("Pointage","60 min puis au froid > 24 h selon farine et hydratation"),p("Apprêt","≈ 3–4 h")],
    bake:"60–90 s · 450–480 °C",
    sourceNotes:["La fiche mentionne une possibilité de +5 % d'eau selon la force de la farine.","Deux poids de pâton cités : 250 g (22–24 cm) ou 300 g (28–30 cm)."]
  },
  {
    ...pizza,id:"t65-j1",page:5,name:"Pizza T65",subtitle:"Meule de pierre · J+1",
    group:"froid",flour:"Farine T65 bio · meule de pierre",
    water:58,bassinage:10,yeast:0.4,pieceWeight:260,targetDoughTemp:"24 °C",fermentation:"J+1 · froid",
    steps:[p("Pétrissage","8 min + 8 min (1re vitesse)"),p("Pointage","60 min ; 1 rabat si nécessaire"),p("Apprêt","16–18 h à 4 °C"),p("Avant cuisson","2–4 h à température ambiante (schéma)")],
    sourceNotes:["La fiche explique l'équilibre élasticité/extensibilité et le rôle des repos."]
  },
  {
    ...pizza,id:"t80-j1",page:6,name:"Pizza T80 / type 1",subtitle:"Meule de pierre · J+1",
    group:"froid",flour:"Farine T80 ou type 1 · meule de pierre",
    water:60,bassinage:10,yeast:0.4,pieceWeight:260,targetDoughTemp:"24 °C",fermentation:"J+1 · froid",
    steps:[p("Pétrissage","8 min + 8 min (1re vitesse)"),p("Pointage","60 min ; 1 rabat si nécessaire"),p("Apprêt","16–18 h à 4 °C"),p("Avant cuisson","2–4 h à température ambiante (schéma)")],
    sourceNotes:["Cuisson plus douce (< 380 °C) recommandée pour cette farine plus complète."]
  },
  {
    ...plaque,id:"focaccia-j1",page:7,name:"Focaccia / pizza à la coupe",subtitle:"Levure · J+1 · plaque",
    group:"froid",flour:"Farine T65 ou T80 · W > 250",
    sourceHydration:"> 70 %",water:60,bassinage:15,yeast:0.4,levain:0,levainHydration:null,oil:8,
    baseFlourPerTray:1400,fermentation:"J+1 · froid",targetDoughTemp:"25 °C",
    variants:[{id:"focaccia",label:"Focaccia",flourPerTray:1400,oil:8},{id:"coupe",label:"Pizza à la coupe",flourPerTray:1200,oil:5}],
    steps:[p("Pétrissage","10 min + 10 min (2e vitesse)"),p("Pointage","2 h (2 rabats) puis au froid 12–14 h minimum"),p("Apprêt","3–4 h")],
    bake:"280 °C · 14 min sur plaque · sole 80 % / ciel 20 %",
    sourceNotes:["La fiche distingue 1 400 g de farine pour la focaccia et 1 200 g pour la pizza à la coupe, pour une plaque de 60 × 40 cm.","L'huile est de 5 % pour la pizza à la coupe et 8 % pour la focaccia."]
  },
  {
    ...pizza,id:"classique-direct",page:8,name:"Pizza classique",subtitle:"Directe · sans froid",
    group:"direct",flour:"Farine 00 ou 0 · T45–T55 · W < 230 · P/L 0,55–0,65",
    sourceHydration:"55–65 %",water:50,bassinage:10,yeast:0.4,pieceWeight:260,
    targetDoughTemp:"24 °C",fermentation:"Directe · ambiante",
    steps:[p("Pétrissage","8 min + 8 min (2e vitesse)"),p("Pointage","60–90 min selon farine et hydratation"),p("Apprêt","4–6 h à 24 °C")],
    sourceNotes:["La fiche propose 0,4 % ou 0,5 % de levure fraîche.","Une farine plus forte peut exiger des repos prolongés."]
  },
  {
    ...pizza,id:"t65-direct",page:9,name:"Pizza T65",subtitle:"Meule de pierre · directe",
    group:"direct",flour:"Farine T65 bio · meule de pierre",
    water:58,bassinage:10,yeast:0.4,pieceWeight:260,targetDoughTemp:"24 °C",
    fermentation:"Directe · ambiante",
    steps:[p("Pétrissage","8 min + 8 min (1re vitesse)"),p("Pointage","60 min"),p("Apprêt","4–6 h à 24 °C")],
    sourceNotes:["La fiche propose 0,4 % ou 0,5 % de levure fraîche."]
  },
  {
    ...pizza,id:"t80-direct",page:10,name:"Pizza T80 / type 1",subtitle:"Meule de pierre · directe",
    group:"direct",flour:"Farine T80 bio · meule de pierre",
    sourceHydration:"> 58 %",water:60,bassinage:10,yeast:0.4,pieceWeight:260,
    targetDoughTemp:"24 °C",fermentation:"Directe · ambiante",
    steps:[p("Pétrissage","6 min + 8 min (1re vitesse)"),p("Pointage","60 min selon la farine et l'hydratation"),p("Apprêt","4–6 h à 24 °C")],
    sourceNotes:["La fiche propose 0,4 % ou 0,5 % de levure fraîche.","Cuisson plus douce (< 380 °C) recommandée."]
  },
  {
    ...pizza,id:"napolitaine-direct",page:11,name:"Pizza napolitaine 2",subtitle:"Directe · longue fermentation ambiante",
    group:"direct",flour:"Farine 00 · W 300–340 · P/L 0,55–0,60",
    sourceHydration:"> 65 %",water:60,bassinage:10,yeast:0.1,pieceWeight:300,
    targetDoughTemp:"23 °C",fermentation:"Directe · ambiante 18–20 °C",
    steps:[p("Pétrissage","6 min + 8 min (2e vitesse)"),p("Pointage","12–16 h à 18–20 °C"),p("Apprêt","4–6 h à 18–20 °C")],
    bake:"60–90 s · 450–480 °C",
    sourceNotes:["La fiche cite 250 g (22–24 cm) et 300 g (28–30 cm)."]
  },
  {
    ...plaque,id:"focaccia-durum",page:12,name:"Focaccia 100 % blé dur",subtitle:"Semoule · sans froid",
    group:"direct",flour:"Semoule de blé dur",
    sourceHydration:"> 56 %",water:55,bassinage:5,yeast:2,oil:10,levain:0,levainHydration:null,
    baseFlourPerTray:1400,fermentation:"Directe · ambiante",targetDoughTemp:"24 °C",
    steps:[p("Autolyse","60 min"),p("Pétrissage","8 min + 5 min (2e vitesse)"),p("Pointage","1 h 30"),p("Apprêt","3 h + 1 h avec garniture")],
    bake:"250 °C · 12 min sur plaque · sole 70 % / ciel 30 %",
    sourceNotes:["La fiche fournit aussi un repère de farine de 1 000 à 1 400 g selon la hauteur visée sur 60 × 40 cm."]
  },
  {
    ...plaque,id:"focaccia-durum-potato",page:13,name:"Focaccia blé dur & pommes de terre",
    subtitle:"Directe · sans froid",group:"direct",flour:"Semoule de blé dur",
    sourceHydration:"> 56 %",water:52,bassinage:4,yeast:2,oil:10,levain:0,levainHydration:null,
    potato:25,baseFlourPerTray:1400,fermentation:"Directe · ambiante",targetDoughTemp:"24 °C",
    steps:[p("Préparation","Semoule et pommes de terre cuites, écrasées et froides ; ajouter levure, eau, huile puis sel"),p("Pétrissage","8 min + 5 min (2e vitesse)"),p("Pointage","1 h 30"),p("Apprêt","3 h + 1 h avec garniture")],
    bake:"250 °C · 12 min sur plaque · sole 70 % / ciel 30 %",
    sourceNotes:["La fiche mentionne « 52 % eau ± 4 % bassinage » : les 4 % sont une marge indicative, non une obligation."],
    caution:"L'eau naturellement contenue dans les pommes de terre n'est pas quantifiée. Le taux affiché concerne uniquement l'eau ajoutée."
  },
  {
    ...pizza,id:"classique-levain-j1",page:14,name:"Pizza au levain",subtitle:"J+1 · passage au froid",
    group:"levain",flour:"Farine 00 ou 0 · T45–T55 · W > 200 · P/L 0,55–0,65",
    water:50,bassinage:10,yeast:0,levain:20,levainHydration:100,pieceWeight:260,
    targetDoughTemp:"24 °C",fermentation:"Levain · J+1",
    steps:[p("Pétrissage","8 min + 8 min (1re vitesse)"),p("Pointage","60 min ; 1 rabat si nécessaire"),p("Apprêt","24 h à 4 °C"),p("Avant cuisson","> 2 h à température ambiante (schéma)")],
    sourceNotes:["Levain à point 100 % d'hydratation, tel qu'indiqué dans l'encadré de la fiche."]
  },
  {
    ...pizza,id:"t65-levain-direct",page:15,name:"Pizza T65 au levain",subtitle:"Meule de pierre · directe",
    group:"levain",flour:"Farine T65 · meule de pierre · semences paysannes",
    water:50,bassinage:10,yeast:0,levain:30,levainHydration:100,pieceWeight:260,
    targetDoughTemp:"25 °C",fermentation:"Levain · ambiante",
    steps:[p("Pétrissage","8 min + 8 min (1re vitesse)"),p("Pointage","60 min à 24 °C ; 1 rabat si nécessaire"),p("Apprêt","4–6 h à 24 °C")],
    sourceNotes:["Levain à point 100 % d'hydratation, tel qu'indiqué dans l'encadré de la fiche.","Cuisson plus douce recommandée pour la farine T65/T80 au levain."]
  },
  {
    ...pizza,id:"t65-levain-j1",page:16,name:"Pizza T65 au levain",subtitle:"Meule de pierre · J+1",
    group:"levain",flour:"Farine T65 · meule de pierre",
    water:50,bassinage:10,yeast:0,levain:20,levainHydration:null,pieceWeight:260,
    targetDoughTemp:"25 °C",fermentation:"Levain · J+1",
    steps:[p("Pétrissage","8 min + 8 min (1re vitesse)"),p("Pointage","60 min ; 1 rabat si nécessaire"),p("Apprêt","60 min + 12–24 h à 4 °C"),p("Avant cuisson","> 2 h à température ambiante (schéma)")],
    sourceNotes:["La fiche ne chiffre pas l'hydratation du levain.","Les farines faibles issues de semences anciennes peuvent ne pas convenir au passage au froid."]
  },
  {
    ...pizza,id:"t80-levain-j1",page:17,name:"Pizza T80 au levain",subtitle:"Meule de pierre · J+1",
    group:"levain",flour:"Farine T80 ou type 1 · meule de pierre",
    water:55,bassinage:10,yeast:0,levain:20,levainHydration:null,pieceWeight:260,
    targetDoughTemp:"24 °C",fermentation:"Levain · J+1",
    steps:[p("Pétrissage","8 min + 8 min (1re vitesse)"),p("Pointage","60 min ; 1 rabat si nécessaire"),p("Apprêt","60 min + 12–24 h à 4 °C"),p("Avant cuisson","> 2 h à température ambiante (schéma)")],
    sourceNotes:["La fiche ne chiffre pas l'hydratation du levain.","Précautions pour les farines faibles et la fermentation au froid."]
  },
  {
    ...pizza,id:"napolitaine-levain-j1",page:18,name:"Pizza napolitaine au levain",subtitle:"J+1 · fermentation longue",
    group:"levain",flour:"Farine 00 · W 260–300 · P/L 0,6",
    sourceHydration:"> 64 %",water:55,bassinage:10,yeast:0,levain:20,levainHydration:null,pieceWeight:300,
    targetDoughTemp:"24 °C",fermentation:"Levain · J+1",
    steps:[p("Pétrissage","10 min + 10 min (2e vitesse)"),p("Pointage","120 min ; 1 rabat si nécessaire ; froid > 24 h selon farine et hydratation"),p("Apprêt","3–4 h à 23–24 °C")],
    bake:"60–90 s · 450–480 °C",
    sourceNotes:["La fiche ne précise pas l'hydratation du levain à point.","La fiche cite 250 g (22–24 cm) ou 300 g (28–30 cm)."]
  },
  {
    ...plaque,id:"coupe-levain-j1",page:19,name:"Pizza à la coupe au levain",
    subtitle:"Focaccia · J+1 · plaque",group:"levain",flour:"Farine T65 ou T80 · W > 250",
    sourceHydration:"> 72 %",water:55,bassinage:15,yeast:0,levain:20,levainHydration:100,
    oil:5,baseFlourPerTray:1200,fermentation:"Levain · J+1",targetDoughTemp:"24 °C",
    steps:[p("Pétrissage","10 min + 10 min (2e vitesse)"),p("Pointage","2 h (2 rabats) puis froid 12–14 h"),p("Apprêt","4–5 h")],
    bake:"280 °C · 12 min sur plaque · sole 80 % / ciel 20 %",
    sourceNotes:["La fiche indique 5 % d'huile pour pizza à la coupe et 8 % pour focaccia.","Levain 100 % H indiqué dans les ingrédients."]
  },
  {
    ...pizza,id:"focaccia-vapeur-levain",page:20,name:"Focaccia vapeur au levain",
    subtitle:"Pré-cuisson vapeur · moule rond",kind:"focaccia",group:"levain",
    flour:"Farine T65 ou type 0/1 · W > 250",water:55,bassinage:15,yeast:0,levain:20,levainHydration:null,
    oil:4,pieceWeight:350,defaultPieces:4,targetDoughTemp:"24–25 °C",fermentation:"Levain · froid + vapeur",
    steps:[p("Pétrissage","8 min + 8 min (2e vitesse)"),p("Pointage","2 h (3 rabats) + 12–14 h au froid"),p("Apprêt","4–5 h"),p("Pré-cuisson","20 min vapeur à 130 °C"),p("Finition","4 min à 220 °C, sur grille sans vapeur")],
    bake:"20 min vapeur · 130 °C, puis 4 min · 220 °C",
    sourceNotes:["350 g par moule rond de 28 cm.","La fiche ne précise pas le taux d'hydratation du levain rafraîchi."]
  }
];

export const EPPPN_RECIPE_COUNT = EPPPN_RECIPES.length;

export const GROUP_LABELS: Record<RecipeGroup,string> = {
  froid:"Levure · J+1",direct:"Levure · directe",levain:"Levain naturel"
};
