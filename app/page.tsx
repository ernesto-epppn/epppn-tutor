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

  return (
    <main className="appRoot" style={ui.page}>
      <style>{`
        * { box-sizing: border-box; }
        input, textarea, select, button { font: inherit; color: #0f172a; }
        input, textarea, select { background: #ffffff; -webkit-text-fill-color: #0f172a; caret-color: #0f172a; color-scheme: light; }
        button { -webkit-tap-highlight-color: transparent; }
        .appRoot { overflow-x: hidden; }
        .appFrame {
          width: min(100%, 1280px);
          margin: 0 auto;
          display: grid;
          grid-template-columns: 280px minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }
        .workspace { min-width: 0; }
        .mobileOnly { display: none; }
        .desktopOnlyInline { display: inline; }
        .topCompactTitle { display:none; }
        .mobileFaqToggle { display:none; }
        .composerModeRow { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .composerHint { font-size: 12px; opacity: 0.75; }
        .projectRail {
          position: sticky;
          top: 14px;
          max-height: calc(100svh - 28px);
          overflow: auto;
          border: 1px solid rgba(226,232,240,0.88);
          border-radius: 26px;
          background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
          box-shadow: 0 18px 42px rgba(15,23,42,0.06);
          padding: 14px;
        }
        .projectRailHeader { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom: 10px; }
        .projectTitleSmall { font-weight: 950; font-size: 16px; letter-spacing: -0.01em; }
        .projectSub { font-size: 12px; line-height: 1.35; opacity: .68; margin-top: 2px; }
        .projectNew {
          width: 100%;
          padding: 12px 13px;
          border-radius: 16px;
          border: 1px solid rgba(15,23,42,0.08);
          background: #0f172a;
          color: white;
          -webkit-text-fill-color: white;
          font-weight: 900;
          cursor: pointer;
          margin: 8px 0 12px;
        }
        .projectList { display:grid; gap: 8px; }
        .projectItem {
          width: 100%;
          display:grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          text-align:left;
          border: 1px solid rgba(226,232,240,0.92);
          background: rgba(255,255,255,0.88);
          border-radius: 18px;
          padding: 11px;
          cursor:pointer;
          box-shadow: 0 8px 20px rgba(15,23,42,0.035);
        }
        .projectItem.active {
          border-color: rgba(244,63,94,0.28);
          background: linear-gradient(180deg, rgba(255,247,237,.98), rgba(255,255,255,.98));
        }
        .projectItemTitle { font-size: 13px; line-height: 1.25; font-weight: 850; color:#0f172a; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
        .projectMeta { font-size: 11px; opacity: .62; margin-top: 5px; }
        .projectDelete {
          width: 28px; height: 28px; border-radius: 10px; border: 1px solid rgba(226,232,240,0.9);
          background: rgba(255,255,255,.9); cursor:pointer; color:#64748b; -webkit-text-fill-color:#64748b;
        }
        .projectActions { display:flex; gap:6px; align-items:center; justify-content:flex-end; }
        .miniBtn {
          min-height: 30px;
          padding: 6px 9px;
          border-radius: 11px;
          border: 1px solid rgba(226,232,240,0.95);
          background: rgba(255,255,255,0.92);
          color:#0f172a;
          -webkit-text-fill-color:#0f172a;
          cursor:pointer;
          font-size: 12px;
          font-weight: 850;
        }
        .projectRenameBox { grid-column: 1 / -1; display:grid; gap:8px; }
        .projectRenameInput {
          width:100%;
          padding: 10px 11px;
          border-radius: 13px;
          border: 1px solid #cbd5e1;
          background:#fff;
          color:#0f172a;
          -webkit-text-fill-color:#0f172a;
          font-size: 15px;
        }
        .profileGrid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; margin-top:12px; }
        .profileField { display:grid; gap:6px; }
        .profileLabel { font-size:12px; font-weight:900; opacity:.72; }
        .profileInput, .profileTextarea {
          width:100%;
          border: 1px solid #cbd5e1;
          border-radius: 14px;
          background:#fff;
          color:#0f172a;
          -webkit-text-fill-color:#0f172a;
          font-size:16px;
          padding: 12px 13px;
          outline:none;
        }
        .profileTextarea { min-height: 74px; resize: vertical; line-height:1.45; }
        .userTopRow { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
        .userEmail { font-weight:950; font-size:16px; word-break:break-word; }
        .userMeta { margin-top:5px; font-size:13px; opacity:.75; line-height:1.45; }
        .profilePanel {
          margin-top: 12px;
          padding: 13px;
          border: 1px solid rgba(226,232,240,0.92);
          border-radius: 18px;
          background: rgba(255,255,255,0.82);
        }
        .activeProjectStrip {
          margin-top: 12px;
          padding: 10px 12px;
          border: 1px solid rgba(226,232,240,0.9);
          border-radius: 16px;
          background: rgba(255,255,255,0.76);
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap: 10px;
        }
        .mobileProjectBar {
          display:none;
          width: min(100%, 1280px);
          margin: 0 auto 10px;
          gap: 8px;
          align-items:center;
        }
        .mobileProjectBtn {
          flex: 1;
          min-height: 46px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 16px;
          border: 1px solid rgba(226,232,240,0.95);
          background: rgba(255,255,255,0.95);
          box-shadow: 0 10px 26px rgba(15,23,42,0.05);
          cursor:pointer;
          font-weight: 900;
        }
        .drawerClose { display:none; }
        .bubbleWrap { display:flex; margin: 12px 0; }
        .bubble {
          max-width: 94%;
          border-radius: 24px;
          padding: 14px;
          border: 1px solid #ececf3;
          box-shadow: 0 14px 34px rgba(15,23,42,0.05);
          line-height: 1.6;
          white-space: pre-wrap;
          background: white;
          color: #111;
        }
        .bubble.user {
          margin-left: auto;
          background: linear-gradient(180deg, #ffffff, #f8fafc);
          border-color: #e2e8f0;
        }
        .bubble.ernesto {
          margin-right: auto;
          max-width: 100%;
          width: 100%;
          background: linear-gradient(180deg, rgba(255,252,246,0.99), rgba(255,247,237,0.96));
          border-color: rgba(251,146,60,0.24);
          animation: ernestoIn 280ms ease;
        }
        .answerText { display: grid; gap: 8px; }
        .answerPara { margin: 0; font-size: 15px; line-height: 1.75; color: #0f172a; }
        .answerHeading {
          margin-top: 6px;
          font-weight: 950;
          font-size: 15px;
          letter-spacing: -0.01em;
          color: #7c2d12;
        }
        .quickWrap { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; }
        .quickNavBtn {
          border: 1px solid #e2e8f0; background: rgba(255,255,255,0.96); width: 42px; height: 42px; border-radius: 14px; cursor: pointer; font-weight: 900;
          box-shadow: 0 8px 24px rgba(15,23,42,0.05);
        }
        .quickRow { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; padding-left: 2px; padding-right: 2px; -webkit-overflow-scrolling: touch; scroll-snap-type: x mandatory; scrollbar-width: none; }
        .quickRow::-webkit-scrollbar { display: none; }
        .quickCard {
          flex: 0 0 auto; width: 258px; border-radius: 22px; padding: 14px 15px; cursor: pointer; text-align: left;
          border: 1px solid rgba(139,92,246,0.14);
          background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.96));
          box-shadow: 0 12px 30px rgba(15,23,42,0.05);
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
          scroll-snap-align: start; color: #111;
        }
        .quickCard:hover { transform: translateY(-2px); border-color: rgba(244,63,94,0.22); box-shadow: 0 18px 38px rgba(15,23,42,0.09); }
        .quickCard.selected {
          background: linear-gradient(180deg, rgba(15,23,42,0.98), rgba(30,41,59,0.96));
          border-color: rgba(15,23,42,0.92);
          color: white;
          box-shadow: 0 18px 40px rgba(15,23,42,0.18);
          transform: translateY(-1px) scale(1.01);
        }
        .quickCard.selected .quickKicker,
        .quickCard.selected .quickText { opacity: 0.82; color: rgba(255,255,255,0.88); }
        .quickCard.selected .quickLabel { color: white; }
        .quickKicker { font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; opacity: .52; }
        .quickLabel { font-weight: 950; font-size: 16px; line-height: 1.2; margin-top: 8px; }
        .quickText { margin-top: 8px; font-size: 12px; line-height: 1.45; opacity: 0.82; }

        .sectionShell {
            border-radius: 22px;
            border: 1px solid #e9edf3;
            overflow: hidden;
            background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,250,252,0.98));
            box-shadow: 0 14px 34px rgba(15,23,42,0.05);
          }

        .sectionHeader {
          padding: 12px 14px;
          font-weight: 950;
          color: #0f172a;
          -webkit-text-fill-color: #0f172a;
          letter-spacing: -0.01em;
        }
        .sectionBody { padding: 14px; border-top: 1px solid #eee; color: #0f172a; }

        .hAnswer { background: rgba(148,163,184,0.16); border-bottom: 1px solid rgba(148,163,184,0.30); }
        .hSynth  { background: rgba(14,165,233,0.12); border-bottom: 1px solid rgba(14,165,233,0.25); }
        .hCheck  { background: rgba(34,197,94,0.12); border-bottom: 1px solid rgba(34,197,94,0.25); }
        .hRecap  { background: rgba(99,102,241,0.12); border-bottom: 1px solid rgba(99,102,241,0.25); }
        .hQues   { background: rgba(245,158,11,0.14); border-bottom: 1px solid rgba(245,158,11,0.28); }

        .composer{
          position: sticky;
          bottom: 0;
          z-index: 20;
          background: rgba(255,255,255,0.90);
          backdrop-filter: blur(10px);
          border-top: 1px solid rgba(226,232,240,0.85);
          padding: 14px 0 calc(14px + env(safe-area-inset-bottom));
          margin-top: 18px;
        }

        .attachPill {
          display:flex; align-items:center; gap: 8px;
          padding: 7px 11px; border: 1px solid #e2e8f0; border-radius: 999px;
          font-size: 12px; background: rgba(255,255,255,0.96);
          box-shadow: 0 6px 16px rgba(15,23,42,0.04);
        }
        .attachX { border: 1px solid #ddd; border-radius: 999px; width: 22px; height: 22px; cursor: pointer; background: #fff; }

        .pizzaLoad{
          display:grid;
          gap:8px;
          padding:12px 14px;
          border: 1px solid rgba(251,146,60,0.30);
          background: linear-gradient(180deg, rgba(255,247,237,0.96), rgba(255,237,213,0.82));
          border-radius: 18px;
          box-shadow: 0 10px 30px rgba(154,52,18,0.10);
          overflow: hidden;
        }
        .pizzaRunway{
          position: relative;
          height: 42px;
          border-radius: 999px;
          background: rgba(255,255,255,0.72);
          border: 1px solid rgba(251,146,60,0.18);
          overflow: hidden;
        }
        .pizzaMotion{
          position:absolute;
          top:50%;
          transform: translate(-50%, -50%);
          transition: left 180ms linear;
          z-index:2;
        }
        .pizzaTrack{
          position: absolute;
          left: 18px;
          right: 18px;
          top: 50%;
          height: 10px;
          transform: translateY(-50%);
          background: rgba(255,255,255,0.82);
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid rgba(251,146,60,0.16);
        }
        .pizzaFill{ height: 100%; border-radius: 999px; background: linear-gradient(90deg, #fb923c, #f43f5e); transition: width 180ms linear; }
        .pizzaLabel{ font-size: 13px; font-weight: 800; color: #7c2d12; letter-spacing: 0.1px; }
        .pizzaIcon{
          width: 34px; height: 34px; border-radius: 999px; position: relative;
          background: radial-gradient(circle at 50% 50%, rgba(252, 211, 77, 1) 0%, rgba(251, 191, 36, 1) 62%, rgba(194, 65, 12, 1) 78%, rgba(154, 52, 18, 1) 100%);
          box-shadow: 0 12px 24px rgba(154, 52, 18, 0.18); animation: pizzaPulse 900ms ease-in-out infinite; overflow: hidden;
        }
        .pizzaIcon::before{
          content:""; position:absolute; inset: 4px; border-radius: 999px;
          background:
            radial-gradient(circle at 28% 32%, rgba(34,197,94,0.95) 0 10%, transparent 11%),
            radial-gradient(circle at 70% 62%, rgba(34,197,94,0.95) 0 9%, transparent 10%),
            radial-gradient(circle at 36% 58%, rgba(255,255,255,0.95) 0 12%, transparent 13%),
            radial-gradient(circle at 62% 40%, rgba(255,255,255,0.95) 0 10%, transparent 11%),
            radial-gradient(circle at 55% 72%, rgba(255,255,255,0.95) 0 9%, transparent 10%),
            radial-gradient(circle at 50% 50%, rgba(239,68,68,0.95) 0 70%, rgba(239,68,68,0.85) 71% 100%);
        }
        .pizzaIcon::after{
          content:""; position:absolute; left: 50%; top: -16px; width: 28px; height: 28px; transform: translateX(-50%); border-radius: 999px;
          background: radial-gradient(circle at 50% 60%, rgba(148,163,184,0.35), transparent 70%); filter: blur(1.2px); animation: steamUp 1000ms ease-in-out infinite;
        }
        .heroShell{
          margin-top: 6px;
          padding: 22px;
          border-radius: 26px;
          background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
          border: 1px solid rgba(226,232,240,0.86);
          box-shadow: 0 18px 42px rgba(15,23,42,0.06);
        }
        .statusCard{
          padding: 16px;
          border: 1px solid #ece7ff;
          border-radius: 20px;
          background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
          box-shadow: 0 10px 28px rgba(15,23,42,0.05);
          color: #0f172a;
        }
        .authRow { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
        .authInput { flex: 1; min-width: 240px; padding: 13px 14px; border: 1px solid #cbd5e1; border-radius: 14px; background: #fff; color:#0f172a; font-size:16px; }
        .imagePreviewCard{
          display:grid;
          grid-template-columns: 74px 1fr auto;
          gap: 10px;
          align-items:center;
          padding: 9px;
          border: 1px solid rgba(226,232,240,0.95);
          border-radius: 18px;
          background: rgba(255,255,255,0.96);
          box-shadow: 0 8px 22px rgba(15,23,42,0.045);
        }
        .imagePreviewCard img{ width:74px; height:74px; object-fit:cover; border-radius:14px; border:1px solid rgba(226,232,240,.9); display:block; }
        .imagePreviewTitle{ font-weight: 900; font-size: 13px; }
        .imagePreviewMeta{ font-size: 12px; opacity: .68; margin-top: 3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .planBadge{
          display:inline-flex; align-items:center; gap:8px; padding: 7px 11px; border-radius:999px; font-size:12px; font-weight:900; letter-spacing:.02em;
          border:1px solid #e2e8f0; background:rgba(255,255,255,.9);
        }
        .heroTitle{ font-size: 46px; line-height: 1.02; margin: 0; letter-spacing: -0.04em; }
        .heroIntro{ margin-top: 12px; opacity: 0.88; font-size: 16px; line-height: 1.6; }
        .mobileAskLabel{ display:none; }
        .responseSelect{ padding: 10px; border-radius: 14px; border: 1px solid #ddd; font-size: 14px; background: white; color: #111; }
        .sourceBadge{ font-size: 12px; line-height: 1.45; color: #7c2d12; background: rgba(255,247,237,.92); border: 1px solid rgba(251,146,60,.24); border-radius: 14px; padding: 10px 12px; font-weight: 750; }

        @media (max-width: 860px){
          .appRoot{ padding: 8px; background: #fffaf5; }
          .mobileOnly { display: inline-flex; }
          .desktopOnlyInline { display: none; }
          .mobileProjectBar{ display:flex; position: sticky; top: 0; z-index: 60; padding-top: env(safe-area-inset-top); margin-bottom: 8px; }
          .appFrame{ display:block; width:100%; }
          .workspace{ width:100%; min-width:0; padding-bottom: 245px; }
          .projectRail{
            position: fixed;
            z-index: 80;
            top: calc(10px + env(safe-area-inset-top));
            left: 10px;
            right: 10px;
            max-height: calc(100svh - 20px - env(safe-area-inset-top));
            transform: translateY(-110%);
            opacity: 0;
            pointer-events: none;
            transition: transform 180ms ease, opacity 180ms ease;
            border-radius: 24px;
            box-shadow: 0 24px 80px rgba(15,23,42,0.22);
          }
          .projectRail.open{ transform: translateY(0); opacity: 1; pointer-events: auto; }
          .drawerClose{ display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:12px; border:1px solid rgba(226,232,240,.9); background:#fff; cursor:pointer; }
          .heroShell{ padding: 13px; border-radius: 20px; margin-top: 6px; box-shadow: 0 10px 28px rgba(15,23,42,0.045); }
          .heroTitle{ font-size: 28px; line-height: 1.06; letter-spacing: -0.035em; }
          .heroIntro{ font-size: 13px; line-height: 1.48; margin-top: 8px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
          .heroShell .planBadge{ display:none; }
          .topCompactTitle{ display:block; font-size: 11px; font-weight: 950; letter-spacing:.08em; text-transform: uppercase; opacity:.56; margin-bottom: 3px; }
          .quickWrap{ grid-template-columns: 1fr; }
          .quickNavBtn{ display:none; }
          .quickCard{ width: 84vw; max-width: 360px; padding: 13px; }
          .bubble{ max-width: 100%; padding: 11px; border-radius: 20px; }
          .bubble.ernesto{ border-radius: 22px; }
          .answerPara{ font-size: 15px; line-height: 1.68; }
          .sectionHeader{ padding: 11px 12px; }
          .sectionBody{ padding: 12px; }
          .statusCard{ padding: 14px; border-radius: 20px; }
          .authRow{ display:grid; grid-template-columns:1fr; }
          .authInput{ min-width:0; width:100%; }
          .responseSelect{ width: 100%; min-height: 46px; }
          .composer{ padding: 12px 0 calc(12px + env(safe-area-inset-bottom)); }
          .imagePreviewCard{ grid-template-columns: 64px 1fr auto; }
          .imagePreviewCard img{ width:64px; height:64px; }
          table{ font-size:12px !important; }
          .planBadge{ font-size: 11px; padding: 7px 9px; }
          .profileGrid{ grid-template-columns: 1fr; }
          .activeProjectStrip{ align-items:flex-start; flex-direction:column; margin-top: 8px; padding: 9px 10px; border-radius: 14px; }
          .statusCard{ padding: 11px; border-radius: 18px; }
          .userTopRow{ gap: 8px; }
          .userEmail{ font-size: 13px; }
          .userMeta{ font-size: 12px; line-height: 1.35; }
          .profilePanel{ padding: 11px; border-radius: 16px; }
          .mobileFaqToggle{ display:flex; width:100%; min-height:44px; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid rgba(226,232,240,.95); border-radius:16px; background:rgba(255,255,255,.95); font-weight:950; cursor:pointer; }
          .quickSection{ margin-top: 10px !important; }
          .quickSectionBody{ display: none; }
          .quickSection.open .quickSectionBody{ display:block; margin-top: 8px; }
          .quickSectionHeader{ display:none !important; }
          .composer{
            position: fixed;
            left: 8px;
            right: 8px;
            bottom: 0;
            z-index: 70;
            border: 1px solid rgba(226,232,240,.95);
            border-bottom: 0;
            border-radius: 22px 22px 0 0;
            padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
            background: rgba(255,255,255,0.97);
            box-shadow: 0 -18px 50px rgba(15,23,42,.14);
          }
          .composerModeRow{ display:grid; grid-template-columns: 1fr; gap: 7px; }
          .composerHint{ display:none; }
          .mobileAskLabel{ display:block; font-size: 12px; font-weight:950; opacity:.68; margin-bottom: -2px; }
        }

        @media (max-width: 420px){
          .appRoot{ padding: 8px; }
          .heroTitle{ font-size: 25px; }
          .heroShell{ padding: 12px; }
          .quickCard{ width: 86vw; }
          .pizzaLoad{ padding: 10px; }
          .pizzaLabel{ font-size:12px; line-height:1.35; }
        }

        @keyframes pizzaPulse{ 0%,100%{ transform: translateY(0) scale(1); } 50%{ transform: translateY(-2px) scale(1.02); } }
        @keyframes steamUp{ 0%{ opacity:0.15; transform: translateX(-50%) translateY(6px) scale(0.9); } 55%{ opacity:0.55; } 100%{ opacity:0; transform: translateX(-50%) translateY(-10px) scale(1.15); } }
        @keyframes ernestoIn { from { opacity: 0; transform: translateY(8px);} to { opacity: 1; transform: translateY(0);} }
      `}</style>

      <div className="mobileProjectBar">
        <button className="mobileProjectBtn" type="button" onClick={() => setProjectsOpen(true)}>
          <span>Projets</span>
          <span style={{ opacity: 0.68, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {projects.find((p) => p.id === activeProjectId)?.title ?? "Nouvelle demande"}
          </span>
        </button>
      </div>

      <div className="appFrame">
        <aside className={`projectRail ${projectsOpen ? "open" : ""}`}>
          <div className="projectRailHeader">
            <div>
              <div className="projectTitleSmall">Projets</div>
              <div className="projectSub">Gardez plusieurs fils de travail : levain, cuisson, farine, service.</div>
            </div>
            <button className="drawerClose" type="button" onClick={() => setProjectsOpen(false)} aria-label="Fermer les projets">×</button>
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
                      <button
                        className="miniBtn"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); startRenameProject(p); }}
                        aria-label="Renommer le projet"
                        title="Renommer"
                      >
                        Renommer
                      </button>
                      <button
                        className="projectDelete"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                        aria-label="Supprimer le projet"
                        title="Supprimer"
                      >
                        ×
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>

        <div className="workspace">

      {/* --- AUTH / USAGE BANNER --- */}
      <div style={{ display: "grid", gap: 12, marginBottom: 14 }}>
        {!session ? (
          <div className="statusCard">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div style={{ display: "inline-flex", marginBottom: 8 }} className="planBadge">Essai gratuit de 10 jours</div>
                <div style={{ fontWeight: 950, fontSize: 18 }}>Connectez-vous avec votre e-mail</div>
                <div style={{ marginTop: 6, opacity: 0.78, maxWidth: 700 }}>
                  Recevez un lien de connexion sécurisé. Aucun mot de passe n’est nécessaire. L’essai commence au premier accès par lien magique.
                </div>
              </div>
            </div>

            <div className="authRow">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre.email@exemple.fr"
                className="authInput"
                inputMode="email"
                autoComplete="email"
              />
              <button onClick={sendMagicLink} style={{ ...ui.btn, width: "auto" }}>
                Recevoir le lien magique
              </button>
            </div>
            {authInfo && <div style={{ marginTop: 10, opacity: 0.85 }}>{authInfo}</div>}
          </div>
        ) : (
          <div className="statusCard">
            <div className="userTopRow">
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: "inline-flex", marginBottom: 8 }} className="planBadge">
                  {subscriptionLabel(usage)}
                </div>
                <div className="userEmail">{session?.user?.email ?? "Utilisateur Ernesto"}</div>
                <div className="userMeta">
                  {usageLine ?? "Connecté. Posez votre première question pour afficher l’état de votre essai gratuit."}
                  {(personalProfile.profession || personalProfile.reason) ? (
                    <>
                      <br />
                      {personalProfile.profession ? `Profil : ${personalProfile.profession}` : ""}
                      {personalProfile.profession && personalProfile.reason ? " · " : ""}
                      {personalProfile.reason ? `Objectif : ${personalProfile.reason}` : ""}
                    </>
                  ) : null}
                </div>
                {usage && !usage.is_pro && !usage.is_admin ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ width: "100%", height: 10, background: "#f1f5f9", borderRadius: 999, overflow: "hidden", border: "1px solid #e2e8f0" }}>
                      <div style={{ width: `${usagePercent}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #f43f5e, #8b5cf6)", transition: "width 0.35s ease" }} />
                    </div>
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button onClick={() => setProfileOpen((v) => !v)} style={{ ...ui.pill, alignSelf: "flex-start" }}>
                  {profileOpen ? "Fermer le profil" : "Profil"}
                </button>
                <button onClick={logout} style={{ ...ui.pill, alignSelf: "flex-start" }}>
                  Se déconnecter
                </button>
              </div>
            </div>

            {profileOpen ? (
              <div className="profilePanel">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div>
                    <div style={{ fontWeight: 950 }}>Personnalisation</div>
                    <div style={{ fontSize: 13, opacity: 0.72, marginTop: 3 }}>
                      Ces informations aident Ernesto à adapter le niveau, les exemples et les priorités de réponse.
                    </div>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.66 }}>
                    {profileSavedAt ? "Enregistré localement" : ""}
                  </div>
                </div>

                <div className="profileGrid">
                  <label className="profileField">
                    <span className="profileLabel">Âge</span>
                    <input
                      className="profileInput"
                      value={personalProfile.age}
                      onChange={(e) => setPersonalProfile((p) => ({ ...p, age: e.target.value }))}
                      placeholder="ex. 32"
                      inputMode="numeric"
                    />
                  </label>
                  <label className="profileField">
                    <span className="profileLabel">Profession / activité</span>
                    <input
                      className="profileInput"
                      value={personalProfile.profession}
                      onChange={(e) => setPersonalProfile((p) => ({ ...p, profession: e.target.value }))}
                      placeholder="ex. élève EPPPN, pizzaiolo, boulanger, reconversion…"
                    />
                  </label>
                  <label className="profileField">
                    <span className="profileLabel">Niveau</span>
                    <input
                      className="profileInput"
                      value={personalProfile.level}
                      onChange={(e) => setPersonalProfile((p) => ({ ...p, level: e.target.value }))}
                      placeholder="ex. débutant, pro, formateur, passionné…"
                    />
                  </label>
                  <label className="profileField">
                    <span className="profileLabel">Langue / style préféré</span>
                    <input
                      className="profileInput"
                      value={personalProfile.preferredLanguage}
                      onChange={(e) => setPersonalProfile((p) => ({ ...p, preferredLanguage: e.target.value }))}
                      placeholder="ex. français simple, italien, très concret…"
                    />
                  </label>
                  <label className="profileField" style={{ gridColumn: "1 / -1" }}>
                    <span className="profileLabel">Pourquoi utilisez-vous Ernesto ?</span>
                    <textarea
                      className="profileTextarea"
                      value={personalProfile.reason}
                      onChange={(e) => setPersonalProfile((p) => ({ ...p, reason: e.target.value }))}
                      placeholder="ex. préparer un examen, corriger mes pâtes, ouvrir une pizzeria, mieux comprendre le levain…"
                    />
                  </label>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button className="miniBtn" type="button" onClick={() => setProfileOpen(false)}>Terminer</button>
                  <button className="miniBtn" type="button" onClick={resetPersonalProfile}>Réinitialiser</button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {paywall?.paywall ? (
          <div
            style={{
              padding: 16,
              border: "1px solid rgba(244,63,94,0.22)",
              borderRadius: 20,
              background: "linear-gradient(180deg, rgba(255,245,247,0.98), rgba(255,241,242,0.95))",
              boxShadow: "0 14px 34px rgba(244,63,94,0.08)",
            }}
          >
            <div style={{ fontWeight: 950, fontSize: 18 }}>Activer Ernesto Plus</div>
            <div style={{ marginTop: 8, lineHeight: 1.5 }}>
              {paywall.reason === "usage_limit_reached"
                ? "Votre essai gratuit a atteint sa limite de sécurité."
                : "Votre essai gratuit de 10 jours est terminé."}
            </div>
            <div style={{ marginTop: 10, opacity: 0.88 }}>
              Continuez à travailler sur les pâtes, les farines, le levain, la fermentation, la cuisson et l’organisation du banc.
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <div style={{ padding: 12, border: "1px solid rgba(244,63,94,0.14)", borderRadius: 16, background: "white" }}>
                <div style={{ fontSize: 13, opacity: .7 }}>Mensuel</div>
                <div style={{ fontSize: 24, fontWeight: 950 }}>19 € <span style={{ fontSize: 13, fontWeight: 800 }}>/ mois</span></div>
              </div>
              <div style={{ padding: 12, border: "1px solid rgba(139,92,246,0.18)", borderRadius: 16, background: "white" }}>
                <div style={{ fontSize: 13, opacity: .7 }}>Annuel</div>
                <div style={{ fontSize: 24, fontWeight: 950 }}>149 € <span style={{ fontSize: 13, fontWeight: 800 }}>/ an</span></div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 14 }}>
              <div>• questions écrites, messages audio et analyse d’images</div>
              <div>• réponses rapides ou analyses approfondies</div>
              <div>• accès aux raisonnements pédagogiques EPPPN</div>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={{ padding: "11px 15px", borderRadius: 14, fontWeight: 900, border: "1px solid rgba(244,63,94,0.2)", background: "linear-gradient(90deg, #f43f5e, #8b5cf6)", color: "white", cursor: "pointer" }} onClick={() => alert("Paiement à brancher : Stripe mensuel 19 € / annuel 149 €.")}>
                Activer Ernesto Plus
              </button>
              <button onClick={() => setPaywall(null)} style={{ padding: "11px 15px", borderRadius: 14, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>
                Plus tard
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <header className="heroShell">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ maxWidth: 760 }}>
            <div className="topCompactTitle">EPPPN · assistant de diagnostic</div>
            <h1 className="heroTitle">Ernesto, The Pizza Explained.</h1>
            <div className="heroIntro">
              Basé sur les connaissances et les protocoles transmis à l’EPPPN, Ernesto vous aide à raisonner sur les pâtes, les farines, le levain, la fermentation, la cuisson et l’organisation du travail. Il ne donne pas de recettes magiques : il transforme une observation en diagnostic, puis en protocole d’action.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <span className="planBadge">Écrire</span>
              <span className="planBadge">Parler</span>
              <span className="planBadge">Analyser une photo</span>
              <span className="planBadge">Décision & action</span>
              <span className="planBadge">Analyse & détails</span>
            </div>
          </div>

          <button onClick={newConversation} style={{ ...ui.pill, fontSize: 14 }}>
            Nouvelle conversation
          </button>
        </div>
      </header>

      <div className="activeProjectStrip">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, opacity: 0.66, fontWeight: 900 }}>Projet actif</div>
          <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {projects.find((p) => p.id === activeProjectId)?.title ?? "Nouvelle demande"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="miniBtn" type="button" onClick={renameActiveProject}>Renommer</button>
          <button className="miniBtn" type="button" onClick={newConversation}>Nouveau</button>
        </div>
      </div>

      <section className={`quickSection ${quickOpen ? "open" : ""}`} style={{ marginTop: 14 }}>
        <button className="mobileFaqToggle" type="button" onClick={() => setQuickOpen((v) => !v)}>
          <span>Questions fréquentes</span>
          <span style={{ opacity: 0.62 }}>{quickOpen ? "Masquer" : "Ouvrir"}</span>
        </button>
        <div className="quickSectionBody">
          <div className="quickSectionHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontWeight: 950, fontSize: 18 }}>Questions fréquentes</div>
            <div style={{ fontSize: 13, opacity: 0.68 }}>
              Situations réelles · 1 clic pour préremplir · double clic pour envoyer
            </div>
          </div>

        <div className="quickWrap">
          <button className="quickNavBtn" onClick={() => scrollQuick(-320)} aria-label="Faire défiler vers la gauche">
            ‹
          </button>
          <div
            className="quickRow"
            ref={quickRowRef}
            onMouseEnter={() => setPauseQuickScroll(true)}
            onMouseLeave={() => setPauseQuickScroll(false)}
            onTouchStart={() => setPauseQuickScroll(true)}
            onTouchEnd={() => setPauseQuickScroll(false)}
          >
            {quickQuestions.map((q, idx) => (
              <button
                key={`${q.label}-${idx}`}
                className={`quickCard ${selectedQuestion === q.label ? "selected" : ""}`}
                onClick={() => handleQuestionClick(q)}
                onDoubleClick={() => handleQuestionDoubleClick(q)}
                aria-pressed={selectedQuestion === q.label}
                title="1 clic : préremplir · 2 clics : envoyer à Ernesto"
              >
                <div className="quickKicker">{q.category}</div>
                <div className="quickLabel">{q.label}</div>
                <div className="quickText">{q.text}</div>
              </button>
            ))}
          </div>
          <button className="quickNavBtn" onClick={() => scrollQuick(320)} aria-label="Faire défiler vers la droite">
            ›
          </button>
        </div>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        {chat.length === 0 ? (
          <div style={{ opacity: 0.72, fontSize: 14, padding: "8px 2px" }}>Commencez par une situation concrète : une pâte qui colle, un levain trop acide, une cuisson irrégulière, une photo de cornicione ou une question d’organisation au banc.</div>
        ) : (
          chat.map((m) => (
            <div
              key={m.id}
              className="bubbleWrap"
              style={{ justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}
            >
              <div className={`bubble ${m.role}`}>
                {m.role === "user" ? <div>{m.text}</div> : null}

                {m.role === "ernesto" ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    {m.text?.trim() ? (
                      <>
                        <Section title="Réponse Ernesto" headerClass="hAnswer">
                        <div
                          style={{
                            display: "grid",
                            gap: 12,
                          }}
                        >
                          <AnswerText text={m.text} />
                        </div>
                        </Section>
                      </>
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

      {/* composer */}
      <div className="composer">
        <div style={{ display: "grid", gap: 10 }}>
          <div className="composerModeRow">
            <label style={{ fontWeight: 900 }}>Type de réponse</label>
            <select
              value={speed}
              onChange={(e) => setSpeed(e.target.value as Speed)}
              className="responseSelect"
            >
              <option value="BANCO">Réponse rapide — décision & action</option>
              <option value="ECOLE">Réponse approfondie — analyse & détails</option>
            </select>

            <div className="composerHint">
              {loading ? "Analyse en cours · Ernesto structure la réponse…" : "Entrée = envoyer · Shift+Entrée = nouvelle ligne"}
            </div>

          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;

              try {
                const MAX_BYTES = 600 * 1024; // 600KB target
                let out: File = f;

                if (f.size > MAX_BYTES) {
                  out = await compressImageToJpeg(f, 1280, 0.72);
                  if (out.size > MAX_BYTES) {
                    out = await compressImageToJpeg(f, 960, 0.60);
                  }
                }

                setSelectedImage(out);
              } catch {
                setSelectedImage(f); // fallback se compressione fallisce
              }

              e.currentTarget.value = "";
            }}
          />

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

          <div className="mobileAskLabel">Votre question</div>

          {/* mobile grid: mic + textarea + camera */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr 44px",
              gap: 10,
              alignItems: "end",
            }}
          >
            <button
              type="button"
              onClick={toggleDictation}
              style={{
                ...ui.iconBtn,
                borderColor: dictating ? "#0ea5e9" : "#ddd",
                background: dictating ? "rgba(14,165,233,0.10)" : "white",
              }}
              title="Parler à Ernesto"
            >
              🎤
            </button>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  askTutor(message);
                }
              }}
              rows={3}
              placeholder="Écrivez votre question, décrivez un problème ou ajoutez une photo…"
              style={ui.textarea}
            />

            <button type="button" onClick={() => fileRef.current?.click()} style={ui.iconBtn} title="Analyser une photo">
              📷
            </button>
          </div>

          <button
            onClick={() => askTutor(message)}
            disabled={loading || !message.trim()}
            style={{
              ...ui.btn,
              width: "100%",
              opacity: loading || !message.trim() ? 0.6 : 1,
              cursor: loading || !message.trim() ? "not-allowed" : "pointer",
            }}
          >
            {loading ? <PizzaLoader ms={loadingMs} done={pizzaDone} /> : "Demander à Ernesto"}
          </button>
        </div>
      </div>
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
