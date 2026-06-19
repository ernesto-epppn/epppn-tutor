"use client";
import { createClient } from "@supabase/supabase-js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";

type Speed = "BANCO" | "ECOLE";
type BillingPlan = "monthly" | "yearly";

type Chart =
  | {
      type: "table";
      title: string;
      description: string;
      data: { columns: string[]; rows: (string | number)[][]; note?: string };
    }
  | {
      type: "bar";
      title: string;
      description: string;
      data: { labels: string[]; values: number[]; unit?: string; note?: string };
    }
  | {
      type: "timeline";
      title: string;
      description: string;
      data: { steps: { label: string; minutes: number; purpose: string }[]; note?: string };
    }
  | {
      type: "radar";
      title: string;
      description: string;
      data: { labels: string[]; values: number[]; note?: string };
    }
  | {
      type: "scatter";
      title: string;
      description: string;
      data: {
        x_label: string;
        y_label: string;
        points: { x: number; y: number; label?: string }[];
        note?: string;
      };
    };

type GraphJSON = {
  title: string;
  summary: string;
  confidence: number; // 0..1
  charts: Chart[];
  checklist: Array<{ action: string; expected_effect: string; priority: "high" | "medium" | "low" }>;
  recap_table: { columns: string[]; rows: (string | number)[][]; note?: string };
  questions: string[];
};

type ChatMsg = {
  id: string;
  role: "user" | "ernesto";
  text: string;
  graph?: GraphJSON | null;
  rag?: { used?: number } | null;
  mode?: string | null;
  sourceMention?: boolean;
};

type Project = {
  id: string;
  title: string;
  chat: ChatMsg[];
  updatedAt: number;
};

type UserPersonalProfile = {
  age: string;
  profession: string;
  level: string;
  reason: string;
  preferredLanguage: string;
};

const PROJECTS_STORAGE_KEY = "ernesto_projects_v1";
const PROFILE_STORAGE_KEY_BASE = "ernesto_user_profile_v1";

const EMPTY_PROFILE: UserPersonalProfile = {
  age: "",
  profession: "",
  level: "",
  reason: "",
  preferredLanguage: "",
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function makeProject(title = "Nouvelle demande"): Project {
  return { id: uid(), title, chat: [], updatedAt: Date.now() };
}

function deriveProjectTitle(chat: ChatMsg[], fallback = "Nouvelle demande") {
  const firstUser = chat.find((m) => m.role === "user" && m.text.trim());
  if (!firstUser) return fallback;
  const clean = firstUser.text.replace(/\s+/g, " ").trim();
  return clean.length > 38 ? `${clean.slice(0, 38)}…` : clean;
}

function formatProjectDate(ts: number) {
  try {
    return new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function profileStorageKey(email?: string | null) {
  return `${PROFILE_STORAGE_KEY_BASE}:${email || "anonymous"}`;
}

function subscriptionLabel(usage: any) {
  if (usage?.is_admin) return "Admin";
  if (usage?.is_pro) return "Ernesto Plus";
  return "Essai gratuit";
}

function buildPersonalContext(profile: UserPersonalProfile, email?: string | null) {
  const lines: string[] = [];
  if (email) lines.push(`E-mail utilisateur : ${email}`);
  if (profile.age.trim()) lines.push(`Âge : ${profile.age.trim()}`);
  if (profile.profession.trim()) lines.push(`Profession / activité : ${profile.profession.trim()}`);
  if (profile.level.trim()) lines.push(`Niveau pizza / panification : ${profile.level.trim()}`);
  if (profile.reason.trim()) lines.push(`Pourquoi l’utilisateur utilise Ernesto : ${profile.reason.trim()}`);
  if (profile.preferredLanguage.trim()) lines.push(`Langue ou style préféré : ${profile.preferredLanguage.trim()}`);
  return lines.length ? lines.join("\n") : undefined;
}

const QUICK_QUESTIONS: Array<{ label: string; text: string; category: string }> = [
  { category: "Farines", label: "W260 vs W320", text: "Comparer W260 vs W320 pour fermentation 48h au froid : risques, choix et protocole de contrôle." },
  { category: "Pâte", label: "Pâte collante", text: "Pourquoi ma pâte colle-t-elle trop au banc, et quels réglages concrets puis-je tester ?" },
  { category: "Levain", label: "Levain trop acide", text: "Levain trop acide : comment stabiliser sans perdre la force ?" },
  { category: "Cuisson", label: "Sole trop chaude", text: "Sole trop chaude et dessus pâle : comment équilibrer la cuisson dans un four électrique ?" },
  { category: "Cornicione", label: "Cornicione serré", text: "Cornicione serré, pâte peu extensible : protocole de correction en 48h froid ?" },
  { category: "Hydratation", label: "65% ou 70%", text: "Hydratation 65% ou 70% : comment choisir selon farine, service et cuisson ?" },
  { category: "Fermentation", label: "48h au froid", text: "Comment organiser une fermentation de 48h au froid sans perdre de force ?" },
  { category: "Production", label: "Plan de service", text: "Proposer un plan de production (timeline) pour service du soir avec pâte au froid." },
  { category: "Gestion", label: "Choisir un four", text: "Choisir un four électrique : critères, risques, tests de contrôle à faire ?" },
  { category: "Gestion", label: "Marge Margherita", text: "Pourquoi une Margherita est souvent plus rentable qu’une pizza gourmet très garnie ?" },
  { category: "Coûts", label: "Hausse farine", text: "Impact d’une hausse de 10% du prix de la farine sur la marge : comment raisonner ?" },
  { category: "Pâte", label: "Pâte trop élastique", text: "Ma pâte est trop élastique et revient sans cesse : quelles causes probables et quels correctifs ?" },
  { category: "Pâte", label: "Pâte trop molle", text: "Ma pâte est trop molle en fin d’apprêt : comment corriger le protocole ?" },
  { category: "Alvéolage", label: "Alvéolage faible", text: "Comment améliorer l’alvéolage sans perdre en tenue ni en régularité ?" },
  { category: "Apprêt", label: "Temps d’apprêt", text: "Quel temps d’apprêt viser selon la température ambiante et la force de farine ?" },
  { category: "Sel", label: "Gestion du sel", text: "Quel rôle joue le sel dans la pâte, et comment ajuster son dosage intelligemment ?" },
  { category: "Cuisson", label: "Pizza trop sèche", text: "Pourquoi ma pizza sort-elle sèche malgré une bonne coloration ?" },
  { category: "Cuisson", label: "Pizza trop pâle", text: "Pourquoi ma pizza reste-t-elle pâle et comment ajuster la cuisson ?" },
  { category: "Four", label: "Électrique vs bois", text: "Comparer four électrique et four à bois pour une pizza artisanale régulière." },
  { category: "Méthode", label: "Autolyse", text: "Autolyse : utile ou non dans mon protocole ?" },
  { category: "Méthode", label: "24h vs 72h", text: "Comparer une maturation 24h vs 72h : bénéfices, risques et limites." },
  { category: "Farines", label: "Farines FR vs IT", text: "Farines françaises vs italiennes : comment raisonner au-delà des habitudes ?" },
  { category: "Formats", label: "Teglia vs napolitaine", text: "Différences de logique entre pizza en teglia et pizza napolitaine." },
  { category: "Organisation", label: "Gestion du banc", text: "Comment organiser le banc pour garder régularité, vitesse et confort de travail ?" },
  { category: "Digestibilité", label: "Pizza plus digeste", text: "Quels leviers réels permettent d’améliorer la digestibilité d’une pizza ?" },
  { category: "Levain", label: "Levain faible", text: "Mon levain manque de force : comment le relancer proprement sans le rendre trop acide ?" },
  { category: "Service", label: "Rush du soir", text: "Comment préparer le service du soir pour garder régularité et vitesse sans stress ?" },
  { category: "Boulage", label: "Pâtons irréguliers", text: "Mes pâtons sont irréguliers : quelles conséquences et comment corriger le boulage ?" },
  { category: "Cornicione", label: "Bulles excessives", text: "Pourquoi ai-je de grosses bulles irrégulières sur le cornicione et comment les maîtriser ?" },
  { category: "Hydratation", label: "Eau trop chaude", text: "Quel impact a une eau trop chaude sur le pétrissage et la fermentation ?" },
  { category: "Cuisson", label: "Dessus trop coloré", text: "Pourquoi le dessus colore trop vite alors que le dessous manque encore de cuisson ?" },
  { category: "Méthode", label: "Frasage trop court", text: "Quels signes montrent qu’un frasage est trop court ou au contraire trop poussé ?" },
  { category: "Fermentation", label: "Sur-fermentation", text: "Comment reconnaître une sur-fermentation et quelles marges de correction existent ?" },
  { category: "Organisation", label: "Mise en place", text: "Quelle mise en place conseillez-vous pour garder un service propre et rapide ?" },
  { category: "Farines", label: "Mélange de farines", text: "Comment construire un mélange de farines cohérent selon l’hydratation et la maturation visées ?" },
  { category: "Pâte", label: "Pâte qui se déchire", text: "Pourquoi ma pâte se déchire à l’ouverture et quels réglages tester en priorité ?" },
];

function shuffleQuestions<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function badgeStyle(p: "high" | "medium" | "low"): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #ddd",
    display: "inline-flex",
    alignItems: "center",
    whiteSpace: "nowrap",
  };
  if (p === "high") return { ...base, borderColor: "#f0c0c0", background: "#fff6f6" };
  if (p === "medium") return { ...base, borderColor: "#f0e0b0", background: "#fffaf0" };
  return { ...base, borderColor: "#cfe7cf", background: "#f6fff6" };
}

const ui = {
  page: {
    width: "100%",
    minHeight: "100svh",
    padding: 18,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    color: "#0f172a",
    background:
      "radial-gradient(circle at top left, rgba(244,114,182,0.08), transparent 28%), radial-gradient(circle at top right, rgba(99,102,241,0.08), transparent 26%), #fffaf5",
  } as React.CSSProperties,
  pill: {
    border: "1px solid #e2e8f0",
    borderRadius: 999,
    padding: "10px 14px",
    background: "rgba(255,255,255,0.96)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
    color: "#111",
  } as React.CSSProperties,
  btn: {
    padding: "13px 15px",
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    cursor: "pointer",
    background: "white",
    color: "#111",
    fontSize: 15,
    fontWeight: 900,
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    padding: 14,
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    outline: "none",
    fontSize: 16, // evita zoom iOS
    lineHeight: 1.45,
    background: "white",
    color: "#111",
  } as React.CSSProperties,
  iconBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    background: "white",
    color: "#111",
    cursor: "pointer",
    fontSize: 18,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    flex: "0 0 auto",
  } as React.CSSProperties,
};

function startDictation(onText: (txt: string) => void) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.lang = navigator.language || "fr-FR";
  rec.interimResults = true;
  rec.continuous = false;

  rec.onresult = (e: any) => {
    let txt = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      txt += e.results[i][0].transcript;
    }
    onText(txt.trim());
  };

  rec.start();
  return () => rec.stop();
}

async function compressImageToJpeg(
  file: File,
  maxW = 1280,
  quality = 0.72
): Promise<File> {
  const img = await createImageBitmap(file);

  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, w, h);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality
    );
  });

  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}

export default function Page() {
  const [speed, setSpeed] = useState<Speed>("BANCO");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectsHydrated, setProjectsHydrated] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  // 🍕 Loader progress (timeline)
  const [loadingMs, setLoadingMs] = useState(0);
  const [pizzaDone, setPizzaDone] = useState(false);

  // ---- auth + paywall ----
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    return createClient(url, anon);
  }, []);

  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [payingPlan, setPayingPlan] = useState<null | BillingPlan>(null);

  // usage info (for banner)
  const [usage, setUsage] = useState<null | {
    used: number;
    remaining: number;
    trial_started_at?: string;
    trial_ends_at?: string;
    trial_days_total?: number;
    trial_days_remaining?: number;
    trial_active?: boolean;
    safety_limit?: number;
    usage_cost?: number;
    is_pro?: boolean;
    is_admin?: boolean;
  }>(null);

  // paywall payload (when 402)
  const [paywall, setPaywall] = useState<any>(null);

  // personnalisation légère : stockée localement pour la V1, transmise comme contexte à Ernesto
  const [profileOpen, setProfileOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [personalProfile, setPersonalProfile] = useState<UserPersonalProfile>(EMPTY_PROFILE);
  const [profileSavedAt, setProfileSavedAt] = useState<number | null>(null);

  // édition des projets
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectTitle, setEditingProjectTitle] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (payment === "success") {
      setAuthInfo("Paiement reçu. L’activation peut prendre quelques secondes, le temps que Stripe confirme l’abonnement.");
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (payment === "cancel") {
      setAuthInfo("Paiement annulé. Vous pouvez reprendre l’abonnement à tout moment.");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!session?.user?.email) {
      setPersonalProfile(EMPTY_PROFILE);
      setProfileOpen(false);
      return;
    }
    try {
      const raw = window.localStorage.getItem(profileStorageKey(session.user.email));
      const parsed = raw ? JSON.parse(raw) : null;
      setPersonalProfile({ ...EMPTY_PROFILE, ...(parsed || {}) });
    } catch {
      setPersonalProfile(EMPTY_PROFILE);
    }
  }, [session?.user?.email]);

  useEffect(() => {
    if (!session?.user?.email) return;
    try {
      window.localStorage.setItem(profileStorageKey(session.user.email), JSON.stringify(personalProfile));
      setProfileSavedAt(Date.now());
    } catch {
      // La personnalisation reste utilisable même si le navigateur refuse localStorage.
    }
  }, [personalProfile, session?.user?.email]);

  async function sendMagicLink() {
    setAuthInfo(null);
    const e = email.trim();
    if (!e) return setAuthInfo("Indiquez votre adresse e-mail.");
    const { error } = await supabase.auth.signInWithOtp({
      email: e,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) return setAuthInfo(error.message);
    setAuthInfo("Lien envoyé. Ouvrez votre boîte mail et cliquez sur le lien de connexion sécurisé.");
  }

  async function logout() {
    await supabase.auth.signOut();
    setSession(null);
    setAuthInfo(null);
    setUsage(null);
    setPaywall(null);
  }


  async function startCheckout(plan: BillingPlan) {
    if (!session?.access_token) {
      setAuthInfo("Connectez-vous par e-mail avant d’activer Ernesto Plus.");
      return;
    }
    setPayingPlan(plan);
    setAuthInfo(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Impossible de créer la session de paiement.");
      }
      window.location.href = data.url;
    } catch (err: any) {
      setAuthInfo(err?.message || "Erreur pendant l’ouverture du paiement Stripe.");
      setPayingPlan(null);
    }
  }

  // camera + mic
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const stopDictRef = useRef<null | (() => void)>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const quickRowRef = useRef<HTMLDivElement | null>(null);
  const [quickQuestions, setQuickQuestions] = useState(QUICK_QUESTIONS);
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [pauseQuickScroll, setPauseQuickScroll] = useState(false);
  const quickDirectionRef = useRef<1 | -1>(1);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
      const parsed: Project[] = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length) {
        const cleaned = parsed
          .filter((p) => p?.id && typeof p.title === "string")
          .map((p) => ({ ...p, chat: Array.isArray(p.chat) ? p.chat : [], updatedAt: Number(p.updatedAt) || Date.now() }));
        setProjects(cleaned);
        setActiveProjectId(cleaned[0]?.id ?? null);
        setChat(cleaned[0]?.chat ?? []);
      } else {
        const first = makeProject();
        setProjects([first]);
        setActiveProjectId(first.id);
      }
    } catch {
      const first = makeProject();
      setProjects([first]);
      setActiveProjectId(first.id);
    } finally {
      setProjectsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!projectsHydrated) return;
    try {
      window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects.slice(0, 30)));
    } catch {
      // localStorage can fail in private mode; Ernesto still works without project persistence.
    }
  }, [projects, projectsHydrated]);

  useEffect(() => {
    if (!projectsHydrated || !activeProjectId) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              chat,
              title: deriveProjectTitle(chat, p.title),
              updatedAt: Date.now(),
            }
          : p
      )
    );
  }, [chat, activeProjectId, projectsHydrated]);

  useEffect(() => {
    if (!selectedImage) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedImage);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

  useEffect(() => {
    if (!loading) {
    setLoadingMs(0);
    return;
    }
    const t0 = Date.now();
    const id = window.setInterval(() => setLoadingMs(Date.now() - t0), 100);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    setQuickQuestions(shuffleQuestions(QUICK_QUESTIONS));
  }, []);

  useEffect(() => {
    const el = quickRowRef.current;
    if (!el || pauseQuickScroll) return;

    const id = window.setInterval(() => {
      if (!quickRowRef.current) return;
      const node = quickRowRef.current;
      const maxScroll = node.scrollWidth - node.clientWidth;

      if (maxScroll <= 0) return;

      if (node.scrollLeft >= maxScroll - 4) quickDirectionRef.current = -1;
      if (node.scrollLeft <= 4) quickDirectionRef.current = 1;

      node.scrollBy({ left: quickDirectionRef.current * 0.10, behavior: "auto" });
    }, 1560);

    return () => window.clearInterval(id);
  }, [pauseQuickScroll]);

  async function askTutor(text: string) {
    const userText = text.trim();
    if (!userText || loading) return;

    // must be logged in (we need bearer token)
    if (!session?.access_token) {
      setAuthInfo("Connectez-vous pour utiliser Ernesto. L’essai gratuit de 10 jours est inclus.");
      return;
    }

    setPaywall(null); // close paywall on new ask attempt
    const responseIndex = chat.filter((m) => m.role === "ernesto").length + 1;
    setPizzaDone(false);
    setChat((prev) => [...prev, { id: uid(), role: "user", text: userText }]);
    setLoading(true);

    try {
      let res: Response;

      const contextText = buildPersonalContext(personalProfile, session?.user?.email);

      // se c'è foto -> FormData
      if (selectedImage) {
        const fd = new FormData();
        fd.append("message", userText);
        fd.append("speed", speed);
        fd.append("responseIndex", String(responseIndex));
        fd.append("isFirstTurn", String(chat.length === 0));
        if (contextText) fd.append("contextText", contextText);
        fd.append("image", selectedImage);

        res = await fetch("/api/tutor", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: fd,
        });

        setSelectedImage(null);
      } else {
        // JSON come prima
        res = await fetch("/api/tutor", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: userText,
            responseIndex,
            isFirstTurn: chat.length === 0,
            speed,
            contextText,
          }),
        });
      }

      const data = await res.json();

      // 401: not logged / invalid session
      if (res.status === 401) {
        setAuthInfo("Session invalide. Reconnectez-vous avec le lien magique.");
        return;
      }

      // 402: paywall
      if (res.status === 402 && data?.paywall) {
        setPaywall(data);
        if (data?.usage) setUsage(data.usage);
        return;
      }

      if (!res.ok) throw new Error(data?.error ?? `Erreur serveur (${res.status})`);

      // usage banner update
      if (data?.usage) setUsage(data.usage);

      // compat: alcuni backend rispondono con answer_fr
      const text_fr: string = data?.text_fr ?? data?.answer_fr ?? data?.text ?? "";
      const graph: GraphJSON | null = data?.graph ?? null;

      setPizzaDone(true);
      setChat((prev) => [
        ...prev,
        {
          id: uid(),
          role: "ernesto",
          text: text_fr,
          graph,
          rag: data?.rag ?? null,
          mode: data?.mode ?? speed,
          sourceMention: Boolean(data?.source_mention),
        },
      ]);
      setMessage("");
    } catch (err: any) {
      setChat((prev) => [
        ...prev,
        {
          id: uid(),
          role: "ernesto",
          text: `Désolé — erreur technique : ${err?.message ?? "Erreur inconnue"}`,
        },
      ]);
    } finally {
      window.setTimeout(() => {
        setLoading(false);
        setPizzaDone(false);
      }, 620);
    }
  }

  function newConversation() {
    const p = makeProject();
    setProjects((prev) => [p, ...prev].slice(0, 30));
    setActiveProjectId(p.id);
    setChat([]);
    setMessage("");
    setSelectedImage(null);
    setPaywall(null);
    setSelectedQuestion(null);
    setProjectsOpen(false);
  }

  function selectProject(id: string) {
    const p = projects.find((item) => item.id === id);
    if (!p) return;
    setActiveProjectId(id);
    setChat(p.chat ?? []);
    setMessage("");
    setSelectedImage(null);
    setPaywall(null);
    setSelectedQuestion(null);
    setProjectsOpen(false);
  }

  function deleteProject(id: string) {
    const target = projects.find((p) => p.id === id);
    const label = target?.title || "ce projet";
    if (!window.confirm(`Supprimer « ${label} » ?`)) return;
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (!next.length) {
        const fresh = makeProject();
        window.setTimeout(() => {
          setActiveProjectId(fresh.id);
          setChat([]);
        }, 0);
        return [fresh];
      }
      if (id === activeProjectId) {
        window.setTimeout(() => {
          setActiveProjectId(next[0].id);
          setChat(next[0].chat ?? []);
        }, 0);
      }
      return next;
    });
  }

  function startRenameProject(p: Project) {
    setEditingProjectId(p.id);
    setEditingProjectTitle(p.title || "Nouvelle demande");
  }

  function saveProjectTitle(id: string) {
    const clean = editingProjectTitle.replace(/\s+/g, " ").trim();
    if (!clean) return;
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, title: clean.slice(0, 80), updatedAt: Date.now() } : p))
    );
    setEditingProjectId(null);
    setEditingProjectTitle("");
  }

  function renameActiveProject() {
    const active = projects.find((p) => p.id === activeProjectId);
    if (active) startRenameProject(active);
    setProjectsOpen(true);
  }

  function resetPersonalProfile() {
    setPersonalProfile(EMPTY_PROFILE);
  }

  function scrollQuick(dx: number) {
    if (!quickRowRef.current) return;
    quickDirectionRef.current = dx > 0 ? 1 : -1;
    quickRowRef.current.scrollBy({ left: dx, behavior: "smooth" });
  }

  function handleQuestionClick(q: { label: string; text: string; category: string }) {
    setSelectedQuestion(q.label);
    setMessage(q.text);
  }

  async function handleQuestionDoubleClick(q: { label: string; text: string; category: string }) {
    setSelectedQuestion(q.label);
    setMessage(q.text);
    await askTutor(q.text);
  }

  function toggleDictation() {
    if (dictating) {
      stopDictRef.current?.();
      stopDictRef.current = null;
      setDictating(false);
      return;
    }

    const stop = startDictation((txt) => {
      if (!txt) return;
      setMessage((prev) => (prev ? `${prev} ${txt}` : txt));
    });

    if (!stop) {
      alert("La dictée vocale n’est pas prise en charge par ce navigateur.");
      return;
    }

    stopDictRef.current = stop;
    setDictating(true);

    window.setTimeout(() => {
      stopDictRef.current?.();
      stopDictRef.current = null;
      setDictating(false);
    }, 12000);
  }

  const trialDaysTotal = usage?.trial_days_total ?? 10;
  const trialDaysRemaining = usage?.trial_days_remaining ?? null;

  const usageLine =
    usage?.is_admin
      ? "Mode administrateur — accès illimité"
      : usage?.is_pro
      ? "Ernesto Plus activé — accès illimité"
      : usage
      ? `Essai gratuit : ${trialDaysRemaining ?? "—"} jour${trialDaysRemaining === 1 ? "" : "s"} restant${trialDaysRemaining === 1 ? "" : "s"}${usage.trial_ends_at ? ` — jusqu’au ${new Date(usage.trial_ends_at).toLocaleDateString("fr-FR")}` : ""}`
      : null;

  const usagePercent =
    usage && !usage.is_pro && !usage.is_admin
      ? Math.max(0, Math.min(100, ((trialDaysRemaining ?? trialDaysTotal) / trialDaysTotal) * 100))
      : 100;

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const questionByLabel = (label: string) =>
    quickQuestions.find((q) => q.label === label) || QUICK_QUESTIONS.find((q) => q.label === label);
  const starterGroups = [
    {
      eyebrow: "Qualité produit",
      title: "Stabiliser la pâte",
      text: "Pour diagnostiquer les problèmes de tenue, d’extensibilité, de fermentation ou de cornicione.",
      items: ["Pâte collante", "Sur-fermentation", "Cornicione serré", "Alvéolage faible"],
    },
    {
      eyebrow: "Four & service",
      title: "Gagner en régularité",
      text: "Pour raisonner cuisson, matériel, débit de service et confort de travail au banc.",
      items: ["Choisir un four", "Électrique vs bois", "Gestion du banc", "Rush du soir"],
    },
    {
      eyebrow: "Activité",
      title: "Piloter le restaurant",
      text: "Pour relier les choix techniques à l’organisation, aux coûts, aux marges et à l’ouverture d’une activité.",
      items: ["Marge Margherita", "Hausse farine", "Plan de service", "Mise en place"],
    },
  ].map((group) => ({
    ...group,
    questions: group.items.map(questionByLabel).filter(Boolean) as Array<{ label: string; text: string; category: string }>,
  }));

  return (
    <main className="appRoot" style={ui.page}>
      <style>{`
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        input, textarea, select, button { font: inherit; color: #172033; }
        input, textarea, select { background: #ffffff; -webkit-text-fill-color: #172033; caret-color: #172033; color-scheme: light; }
        button { -webkit-tap-highlight-color: transparent; }
        button:disabled { cursor: not-allowed; }
        .appRoot {
          min-height: 100svh;
          overflow-x: hidden;
          background:
            radial-gradient(circle at 5% 0%, rgba(81, 99, 58, 0.09), transparent 34%),
            radial-gradient(circle at 96% 8%, rgba(190, 124, 68, 0.10), transparent 30%),
            linear-gradient(180deg, #fbfaf6 0%, #f7f3ea 100%) !important;
        }
        .appFrame {
          width: min(100%, 1360px);
          margin: 0 auto;
          display: grid;
          grid-template-columns: 260px minmax(0, 1fr);
          gap: 20px;
          align-items: start;
        }
        .workspace {
          min-width: 0;
          display: grid;
          gap: 14px;
        }
        .workspace.noComposer { padding-bottom: 0; }
        .mobileOnly { display: none; }
        .desktopOnlyInline { display: inline; }

        .projectRail {
          position: sticky;
          top: 18px;
          height: calc(100svh - 36px);
          overflow: hidden;
          display: grid;
          grid-template-rows: auto auto 1fr auto;
          border: 1px solid rgba(86, 96, 67, 0.16);
          border-radius: 28px;
          background: rgba(255, 254, 250, 0.86);
          backdrop-filter: blur(18px);
          box-shadow: 0 20px 60px rgba(35, 41, 28, 0.08);
          padding: 14px;
        }
        .railBrand {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 2px 14px;
          border-bottom: 1px solid rgba(86,96,67,.12);
        }
        .railBrandMark {
          width: 42px;
          height: 42px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          background: #344422;
          color: #fff;
          -webkit-text-fill-color: #fff;
          font-weight: 950;
          letter-spacing: -0.08em;
        }
        .railBrandText { min-width: 0; }
        .railBrandTitle { font-size: 14px; font-weight: 950; letter-spacing: -0.02em; }
        .railBrandSub { margin-top: 2px; font-size: 11px; line-height: 1.28; color: #6a725f; font-weight: 750; }
        .projectRailHeader { padding: 14px 2px 8px; }
        .projectTitleSmall { font-size: 12px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; color: #64705a; }
        .projectSub { font-size: 12px; line-height: 1.35; color: #7a8172; margin-top: 4px; }
        .projectNew {
          width: 100%;
          min-height: 44px;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid rgba(52,68,34,0.16);
          background: #172033;
          color: white;
          -webkit-text-fill-color: white;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 12px 28px rgba(23,32,51,.14);
          margin: 4px 0 12px;
        }
        .projectList {
          min-height: 0;
          overflow: auto;
          display: grid;
          align-content: start;
          gap: 8px;
          padding-right: 2px;
        }
        .projectList::-webkit-scrollbar { width: 6px; }
        .projectList::-webkit-scrollbar-thumb { background: rgba(86,96,67,.18); border-radius: 999px; }
        .projectItem {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          text-align: left;
          border: 1px solid transparent;
          background: rgba(255,255,255,0.64);
          border-radius: 18px;
          padding: 10px;
          cursor: pointer;
          transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
        }
        .projectItem:hover { background: rgba(255,255,255,.94); border-color: rgba(86,96,67,.13); transform: translateY(-1px); }
        .projectItem.active {
          border-color: rgba(52,68,34,0.22);
          background: linear-gradient(180deg, rgba(241,245,230,.94), rgba(255,255,255,.86));
        }
        .projectItemTitle { font-size: 13px; line-height: 1.25; font-weight: 850; color:#172033; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
        .projectMeta { font-size: 11px; color: #7a8172; margin-top: 5px; }
        .projectActions { display:flex; gap:6px; align-items:flex-start; justify-content:flex-end; }
        .editIconBtn,
        .projectDelete,
        .drawerClose {
          width: 30px; height: 30px; display:inline-flex; align-items:center; justify-content:center;
          border-radius: 11px; border: 1px solid rgba(86,96,67,.14); background: rgba(255,255,255,.82);
          color:#566043; -webkit-text-fill-color:#566043; cursor:pointer; font-size: 14px; font-weight: 950; line-height: 1;
        }
        .projectDelete { color:#9a3412; -webkit-text-fill-color:#9a3412; }
        .drawerClose { display:none; }
        .miniBtn {
          min-height: 32px;
          padding: 7px 10px;
          border-radius: 12px;
          border: 1px solid rgba(86,96,67,0.16);
          background: rgba(255,255,255,0.84);
          color:#172033;
          -webkit-text-fill-color:#172033;
          cursor:pointer;
          font-size: 12px;
          font-weight: 850;
        }
        .projectRenameBox { grid-column: 1 / -1; display:grid; gap:8px; }
        .projectRenameInput {
          width:100%; padding: 10px 11px; border-radius: 13px; border: 1px solid rgba(86,96,67,.22);
          background:#fff; color:#172033; -webkit-text-fill-color:#172033; font-size: 15px;
        }
        .sidebarBrand {
          margin-top: 14px;
          padding: 14px 8px 8px;
          border-top: 1px solid rgba(86,96,67,.12);
          display: grid;
          gap: 12px;
          justify-items: center;
        }
        .sidebarLogoEpppn { width: 132px; max-width: 88%; height:auto; object-fit:contain; display:block; opacity: .82; }
        .sidebarLogoErnesto { width: 132px; max-width: 88%; height:auto; object-fit:contain; display:block; opacity: .82; }
        .railFooterNote { font-size: 11px; line-height: 1.35; color: #7a8172; text-align: center; }

        .mobileProjectBar { display:none; }
        .mobileProjectBtn {
          flex: 1; min-height: 46px; display:flex; align-items:center; justify-content:space-between; gap: 10px;
          padding: 10px 12px; border-radius: 16px; border: 1px solid rgba(86,96,67,.16);
          background: rgba(255,255,255,.9); box-shadow: 0 10px 26px rgba(15,23,42,0.05); cursor:pointer; font-weight: 900;
        }

        .topBar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border: 1px solid rgba(86,96,67,.14);
          background: rgba(255,255,255,.78);
          backdrop-filter: blur(16px);
          border-radius: 24px;
          padding: 12px 14px;
          box-shadow: 0 18px 46px rgba(35,41,28,.06);
        }
        .statusCluster { display:flex; align-items:center; gap: 11px; min-width: 0; }
        .planBadge,
        .softBadge {
          display:inline-flex; align-items:center; gap:8px; padding: 7px 11px; border-radius:999px; font-size:12px; font-weight:900; letter-spacing:.01em;
          border:1px solid rgba(86,96,67,.16); background:rgba(255,255,255,.82); color:#172033; -webkit-text-fill-color:#172033;
        }
        .planBadge.green { background:#eef4e6; border-color: rgba(52,68,34,.18); color:#344422; -webkit-text-fill-color:#344422; }
        .userEmail { font-weight: 950; font-size: 14px; word-break: break-word; }
        .userMeta { margin-top: 3px; font-size: 12px; color: #6a725f; line-height:1.35; }
        .topActions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }

        .profilePanel,
        .statusCard {
          border: 1px solid rgba(86,96,67,.14);
          border-radius: 24px;
          background: rgba(255,255,255,.82);
          backdrop-filter: blur(16px);
          box-shadow: 0 18px 46px rgba(35,41,28,.06);
          color: #172033;
          padding: 16px;
        }
        .profilePanel { display:grid; gap: 10px; }
        .profileGrid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; }
        .profileField { display:grid; gap:6px; }
        .profileLabel { font-size:12px; font-weight:900; color:#6a725f; }
        .profileInput, .profileTextarea {
          width:100%; border: 1px solid rgba(86,96,67,.18); border-radius: 14px; background:#fff; color:#172033;
          -webkit-text-fill-color:#172033; font-size:16px; padding: 12px 13px; outline:none;
        }
        .profileTextarea { min-height: 74px; resize: vertical; line-height:1.45; }

        .heroShell {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(86,96,67,.14);
          border-radius: 34px;
          padding: 30px;
          background:
            linear-gradient(135deg, rgba(255,255,255,.94), rgba(255,252,244,.88)),
            radial-gradient(circle at 84% 20%, rgba(190,124,68,.14), transparent 32%);
          box-shadow: 0 26px 70px rgba(35,41,28,.08);
        }
        .heroShell::after {
          content: "";
          position: absolute;
          right: -120px;
          top: -140px;
          width: 330px;
          height: 330px;
          border-radius: 999px;
          border: 1px solid rgba(190,124,68,.14);
          background: rgba(255,255,255,.22);
          pointer-events: none;
        }
        .heroKicker { font-size: 12px; font-weight: 950; letter-spacing: .13em; text-transform: uppercase; color:#566043; }
        .heroTitle { max-width: 900px; font-size: clamp(42px, 6vw, 76px); line-height: .92; margin: 12px 0 0; letter-spacing: -0.07em; color:#101827; }
        .heroIntro { max-width: 820px; margin-top: 18px; color: #3d465a; font-size: 17px; line-height: 1.62; }
        .heroActionRow { display:flex; align-items:center; gap: 10px; flex-wrap: wrap; margin-top: 22px; }
        .primaryHeroBtn {
          min-height: 44px;
          padding: 12px 16px;
          border-radius: 999px;
          border: 1px solid #172033;
          background: #172033;
          color: white;
          -webkit-text-fill-color: white;
          font-weight: 950;
          cursor: pointer;
          box-shadow: 0 14px 30px rgba(23,32,51,.16);
        }
        .heroProof {
          display:grid;
          grid-template-columns: repeat(3, minmax(0,1fr));
          gap: 10px;
          margin-top: 24px;
        }
        .proofItem {
          border: 1px solid rgba(86,96,67,.13);
          border-radius: 18px;
          background: rgba(255,255,255,.62);
          padding: 12px;
        }
        .proofTitle { font-size: 13px; font-weight: 950; color:#172033; }
        .proofText { font-size: 12px; line-height: 1.42; color:#68715f; margin-top: 5px; }

        .activeProjectStrip {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap: 12px;
          border: 1px solid rgba(86,96,67,.13);
          border-radius: 20px;
          background: rgba(255,255,255,.72);
          padding: 11px 13px;
        }
        .activeProjectTitleRow { display:flex; align-items:center; gap:8px; min-width:0; }
        .activeProjectTitleText { font-weight: 950; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .starterPanel {
          border: 1px solid rgba(86,96,67,.13);
          border-radius: 28px;
          background: rgba(255,255,255,.72);
          box-shadow: 0 18px 50px rgba(35,41,28,.055);
          padding: 18px;
        }
        .sectionEyebrow { font-size: 12px; font-weight:950; letter-spacing:.11em; text-transform: uppercase; color:#566043; }
        .sectionTitleRow { display:flex; justify-content:space-between; align-items:flex-end; gap: 16px; flex-wrap:wrap; }
        .sectionTitle { font-size: 22px; line-height: 1.05; font-weight: 950; letter-spacing: -0.035em; color:#172033; }
        .sectionHelp { font-size: 13px; color:#7a8172; }
        .starterGrid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; margin-top: 14px; }
        .starterCard {
          display:grid;
          align-content: space-between;
          min-height: 210px;
          border: 1px solid rgba(86,96,67,.13);
          border-radius: 24px;
          background: linear-gradient(180deg, rgba(255,255,255,.92), rgba(250,248,242,.82));
          padding: 16px;
          box-shadow: 0 12px 32px rgba(35,41,28,.05);
        }
        .starterCardKicker { font-size: 11px; text-transform: uppercase; letter-spacing:.12em; color:#8b5e34; font-weight:950; }
        .starterCardTitle { font-size: 20px; line-height: 1.05; font-weight:950; letter-spacing:-.035em; margin-top: 9px; color:#172033; }
        .starterCardText { font-size: 13px; line-height:1.48; color:#626a59; margin-top: 9px; }
        .starterPills { display:flex; gap: 7px; flex-wrap: wrap; margin-top: 16px; }
        .starterPill {
          border: 1px solid rgba(86,96,67,.14);
          background: rgba(255,255,255,.86);
          border-radius: 999px;
          padding: 8px 10px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 850;
          color:#172033;
          -webkit-text-fill-color:#172033;
        }
        .starterPill:hover { background:#172033; color:#fff; -webkit-text-fill-color:#fff; }

        .quickSection { border: 1px solid rgba(86,96,67,.12); border-radius: 24px; background: rgba(255,255,255,.58); padding: 14px; }
        .quickSectionHeader { display:flex; justify-content:space-between; align-items:baseline; gap: 12px; flex-wrap:wrap; margin-bottom: 12px; }
        .mobileFaqToggle { display:none; }
        .quickWrap { display:grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items:center; }
        .quickNavBtn {
          border: 1px solid rgba(86,96,67,.14); background: rgba(255,255,255,0.86); width: 38px; height: 38px; border-radius: 13px; cursor: pointer; font-weight: 950;
        }
        .quickRow { display:flex; gap: 10px; overflow-x:auto; padding-bottom: 4px; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .quickRow::-webkit-scrollbar { display:none; }
        .quickCard {
          flex: 0 0 222px;
          border-radius: 18px;
          padding: 12px;
          cursor:pointer;
          text-align:left;
          border: 1px solid rgba(86,96,67,.13);
          background: rgba(255,255,255,.82);
          color:#172033;
          -webkit-text-fill-color:#172033;
          transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
        }
        .quickCard:hover { transform: translateY(-1px); background:#fff; border-color: rgba(86,96,67,.22); }
        .quickCard.selected { background:#172033; color:#fff; -webkit-text-fill-color:#fff; border-color:#172033; }
        .quickKicker { font-size:10px; font-weight:950; letter-spacing:.1em; text-transform:uppercase; opacity:.62; }
        .quickLabel { font-weight:950; font-size:14px; margin-top:7px; line-height:1.2; }
        .quickText { margin-top:7px; font-size:12px; line-height:1.42; opacity:.76; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

        .conversationShell {
          min-height: 280px;
          border: 1px solid rgba(86,96,67,.12);
          border-radius: 28px;
          background: rgba(255,255,255,.55);
          padding: 14px;
        }
        .emptyHint { color:#6a725f; font-size: 14px; line-height:1.5; padding: 8px 4px; }
        .bubbleWrap { display:flex; margin: 12px 0; }
        .bubble {
          max-width: 86%;
          border-radius: 24px;
          padding: 14px;
          border: 1px solid rgba(86,96,67,.12);
          box-shadow: 0 14px 34px rgba(35,41,28,.045);
          line-height: 1.62;
          white-space: pre-wrap;
          background: rgba(255,255,255,.86);
          color:#172033;
        }
        .bubble.user { margin-left:auto; background:#172033; color:white; -webkit-text-fill-color:white; border-color:#172033; max-width: 78%; }
        .bubble.ernesto { margin-right:auto; max-width:100%; width:100%; background:rgba(255,255,255,.88); animation: ernestoIn 260ms ease; }
        .answerText { display:grid; gap:8px; }
        .answerPara { margin:0; font-size:15px; line-height:1.75; color:#172033; }
        .answerHeading { margin-top:8px; font-weight:950; font-size:15px; color:#344422; letter-spacing:-.01em; }

        .sectionShell {
          border-radius: 22px;
          border: 1px solid rgba(86,96,67,.12);
          overflow: hidden;
          background: rgba(255,255,255,.86);
          box-shadow: 0 12px 32px rgba(35,41,28,.045);
        }
        .sectionHeader { padding: 12px 14px; font-weight:950; color:#172033; letter-spacing:-.01em; }
        .sectionBody { padding: 14px; border-top: 1px solid rgba(86,96,67,.10); color:#172033; }
        .hAnswer { background:#eef4e6; border-bottom:1px solid rgba(52,68,34,.14); }
        .hSynth  { background:rgba(232,237,244,.95); border-bottom:1px solid rgba(86,96,67,.13); }
        .hCheck  { background:rgba(241,245,230,.95); border-bottom:1px solid rgba(86,96,67,.13); }
        .hRecap  { background:rgba(250,248,242,.95); border-bottom:1px solid rgba(86,96,67,.13); }
        .hQues   { background:rgba(255,247,237,.95); border-bottom:1px solid rgba(190,124,68,.13); }

        .composer {
          position: sticky;
          bottom: 0;
          z-index: 20;
          padding: 12px 0 calc(12px + env(safe-area-inset-bottom));
          background: linear-gradient(180deg, rgba(247,243,234,0), rgba(247,243,234,.98) 22%);
        }
        .composerPanel {
          border: 1px solid rgba(86,96,67,.16);
          border-radius: 26px;
          background: rgba(255,255,255,.92);
          backdrop-filter: blur(18px);
          box-shadow: 0 -10px 60px rgba(35,41,28,.10);
          padding: 12px;
          display: grid;
          gap: 10px;
        }
        .composerModeRow { display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:space-between; }
        .composerHint { font-size: 12px; color:#7a8172; }
        .responseSelect { padding: 10px 12px; border-radius: 14px; border: 1px solid rgba(86,96,67,.16); font-size: 14px; background:#fff; color:#172033; }
        .mobileAskLabel { display:none; }
        .askGrid { display:grid; grid-template-columns: 46px 1fr 46px; gap: 10px; align-items:end; }
        .appRoot textarea {
          border-color: rgba(86,96,67,.18) !important;
          border-radius: 18px !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.7);
        }
        .sendButton {
          width:100%; min-height: 48px; border-radius: 18px; border:1px solid #172033; background:#172033; color:#fff; -webkit-text-fill-color:#fff;
          font-weight:950; cursor:pointer;
        }
        .imagePreviewCard {
          display:grid; grid-template-columns: 64px 1fr auto; gap: 10px; align-items:center;
          padding: 9px; border: 1px solid rgba(86,96,67,.14); border-radius: 18px; background: rgba(255,255,255,.88);
        }
        .imagePreviewCard img { width:64px; height:64px; object-fit:cover; border-radius:14px; border:1px solid rgba(86,96,67,.12); display:block; }
        .imagePreviewTitle { font-weight:900; font-size:13px; }
        .imagePreviewMeta { font-size:12px; color:#7a8172; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .attachX { border:1px solid rgba(86,96,67,.14); border-radius:999px; width:28px; height:28px; cursor:pointer; background:#fff; }

        .pizzaLoad{ display:grid; gap:8px; padding:12px 14px; border: 1px solid rgba(251,146,60,0.30); background: linear-gradient(180deg, rgba(255,247,237,0.96), rgba(255,237,213,0.82)); border-radius: 18px; box-shadow: 0 10px 30px rgba(154,52,18,0.10); overflow: hidden; }
        .pizzaRunway{ position: relative; height: 42px; border-radius: 999px; background: rgba(255,255,255,0.72); border: 1px solid rgba(251,146,60,0.18); overflow: hidden; }
        .pizzaMotion{ position:absolute; top:50%; transform: translate(-50%, -50%); transition: left 180ms linear; z-index:2; }
        .pizzaTrack{ position:absolute; left:18px; right:18px; top:50%; height:10px; transform:translateY(-50%); background:rgba(255,255,255,.82); border-radius:999px; overflow:hidden; border:1px solid rgba(251,146,60,.16); }
        .pizzaFill{ height:100%; border-radius:999px; background: linear-gradient(90deg, #fb923c, #f43f5e); transition: width 180ms linear; }
        .pizzaLabel{ font-size:13px; font-weight:800; color:#7c2d12; letter-spacing:.1px; }
        .pizzaIcon{ width:34px; height:34px; border-radius:999px; position:relative; background: radial-gradient(circle at 50% 50%, rgba(252,211,77,1) 0%, rgba(251,191,36,1) 62%, rgba(194,65,12,1) 78%, rgba(154,52,18,1) 100%); box-shadow:0 12px 24px rgba(154,52,18,.18); animation:pizzaPulse 900ms ease-in-out infinite; overflow:hidden; }
        .pizzaIcon::before{ content:""; position:absolute; inset:4px; border-radius:999px; background: radial-gradient(circle at 28% 32%, rgba(34,197,94,.95) 0 10%, transparent 11%), radial-gradient(circle at 70% 62%, rgba(34,197,94,.95) 0 9%, transparent 10%), radial-gradient(circle at 36% 58%, rgba(255,255,255,.95) 0 12%, transparent 13%), radial-gradient(circle at 62% 40%, rgba(255,255,255,.95) 0 10%, transparent 11%), radial-gradient(circle at 55% 72%, rgba(255,255,255,.95) 0 9%, transparent 10%), radial-gradient(circle at 50% 50%, rgba(239,68,68,.95) 0 70%, rgba(239,68,68,.85) 71% 100%); }
        .pizzaIcon::after{ content:""; position:absolute; left:50%; top:-16px; width:28px; height:28px; transform:translateX(-50%); border-radius:999px; background:radial-gradient(circle at 50% 60%, rgba(148,163,184,.35), transparent 70%); filter: blur(1.2px); animation:steamUp 1000ms ease-in-out infinite; }

        .siteFooter { margin: 10px 0 18px; padding: 12px 4px 0; border-top: 1px solid rgba(86,96,67,.12); color:#7a8172; display:grid; gap:5px; }
        .siteFooterTitle { font-weight:950; font-size:12px; letter-spacing:-.01em; }
        .siteFooterMeta { font-size:11px; line-height:1.45; }
        .sourceBadge{ font-size:12px; line-height:1.45; color:#566043; background:#eef4e6; border:1px solid rgba(52,68,34,.14); border-radius:14px; padding:10px 12px; font-weight:750; }

        @media (max-width: 980px) {
          .appFrame { grid-template-columns: 230px minmax(0, 1fr); gap: 14px; }
          .heroProof { grid-template-columns: 1fr; }
          .starterGrid { grid-template-columns: 1fr; }
        }
        @media (max-width: 760px) {
          .appRoot{ padding: 8px !important; }
          .mobileOnly { display: inline-flex; }
          .desktopOnlyInline { display: none; }
          .mobileProjectBar{ display:flex; position: sticky; top: 0; z-index: 60; padding-top: env(safe-area-inset-top); margin: 0 auto 8px; width:min(100%, 1360px); gap:8px; }
          .appFrame{ display:block; width:100%; }
          .workspace{ width:100%; min-width:0; gap:10px; padding-bottom: 238px; }
          .workspace.noComposer{ padding-bottom: 20px; }
          .projectRail{ position: fixed; z-index: 80; top: calc(10px + env(safe-area-inset-top)); left: 10px; right: 10px; height: auto; max-height: calc(100svh - 20px - env(safe-area-inset-top)); transform: translateY(-110%); opacity:0; pointer-events:none; transition: transform 180ms ease, opacity 180ms ease; border-radius:24px; box-shadow:0 24px 80px rgba(15,23,42,.22); }
          .projectRail.open{ transform: translateY(0); opacity:1; pointer-events:auto; }
          .drawerClose{ display:inline-flex; }
          .sidebarBrand{ gap: 10px; }
          .sidebarLogoEpppn,.sidebarLogoErnesto{ width: 118px; }
          .topBar { border-radius: 18px; padding: 10px; align-items:flex-start; }
          .statusCluster { align-items:flex-start; }
          .topActions { width: 100%; justify-content:flex-start; margin-top: 8px; }
          .heroShell { padding: 18px; border-radius: 24px; }
          .heroTitle{ font-size: 38px; line-height:.96; }
          .heroIntro{ font-size: 14px; line-height:1.5; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
          .heroActionRow { margin-top: 16px; }
          .heroProof { display:none; }
          .activeProjectStrip { border-radius: 16px; padding: 10px; }
          .starterPanel { padding: 13px; border-radius: 22px; }
          .starterGrid { gap: 9px; }
          .starterCard { min-height: auto; padding: 13px; border-radius: 20px; }
          .quickSection{ padding: 10px; border-radius: 20px; }
          .quickSectionBody{ display:none; }
          .quickSection.open .quickSectionBody{ display:block; margin-top:8px; }
          .mobileFaqToggle{ display:flex; width:100%; min-height:44px; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid rgba(86,96,67,.14); border-radius:16px; background:rgba(255,255,255,.86); font-weight:950; cursor:pointer; }
          .quickSectionHeader{ display:none !important; }
          .quickWrap{ grid-template-columns: 1fr; }
          .quickNavBtn{ display:none; }
          .quickCard{ flex-basis: 78vw; max-width: 340px; }
          .conversationShell { padding: 10px; border-radius: 22px; }
          .bubble{ max-width:100%; padding: 11px; border-radius: 20px; }
          .bubble.user{ max-width: 92%; }
          .answerPara{ font-size:15px; line-height:1.68; }
          .sectionHeader{ padding: 11px 12px; }
          .sectionBody{ padding: 12px; }
          .profileGrid{ grid-template-columns:1fr; }
          .composer{ position:fixed; left:8px; right:8px; bottom:0; z-index:70; padding: 0 0 env(safe-area-inset-bottom); background: transparent; }
          .composerPanel{ border-radius: 22px 22px 0 0; padding: 10px; box-shadow: 0 -18px 50px rgba(15,23,42,.14); }
          .composerModeRow{ display:grid; grid-template-columns:1fr; gap:7px; }
          .composerHint{ display:none; }
          .mobileAskLabel{ display:block; font-size:12px; font-weight:950; color:#7a8172; }
          .responseSelect{ width:100%; min-height:44px; }
          .askGrid{ grid-template-columns:44px 1fr 44px; }
          table{ font-size:12px !important; }
        }
        @media (max-width: 420px){
          .heroTitle{ font-size: 32px; }
          .starterPill{ padding: 8px 9px; }
          .pizzaLoad{ padding:10px; }
          .pizzaLabel{ font-size:12px; line-height:1.35; }
        }
        @keyframes pizzaPulse{ 0%,100%{ transform: translateY(0) scale(1); } 50%{ transform: translateY(-2px) scale(1.02); } }
        @keyframes steamUp{ 0%{ opacity:.15; transform:translateX(-50%) translateY(6px) scale(.9); } 55%{ opacity:.55; } 100%{ opacity:0; transform:translateX(-50%) translateY(-10px) scale(1.15); } }
        @keyframes ernestoIn { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:translateY(0);} }
      `}</style>

      <div className="mobileProjectBar">
        <button className="mobileProjectBtn" type="button" onClick={() => setProjectsOpen(true)}>
          <span>Projets</span>
          <span style={{ opacity: 0.68, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeProject?.title ?? "Nouvelle demande"}
          </span>
        </button>
      </div>

      <div className="appFrame">
        <aside className={`projectRail ${projectsOpen ? "open" : ""}`}>
          <div className="railBrand">
            <div className="railBrandMark">ER</div>
            <div className="railBrandText">
              <div className="railBrandTitle">Ernesto</div>
              <div className="railBrandSub">Outil pédagogique EPPPN pour la pizza et l’activité de restauration.</div>
            </div>
            <button className="drawerClose" type="button" onClick={() => setProjectsOpen(false)} aria-label="Fermer les projets">×</button>
          </div>

          <div className="projectRailHeader">
            <div className="projectTitleSmall">Ateliers de travail</div>
            <div className="projectSub">Un fil par sujet : ouverture, four, farine, service, levain, coûts.</div>
          </div>

          <button className="projectNew" type="button" onClick={newConversation}>Nouveau projet</button>

          <div className="projectList">
            {projects.map((p) => (
              <div key={p.id} className={`projectItem ${p.id === activeProjectId ? "active" : ""}`}>
                {editingProjectId === p.id ? (
                  <div className="projectRenameBox">
                    <input
                      className="projectRenameInput"
                      value={editingProjectTitle}
                      onChange={(e) => setEditingProjectTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveProjectTitle(p.id);
                        if (e.key === "Escape") setEditingProjectId(null);
                      }}
                      autoFocus
                      placeholder="Nom du projet"
                    />
                    <div className="projectActions" style={{ justifyContent: "flex-start" }}>
                      <button className="miniBtn" type="button" onClick={() => saveProjectTitle(p.id)}>Enregistrer</button>
                      <button className="miniBtn" type="button" onClick={() => setEditingProjectId(null)}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => selectProject(p.id)}
                      style={{ appearance: "none", border: 0, background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", minWidth: 0 }}
                    >
                      <div className="projectItemTitle">{p.title || "Nouvelle demande"}</div>
                      <div className="projectMeta">{p.chat.length} message{p.chat.length > 1 ? "s" : ""} · {formatProjectDate(p.updatedAt)}</div>
                    </button>
                    <div className="projectActions">
                      <button className="editIconBtn" type="button" onClick={(e) => { e.stopPropagation(); startRenameProject(p); }} aria-label="Renommer le projet" title="Renommer le projet">✎</button>
                      <button className="projectDelete" type="button" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} aria-label="Supprimer le projet" title="Supprimer">×</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="sidebarBrand" aria-label="Identité EPPPN et Ernesto">
            <img className="sidebarLogoEpppn" src="/LOGOEPPPN21.png" alt="Logo EPPPN" />
            <img className="sidebarLogoErnesto" src="/logo-ernesto.png" alt="Logo Ernesto" />
            <div className="railFooterNote">Accès réservé aux stagiaires formés à l’EPPPN. Ouverture publique prévue ultérieurement.</div>
          </div>
        </aside>

        <div className={`workspace ${session ? "" : "noComposer"}`}>
          <div className="topBar">
            <div className="statusCluster">
              <span className={`planBadge ${session ? "green" : ""}`}>{session ? subscriptionLabel(usage) : "Accès réservé"}</span>
              <div style={{ minWidth: 0 }}>
                <div className="userEmail">{session?.user?.email ?? "Connexion stagiaire EPPPN"}</div>
                <div className="userMeta">{session ? (usageLine || "Accès pédagogique en cours de vérification") : "Ernesto est d’abord disponible pour les personnes ayant suivi une formation à l’EPPPN."}</div>
                {usage && !usage.is_pro && !usage.is_admin ? (
                  <div style={{ marginTop: 8, width: 180, height: 6, borderRadius: 999, background: "rgba(86,96,67,.12)", overflow: "hidden" }}>
                    <div style={{ width: `${usagePercent}%`, height: "100%", background: "#344422", borderRadius: 999 }} />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="topActions">
              {session ? (
                <>
                  <button onClick={() => setProfileOpen((v) => !v)} className="miniBtn">Profil</button>
                  <button onClick={logout} className="miniBtn">Se déconnecter</button>
                </>
              ) : null}
            </div>
          </div>

          {authInfo ? (
            <div className="statusCard" style={{ borderColor: "rgba(190,124,68,.24)" }}>{authInfo}</div>
          ) : null}

          {!session ? (
            <section className="heroShell">
              <div className="heroKicker">Accès pédagogique réservé</div>
              <h1 className="heroTitle">Ernesto, The Pizza Explained.</h1>
              <div className="heroIntro">
                Ernesto accompagne les stagiaires EPPPN qui ouvrent, développent ou stabilisent une activité de pizza et de restauration : pâte, farines, levain, fermentation, cuisson, organisation du banc, service et choix économiques.
              </div>
              <div className="heroProof">
                <div className="proofItem"><div className="proofTitle">Diagnostic</div><div className="proofText">Transformer un problème concret en causes probables et points de contrôle.</div></div>
                <div className="proofItem"><div className="proofTitle">Protocole</div><div className="proofText">Construire une action testable, adaptée au matériel et au service.</div></div>
                <div className="proofItem"><div className="proofTitle">Activité</div><div className="proofText">Relier qualité produit, régularité, coûts et organisation quotidienne.</div></div>
              </div>
              <div style={{ marginTop: 24 }} className="statusCard">
                <div style={{ fontWeight: 950, fontSize: 18 }}>Connexion par e-mail</div>
                <div style={{ marginTop: 6, color: "#626a59", lineHeight: 1.5 }}>
                  Utilisez l’adresse associée à votre accès EPPPN. Vous recevrez un lien sécurisé, sans mot de passe.
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendMagicLink(); }}
                    placeholder="votre.email@exemple.fr"
                    style={{ flex: 1, minWidth: 240, padding: "13px 14px", border: "1px solid rgba(86,96,67,.18)", borderRadius: 16, fontSize: 16 }}
                  />
                  <button onClick={sendMagicLink} className="primaryHeroBtn">Recevoir le lien</button>
                </div>
              </div>
            </section>
          ) : (
            <>
              {profileOpen ? (
                <section className="profilePanel">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                    <div>
                      <div className="sectionEyebrow">Profil de travail</div>
                      <div style={{ marginTop: 4, fontWeight: 950, fontSize: 18 }}>Adapter les réponses à votre activité</div>
                    </div>
                    <button type="button" className="miniBtn" onClick={resetPersonalProfile}>Réinitialiser</button>
                  </div>
                  <div className="profileGrid">
                    <label className="profileField"><span className="profileLabel">Âge</span><input className="profileInput" value={personalProfile.age} onChange={(e) => setPersonalProfile((p) => ({ ...p, age: e.target.value }))} placeholder="Ex. 35" /></label>
                    <label className="profileField"><span className="profileLabel">Activité</span><input className="profileInput" value={personalProfile.profession} onChange={(e) => setPersonalProfile((p) => ({ ...p, profession: e.target.value }))} placeholder="Pizzaiolo, porteur de projet, restaurateur…" /></label>
                    <label className="profileField"><span className="profileLabel">Niveau</span><input className="profileInput" value={personalProfile.level} onChange={(e) => setPersonalProfile((p) => ({ ...p, level: e.target.value }))} placeholder="Débutant, confirmé, ouverture prochaine…" /></label>
                    <label className="profileField"><span className="profileLabel">Style préféré</span><input className="profileInput" value={personalProfile.preferredLanguage} onChange={(e) => setPersonalProfile((p) => ({ ...p, preferredLanguage: e.target.value }))} placeholder="Court, technique, très pédagogique…" /></label>
                    <label className="profileField" style={{ gridColumn: "1 / -1" }}><span className="profileLabel">Votre objectif avec Ernesto</span><textarea className="profileTextarea" value={personalProfile.reason} onChange={(e) => setPersonalProfile((p) => ({ ...p, reason: e.target.value }))} placeholder="Ex. ouvrir une pizzeria artisanale, stabiliser une pâte 48h, choisir un four…" /></label>
                  </div>
                  {profileSavedAt ? <div style={{ fontSize: 12, color: "#7a8172" }}>Profil enregistré localement.</div> : null}
                </section>
              ) : null}

              {paywall ? (
                <section className="statusCard" style={{ borderColor: "rgba(190,124,68,.24)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                    <div>
                      <div className="sectionEyebrow">Accès Ernesto Plus</div>
                      <div style={{ marginTop: 5, fontSize: 22, fontWeight: 950, letterSpacing: "-.03em" }}>Votre période d’essai est terminée</div>
                      <div style={{ marginTop: 7, color: "#626a59", lineHeight: 1.5 }}>Activez Ernesto Plus pour continuer à travailler sur vos protocoles, vos diagnostics et votre organisation de service.</div>
                    </div>
                    <button className="miniBtn" type="button" onClick={() => setPaywall(null)}>×</button>
                  </div>
                  <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                    <button type="button" onClick={() => startCheckout("monthly")} disabled={Boolean(payingPlan)} style={{ textAlign: "left", padding: 15, border: "1px solid rgba(86,96,67,.16)", borderRadius: 20, background: "white", cursor: payingPlan ? "wait" : "pointer" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#8b5e34" }}>Mensuel</div>
                      <div style={{ marginTop: 7, fontSize: 30, fontWeight: 950, letterSpacing: -1 }}>19 € <span style={{ fontSize: 13 }}>/ mois</span></div>
                      <div style={{ marginTop: 9, padding: "10px 12px", borderRadius: 14, color: "white", WebkitTextFillColor: "white", background: "#172033", textAlign: "center", fontWeight: 950 }}>{payingPlan === "monthly" ? "Ouverture du paiement…" : "Choisir le mensuel"}</div>
                    </button>
                    <button type="button" onClick={() => startCheckout("yearly")} disabled={Boolean(payingPlan)} style={{ textAlign: "left", padding: 15, border: "1px solid rgba(52,68,34,.20)", borderRadius: 20, background: "linear-gradient(180deg,#ffffff,#f3f6ed)", cursor: payingPlan ? "wait" : "pointer" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#344422" }}>Annuel recommandé</div>
                      <div style={{ marginTop: 7, fontSize: 30, fontWeight: 950, letterSpacing: -1 }}>149 € <span style={{ fontSize: 13 }}>/ an</span></div>
                      <div style={{ marginTop: 9, padding: "10px 12px", borderRadius: 14, color: "white", WebkitTextFillColor: "white", background: "#344422", textAlign: "center", fontWeight: 950 }}>{payingPlan === "yearly" ? "Ouverture du paiement…" : "Choisir l’annuel"}</div>
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="heroShell">
                <div className="heroKicker">Accès stagiaire EPPPN · phase privée</div>
                <h1 className="heroTitle">Ernesto, The Pizza Explained.</h1>
                <div className="heroIntro">
                  Un espace de travail pour les personnes qui ouvrent, pilotent ou stabilisent une activité de pizza artisanale : comprendre ce qui se passe, décider quoi tester, structurer un protocole et garder la régularité en service.
                </div>
                <div className="heroActionRow">
                  <button className="primaryHeroBtn" type="button" onClick={() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus()}>Poser une question</button>
                  <button className="miniBtn" type="button" onClick={() => fileRef.current?.click()}>Analyser une photo</button>
                  <button className="miniBtn" type="button" onClick={newConversation}>Nouveau dossier</button>
                  <span className="softBadge">Réservé aux stagiaires formés à l’EPPPN</span>
                </div>
                <div className="heroProof">
                  <div className="proofItem"><div className="proofTitle">Pâte & fermentation</div><div className="proofText">Hydratation, force de farine, levain, froid, apprêt, tenue au banc.</div></div>
                  <div className="proofItem"><div className="proofTitle">Four & production</div><div className="proofText">Cuisson, débit, organisation du poste, mise en place, régularité.</div></div>
                  <div className="proofItem"><div className="proofTitle">Restaurant</div><div className="proofText">Choix matériels, coûts, marge, confort de travail, ouverture progressive.</div></div>
                </div>
              </section>

              <div className="activeProjectStrip">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="sectionEyebrow" style={{ fontSize: 11 }}>Dossier actif</div>
                  <div className="activeProjectTitleRow">
                    <div className="activeProjectTitleText">{activeProject?.title ?? "Nouvelle demande"}</div>
                    <button className="editIconBtn" type="button" onClick={renameActiveProject} aria-label="Renommer le projet actif" title="Renommer le projet actif">✎</button>
                  </div>
                </div>
                <button className="miniBtn" type="button" onClick={newConversation}>Nouveau</button>
              </div>

              {chat.length === 0 ? (
                <section className="starterPanel">
                  <div className="sectionTitleRow">
                    <div>
                      <div className="sectionEyebrow">Démarrer vite</div>
                      <div className="sectionTitle">Choisissez une situation de travail</div>
                    </div>
                    <div className="sectionHelp">1 clic préremplit · Entrée envoie · photo possible</div>
                  </div>
                  <div className="starterGrid">
                    {starterGroups.map((group) => (
                      <article className="starterCard" key={group.title}>
                        <div>
                          <div className="starterCardKicker">{group.eyebrow}</div>
                          <div className="starterCardTitle">{group.title}</div>
                          <div className="starterCardText">{group.text}</div>
                        </div>
                        <div className="starterPills">
                          {group.questions.map((q) => (
                            <button key={q.label} className="starterPill" type="button" onClick={() => handleQuestionClick(q)} onDoubleClick={() => handleQuestionDoubleClick(q)}>{q.label}</button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className={`quickSection ${quickOpen ? "open" : ""}`}>
                <button className="mobileFaqToggle" type="button" onClick={() => setQuickOpen((v) => !v)}>
                  <span>Suggestions de départ</span>
                  <span style={{ opacity: 0.62 }}>{quickOpen ? "Masquer" : "Ouvrir"}</span>
                </button>
                <div className="quickSectionBody">
                  <div className="quickSectionHeader">
                    <div>
                      <div className="sectionEyebrow">Bibliothèque de questions</div>
                      <div style={{ fontWeight: 950, fontSize: 18, letterSpacing: "-.02em" }}>Suggestions de départ</div>
                    </div>
                    <div className="sectionHelp">Situations réelles · 1 clic pour préremplir · double clic pour envoyer</div>
                  </div>
                  <div className="quickWrap">
                    <button className="quickNavBtn" onClick={() => scrollQuick(-300)} aria-label="Faire défiler vers la gauche">‹</button>
                    <div className="quickRow" ref={quickRowRef} onMouseEnter={() => setPauseQuickScroll(true)} onMouseLeave={() => setPauseQuickScroll(false)} onTouchStart={() => setPauseQuickScroll(true)} onTouchEnd={() => setPauseQuickScroll(false)}>
                      {quickQuestions.map((q, idx) => (
                        <button key={`${q.label}-${idx}`} className={`quickCard ${selectedQuestion === q.label ? "selected" : ""}`} onClick={() => handleQuestionClick(q)} onDoubleClick={() => handleQuestionDoubleClick(q)} aria-pressed={selectedQuestion === q.label} title="1 clic : préremplir · 2 clics : envoyer à Ernesto">
                          <div className="quickKicker">{q.category}</div>
                          <div className="quickLabel">{q.label}</div>
                          <div className="quickText">{q.text}</div>
                        </button>
                      ))}
                    </div>
                    <button className="quickNavBtn" onClick={() => scrollQuick(300)} aria-label="Faire défiler vers la droite">›</button>
                  </div>
                </div>
              </section>

              <section className="conversationShell">
                {chat.length === 0 ? (
                  <div className="emptyHint">Décrivez une situation précise : farine utilisée, hydratation, température, temps de fermentation, type de four, rythme de service. Ernesto répond mieux quand le problème est ancré dans le travail réel.</div>
                ) : (
                  chat.map((m) => (
                    <div key={m.id} className="bubbleWrap" style={{ justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                      <div className={`bubble ${m.role}`}>
                        {m.role === "user" ? <div>{m.text}</div> : null}
                        {m.role === "ernesto" ? (
                          <div style={{ display: "grid", gap: 12 }}>
                            {m.text?.trim() ? (
                              <Section title="Réponse Ernesto" headerClass="hAnswer">
                                <AnswerText text={m.text} />
                              </Section>
                            ) : null}
                            {m.graph ? <ErnestoPanels graph={m.graph} /> : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </section>

              <footer className="siteFooter">
                <div className="siteFooterTitle">Ernesto — The Pizza Explained. · Version actuelle : V12</div>
                <div className="siteFooterMeta">Conçu et développé par la section « Apprentissage et Informatisation » de l’EPPPN.</div>
              </footer>

              <div className="composer">
                <div className="composerPanel">
                  <div className="composerModeRow">
                    <div>
                      <div className="mobileAskLabel">Votre question</div>
                      <label style={{ fontWeight: 950, fontSize: 13 }}>Type de réponse</label>
                    </div>
                    <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)} className="responseSelect">
                      <option value="BANCO">Réponse rapide — décision & action</option>
                      <option value="ECOLE">Réponse approfondie — analyse & détails</option>
                    </select>
                    <div className="composerHint">{loading ? "Analyse en cours · Ernesto structure la réponse…" : "Entrée = envoyer · Shift+Entrée = nouvelle ligne"}</div>
                  </div>

                  <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const MAX_BYTES = 600 * 1024;
                      let out: File = f;
                      if (f.size > MAX_BYTES) {
                        out = await compressImageToJpeg(f, 1280, 0.72);
                        if (out.size > MAX_BYTES) out = await compressImageToJpeg(f, 960, 0.60);
                      }
                      setSelectedImage(out);
                    } catch {
                      setSelectedImage(f);
                    }
                    e.currentTarget.value = "";
                  }} />

                  {selectedImage && imagePreviewUrl ? (
                    <div className="imagePreviewCard">
                      <img src={imagePreviewUrl} alt="Photo sélectionnée pour analyse" />
                      <div style={{ minWidth: 0 }}>
                        <div className="imagePreviewTitle">Photo prête pour l’analyse</div>
                        <div className="imagePreviewMeta">{selectedImage.name} · {(selectedImage.size / 1024).toFixed(0)} Ko</div>
                      </div>
                      <button className="attachX" type="button" onClick={() => setSelectedImage(null)} aria-label="Retirer la photo">×</button>
                    </div>
                  ) : null}

                  <div className="askGrid">
                    <button type="button" onClick={toggleDictation} style={{ ...ui.iconBtn, width: 46, height: 46, borderColor: dictating ? "#344422" : "rgba(86,96,67,.18)", background: dictating ? "#eef4e6" : "white" }} title="Parler à Ernesto">🎤</button>
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askTutor(message); } }} rows={3} placeholder="Décrivez votre situation : pâte, farine, four, service, coût, organisation…" style={ui.textarea} />
                    <button type="button" onClick={() => fileRef.current?.click()} style={{ ...ui.iconBtn, width: 46, height: 46, borderColor: "rgba(86,96,67,.18)" }} title="Analyser une photo">📷</button>
                  </div>

                  <button className="sendButton" onClick={() => askTutor(message)} disabled={loading || !message.trim()} style={{ opacity: loading || !message.trim() ? 0.62 : 1 }}>
                    {loading ? <PizzaLoader ms={loadingMs} done={pizzaDone} /> : "Demander à Ernesto"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}


function AnswerText({ text }: { text: string }) {
  const headingPatterns = [
    /^#{1,3}\s+/,
    /^(Réponse Ernesto|Diagnostic|Diagnostic raisonné|Diagnostic probable|Analyse|Variables à contrôler|Ce qu’il faut faire maintenant|Protocole conseillé|Point de vigilance|Erreur à éviter|Erreurs fréquentes|Synthèse|Questions utiles|Questions)\b/i,
    /^\d+\.\s+(Diagnostic|Analyse|Variables|Protocole|Erreur|Questions|Ce qu)/i,
  ];

  const blocks = splitAnswerBlocks(text);

  return (
    <div className="answerText">
      {blocks.map((block, i) => {
        if (block.kind === "table") {
          return <TableChart key={i} data={block.data} />;
        }

        const raw = block.text ?? "";
        const line = raw.trimEnd();
        const clean = line.replace(/^#{1,3}\s+/, "").replace(/\*\*/g, "");
        if (!clean.trim()) return <div key={i} style={{ height: 2 }} />;
        const isHeading = headingPatterns.some((rx) => rx.test(clean.trim()));
        if (isHeading) {
          return (
            <div key={i} className="answerHeading">
              {clean.trim()}
            </div>
          );
        }
        if (/^[-•]\s+/.test(clean.trim())) {
          return (
            <div key={i} className="answerPara" style={{ paddingLeft: 10 }}>
              {clean.trim()}
            </div>
          );
        }
        return (
          <p key={i} className="answerPara">
            {clean}
          </p>
        );
      })}
    </div>
  );
}

type AnswerBlock =
  | { kind: "text"; text: string }
  | { kind: "table"; data: { columns: string[]; rows: (string | number)[][]; note?: string } };

function splitAnswerBlocks(text: string): AnswerBlock[] {
  const lines = text.replace(/```json[\s\S]*?```/gi, "").replace(/```[\s\S]*?```/g, "").split("\n");
  const blocks: AnswerBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    if (isMarkdownTableHeader(line, next)) {
      const tableLines = [line, next];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      const parsed = parseMarkdownTable(tableLines);
      if (parsed) blocks.push({ kind: "table", data: parsed });
      continue;
    }
    blocks.push({ kind: "text", text: line });
    i += 1;
  }

  return blocks;
}

function isMarkdownTableHeader(line: string, next: string) {
  return /^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
}

function parseMarkdownTable(lines: string[]) {
  const rows = lines
    .filter((_, idx) => idx !== 1)
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()))
    .filter((r) => r.length > 0);

  if (rows.length < 2) return null;
  const columns = rows[0];
  const body = rows.slice(1).map((r) => columns.map((_, i) => r[i] ?? ""));
  return { columns, rows: body };
}

function PizzaLoader({ ms, done }: { ms: number; done: boolean }) {
  const expected = 12000;
  const p = done ? 1 : Math.min(0.96, ms / expected);
  const pct = Math.round(p * 100);

  return (
    <div className={`pizzaLoad ${done ? "done" : ""}`} aria-label="Ernesto prépare votre réponse">
      <div className="pizzaRunway">
        <div className="pizzaTrack">
          <div className="pizzaFill" style={{ width: `${pct}%` }} />
        </div>
        <div className="pizzaMotion" style={{ left: `${Math.max(5, Math.min(95, pct))}%` }}>
          <div className="pizzaIcon" />
        </div>
      </div>
      <div className="pizzaLabel">
        {done
          ? "Réponse prête."
          : "Analyse en cours · formulation d’une réponse claire et exploitable…"}
      </div>
    </div>
  );
}

function SourceBadge() {
  return (
    <div className="sourceBadge">
      Ernesto s’appuie prioritairement sur les connaissances et protocoles EPPPN, puis complète avec l’IA lorsque c’est utile.
    </div>
  );
}

function ErnestoPanels({ graph }: { graph: GraphJSON }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Section title="Synthèse & graphiques" headerClass="hSynth">
        <div style={{ fontWeight: 950, fontSize: 15 }}>{graph.title}</div>
        <div style={{ marginTop: 6, opacity: 0.9 }}>{graph.summary}</div>

        <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
          {(graph.charts ?? []).map((c, idx) => (
            <ChartCard key={idx} chart={c} />
          ))}
          {(!graph.charts || graph.charts.length === 0) && (
            <div style={{ opacity: 0.75, fontSize: 13 }}>Pas de graphique fourni (cas rare).</div>
          )}
        </div>
      </Section>

      <Section title="Checklist (priorisée)" headerClass="hCheck">
        {graph.checklist?.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {graph.checklist.map((it, i) => (
              <div key={i} style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>{it.action}</div>
                  <span style={badgeStyle(it.priority)}>{it.priority.toUpperCase()}</span>
                </div>
                <div style={{ marginTop: 6, opacity: 0.95 }}>
                  <strong>Effet attendu:</strong> {it.expected_effect}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ opacity: 0.75, fontSize: 13 }}>—</div>
        )}
      </Section>

      <Section title="Tableau récapitulatif" headerClass="hRecap">
        <TableChart data={graph.recap_table} />
      </Section>

      <Section title="Questions (si infos manquent)" headerClass="hQues">
        {graph.questions?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {graph.questions.filter(Boolean).map((q, i) => (
              <li key={i} style={{ marginBottom: 8 }}>
                {q}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ opacity: 0.75, fontSize: 13 }}>—</div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, headerClass, children }: { title: string; headerClass: string; children: React.ReactNode }) {
  return (
    <div className="sectionShell">
      <div className={`sectionHeader ${headerClass}`}>{title}</div>
      <div className="sectionBody">{children}</div>
    </div>
  );
}

function ChartCard({ chart }: { chart: Chart }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 16, padding: 12 }}>
      <div style={{ fontWeight: 900 }}>{chart.title}</div>
      {chart.description && <div style={{ marginTop: 4, opacity: 0.85, fontSize: 13 }}>{chart.description}</div>}
      <div style={{ marginTop: 10 }}>
        {chart.type === "table" ? <TableChart data={chart.data} /> : null}
        {chart.type === "bar" ? <BarChartWidget data={chart.data} /> : null}
        {chart.type === "timeline" ? <TimelineChart data={chart.data} /> : null}
        {chart.type === "radar" ? <RadarChartWidget data={chart.data} /> : null}
        {chart.type === "scatter" ? <ScatterChartWidget data={chart.data} /> : null}
      </div>
    </div>
  );
}

function TableChart({ data }: { data: { columns: string[]; rows: (string | number)[][]; note?: string } }) {
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {data.columns.map((c, i) => (
                <th
                  key={i}
                  style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={{ padding: 8, borderBottom: "1px solid #f2f2f2", whiteSpace: "nowrap" }}>
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.note ? (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          <strong>Note:</strong> {data.note}
        </div>
      ) : null}
    </div>
  );
}

function BarChartWidget({ data }: any) {
  const labels: string[] = Array.isArray(data?.labels) ? data.labels : [];
  const values: number[] = Array.isArray(data?.values) ? data.values : [];
  const rows = useMemo(() => labels.map((l, i) => ({ name: l, value: Number(values[i] ?? 0) })), [labels, values]);
  const safe = rows.filter((r) => Number.isFinite(r.value));

  if (!safe.length) return <div style={{ opacity: 0.75, fontSize: 13 }}>Données insuffisantes pour afficher ce graphique.</div>;

  return (
    <div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={safe}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#4f46e5" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
        Unité: {data?.unit ?? "score"}
        {data?.note ? (
          <>
            {" "}
            · <strong>Note:</strong> {data.note}
          </>
        ) : null}
      </div>
    </div>
  );
}

function RadarChartWidget({ data }: any) {
  const labels: string[] = Array.isArray(data?.labels) ? data.labels : [];
  const values: number[] = Array.isArray(data?.values) ? data.values : [];
  const rows = useMemo(() => labels.map((l, i) => ({ axis: l, score: Number(values[i] ?? 0) })), [labels, values]);
  const safe = rows.filter((r) => Number.isFinite(r.score));

  if (!safe.length) return <div style={{ opacity: 0.75, fontSize: 13 }}>Données insuffisantes pour afficher ce radar.</div>;

  return (
    <div>
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={safe}>
            <PolarGrid />
            <PolarAngleAxis dataKey="axis" />
            <PolarRadiusAxis angle={30} domain={[0, 100]} />
            <Radar name="Score" dataKey="score" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.25} />
            <Legend />
            <Tooltip />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {data?.note ? (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
          <strong>Note:</strong> {data.note}
        </div>
      ) : null}
    </div>
  );
}

function ScatterChartWidget({ data }: any) {
  const pts = Array.isArray(data?.points) ? data.points : [];
  const safe = pts
    .filter((p: any) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y)))
    .map((p: any) => ({ x: Number(p.x), y: Number(p.y), label: p.label ?? "" }));

  if (!safe.length) return <div style={{ opacity: 0.75, fontSize: 13 }}>Données insuffisantes pour afficher ce scatter.</div>;

  return (
    <div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" name={data?.x_label ?? "x"} />
            <YAxis dataKey="y" name={data?.y_label ?? "y"} domain={[0, 100]} />
            <ZAxis range={[60, 60]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={safe} fill="#f59e0b" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>{data?.note ? <><strong>Note:</strong> {data.note}</> : null}</div>
    </div>
  );
}

function TimelineChart({ data }: any) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const total = Math.max(
    1,
    ...steps.map((s: any) => (Number.isFinite(Number(s?.minutes)) ? Number(s.minutes) : 0))
  );

  if (!steps.length) return <div style={{ opacity: 0.75, fontSize: 13 }}>Données insuffisantes pour afficher une timeline.</div>;

  return (
    <div>
      <div style={{ display: "grid", gap: 10 }}>
        {steps.map((s: any, i: number) => {
          const mins = Number.isFinite(Number(s?.minutes)) ? Number(s.minutes) : 0;
          const width = Math.max(6, Math.round((mins / total) * 100));
          return (
            <div key={i} style={{ border: "1px solid #f0f0f0", borderRadius: 14, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>{s?.label ?? "Étape"}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{mins} min</div>
              </div>
              <div style={{ marginTop: 6, height: 8, background: "#f3f3f3", borderRadius: 999 }}>
                <div style={{ width: `${width}%`, height: 8, borderRadius: 999, background: "#22c55e" }} />
              </div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>{s?.purpose ?? ""}</div>
            </div>
          );
        })}
      </div>
      {data?.note ? (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          <strong>Note:</strong> {data.note}
        </div>
      ) : null}
    </div>
  );
}
