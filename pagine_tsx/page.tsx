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

type Speed = "VITE" | "APPROFONDIE";

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
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

const QUICK_QUESTIONS: Array<{ label: string; text: string }> = [
  {
    label: "W260 vs W320",
    text: "Comparer W260 vs W320 pour fermentation 48h au froid : risques, choix et protocole de contrôle.",
  },
  { label: "Cornicione serré", text: "Cornicione serré, pâte peu extensible : protocole de correction en 48h froid ?" },
  { label: "Levain trop acide", text: "Levain trop acide : comment stabiliser sans perdre la force ?" },
  { label: "Sole trop chaude", text: "Sole trop chaude et dessus pâle : comment équilibrer la cuisson dans un four électrique ?" },
  { label: "Choisir un four", text: "Choisir un four électrique : critères, risques, tests de contrôle à faire ?" },
  { label: "Marge Margherita", text: "Pourquoi une Margherita est souvent plus rentable qu’une pizza gourmet très garnie ?" },
  { label: "Hausse farine", text: "Impact d’une hausse de 10% du prix de la farine sur la marge : comment raisonner ?" },
  { label: "Plan service", text: "Proposer un plan de production (timeline) pour service du soir avec pâte au froid." },
];

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
    maxWidth: 1120,
    margin: "0 auto",
    padding: 18,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    color: "#0f172a",
    background:
      "radial-gradient(circle at top left, rgba(244,114,182,0.08), transparent 28%), radial-gradient(circle at top right, rgba(99,102,241,0.08), transparent 26%)",
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
  rec.lang = "fr-FR"; // cambia in "it-IT" se vuoi
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
  const [speed, setSpeed] = useState<Speed>("VITE");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
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
    is_pro?: boolean;
  }>(null);

  // paywall payload (when 402)
  const [paywall, setPaywall] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function sendMagicLink() {
    setAuthInfo(null);
    const e = email.trim();
    if (!e) return setAuthInfo("Indique un email.");
    const { error } = await supabase.auth.signInWithOtp({
      email: e,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) return setAuthInfo(error.message);
    setAuthInfo("Lien envoyé. Ouvre ton email et clique sur le lien de connexion.");
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
  const [dictating, setDictating] = useState(false);
  const stopDictRef = useRef<null | (() => void)>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const quickRowRef = useRef<HTMLDivElement | null>(null);

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

  async function askTutor(text: string) {
    const userText = text.trim();
    if (!userText || loading) return;

    // must be logged in (we need bearer token)
    if (!session?.access_token) {
      setAuthInfo("Connecte-toi pour utiliser Ernesto (essai gratuit inclus).");
      return;
    }

    setPaywall(null); // close paywall on new ask attempt
    setPizzaDone(false);
    setChat((prev) => [...prev, { id: uid(), role: "user", text: userText }]);
    setLoading(true);

    try {
      let res: Response;

      // se c'è foto -> FormData
      if (selectedImage) {
        const fd = new FormData();
        fd.append("message", userText);
        fd.append("speed", speed);
        fd.append("isFirstTurn", String(chat.length === 0));
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
            isFirstTurn: chat.length === 0,
            speed,
          }),
        });
      }

      const data = await res.json();

      // 401: not logged / invalid session
      if (res.status === 401) {
        setAuthInfo("Session invalide. Reconnecte-toi.");
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
      setChat((prev) => [...prev, { id: uid(), role: "ernesto", text: text_fr, graph }]);
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
    setChat([]);
    setMessage("");
    setSelectedImage(null);
    setPaywall(null);
  }

  function scrollQuick(dx: number) {
    if (!quickRowRef.current) return;
    quickRowRef.current.scrollBy({ left: dx, behavior: "smooth" });
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
      alert("Micro (dictée) non supporté sur ce navigateur. Sur iPhone, c’est fréquent.");
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

  const usageLine =
    usage?.is_admin
      ? "Mode administrateur — accès illimité"
      : usage?.is_pro
      ? "Ernesto Pro activé — analyses illimitées"
      : usage
      ? `Capacité Ernesto : ${usage.remaining} / 10 analyses disponibles${usage.trial_ends_at ? ` — essai jusqu’au ${new Date(usage.trial_ends_at).toLocaleDateString()}` : ""}`
      : null;

  const usagePercent =
    usage && !usage.is_pro && !usage.is_admin
      ? Math.max(0, Math.min(100, (usage.remaining / 10) * 100))
      : 100;

  return (
    <main style={ui.page}>
      <style>{`
        .bubbleWrap { display:flex; margin: 12px 0; }
        .bubble {
          max-width: 92%;
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
          background: linear-gradient(180deg, rgba(255,247,237,0.98), rgba(255,237,213,0.90));
          border-color: rgba(251,146,60,0.30);
          animation: ernestoIn 280ms ease;
        }
        .quickWrap { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; }
        .quickNavBtn {
          border: 1px solid #e2e8f0; background: rgba(255,255,255,0.96); width: 42px; height: 42px; border-radius: 14px; cursor: pointer; font-weight: 900;
          box-shadow: 0 8px 24px rgba(15,23,42,0.05);
        }
        .quickRow { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; padding-left: 2px; padding-right: 2px; -webkit-overflow-scrolling: touch; scroll-snap-type: x mandatory; }
        .quickCard {
          flex: 0 0 auto; width: 258px; border-radius: 22px; padding: 14px 15px; cursor: pointer; text-align: left;
          border: 1px solid rgba(139,92,246,0.14);
          background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.96));
          box-shadow: 0 12px 30px rgba(15,23,42,0.05);
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
          scroll-snap-align: start; color: #111;
        }
        .quickCard:hover { transform: translateY(-2px); border-color: rgba(244,63,94,0.22); box-shadow: 0 18px 38px rgba(15,23,42,0.09); }
        .quickKicker { font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; opacity: .52; }
        .quickLabel { font-weight: 950; font-size: 16px; line-height: 1.2; margin-top: 8px; }
        .quickText { margin-top: 8px; font-size: 12px; line-height: 1.45; opacity: 0.82; }

        .sectionShell { border-radius: 20px; border: 1px solid #eee; overflow: hidden; background: white; box-shadow: 0 10px 28px rgba(15,23,42,0.04); }
        .sectionHeader { padding: 12px 14px; font-weight: 950; font-size: 13px; letter-spacing: 0.2px; }
        .sectionBody { padding: 14px; border-top: 1px solid #eee; }

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
          display:flex;
          align-items:center;
          gap:12px;
          padding:12px 14px;
          border: 1px solid rgba(251,146,60,0.30);
          background: linear-gradient(180deg, rgba(255,247,237,0.96), rgba(255,237,213,0.82));
          border-radius: 18px;
          box-shadow: 0 10px 30px rgba(154,52,18,0.10);
          overflow: hidden;
        }
        .pizzaMotion{
          flex: 0 0 auto;
          transform: translateX(0);
          transition: transform 650ms cubic-bezier(.22,.8,.24,1);
        }
        .pizzaLoad.done .pizzaMotion{ transform: translateX(220px); }
        .pizzaCenter{ display:grid; gap:6px; flex: 1 1 auto; min-width: 0; }
        .pizzaTrack{
          position: relative; width: 100%; height: 10px; background: rgba(255,255,255,0.75);
          border-radius: 999px; overflow: hidden; border: 1px solid rgba(251,146,60,0.16);
        }
        .pizzaFill{ height: 100%; border-radius: 999px; background: linear-gradient(90deg, #fb923c, #f43f5e); transition: width 160ms linear; }
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
        }
        .planBadge{
          display:inline-flex; align-items:center; gap:8px; padding: 7px 11px; border-radius:999px; font-size:12px; font-weight:900; letter-spacing:.02em;
          border:1px solid #e2e8f0; background:rgba(255,255,255,.9);
        }

        @keyframes pizzaPulse{ 0%,100%{ transform: translateY(0) scale(1); } 50%{ transform: translateY(-2px) scale(1.02); } }
        @keyframes steamUp{ 0%{ opacity:0.15; transform: translateX(-50%) translateY(6px) scale(0.9); } 55%{ opacity:0.55; } 100%{ opacity:0; transform: translateX(-50%) translateY(-10px) scale(1.15); } }
        @keyframes ernestoIn { from { opacity: 0; transform: translateY(8px);} to { opacity: 1; transform: translateY(0);} }
      `}</style>

      {/* --- AUTH / USAGE BANNER --- */}
      <div style={{ display: "grid", gap: 12, marginBottom: 14 }}>
        {!session ? (
          <div className="statusCard">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div style={{ display: "inline-flex", marginBottom: 8 }} className="planBadge">⚡ Essai gratuit</div>
                <div style={{ fontWeight: 950, fontSize: 18 }}>Connectez-vous à Ernesto</div>
                <div style={{ marginTop: 6, opacity: 0.78, maxWidth: 660 }}>
                  Le tuteur virtuel de l’EPPPN vous accompagne avec des diagnostics, des actions concrètes et des repères visuels.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email"
                style={{ flex: 1, minWidth: 240, padding: 12, border: "1px solid #cbd5e1", borderRadius: 14, background: "white" }}
              />
              <button onClick={sendMagicLink} style={{ ...ui.btn, width: "auto" }}>
                Envoyer le lien
              </button>
            </div>
            {authInfo && <div style={{ marginTop: 10, opacity: 0.85 }}>{authInfo}</div>}
          </div>
        ) : (
          <div className="statusCard" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: "inline-flex", marginBottom: 8 }} className="planBadge">
                {usage?.is_admin ? "🛡️ Admin" : usage?.is_pro ? "🟣 Ernesto Pro" : "⚡ Gratuit"}
              </div>
              <div style={{ fontWeight: 950, fontSize: 16 }}>
                {usageLine ?? "Connecté. Posez votre première question pour initialiser l’essai gratuit."}
              </div>
              {usage && !usage.is_pro && !usage.is_admin ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ width: "100%", height: 10, background: "#f1f5f9", borderRadius: 999, overflow: "hidden", border: "1px solid #e2e8f0" }}>
                    <div style={{ width: `${usagePercent}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #f43f5e, #8b5cf6)", transition: "width 0.35s ease" }} />
                  </div>
                </div>
              ) : null}
            </div>
            <button onClick={logout} style={{ ...ui.pill, alignSelf: "flex-start" }}>
              Se déconnecter
            </button>
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
            <div style={{ fontWeight: 950, fontSize: 18 }}>🔓 Débloquer Ernesto Pro</div>
            <div style={{ marginTop: 8, lineHeight: 1.5 }}>
              {paywall.reason === "quota_reached"
                ? "Vous avez utilisé les analyses gratuites disponibles."
                : "Votre période d’essai est terminée."}
            </div>
            <div style={{ marginTop: 10, opacity: 0.88 }}>
              Continuez avec des analyses illimitées, des réponses plus approfondies et des protocoles précis inspirés de la méthode EPPPN.
            </div>
            <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 14 }}>
              <div>• diagnostics plus approfondis</div>
              <div>• protocoles détaillés</div>
              <div>• assistance illimitée</div>
            </div>
            {paywall.usage ? (
              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.78 }}>
                Analyses utilisées : {paywall.usage.used} · restantes : {paywall.usage.remaining}
              </div>
            ) : null}
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={{ padding: "11px 15px", borderRadius: 14, fontWeight: 900, border: "1px solid rgba(244,63,94,0.2)", background: "linear-gradient(90deg, #f43f5e, #8b5cf6)", color: "white", cursor: "pointer" }} onClick={() => alert("TODO: intégrer Stripe / achats in-app")}>
                Passer en Pro
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
            <div className="planBadge" style={{ marginBottom: 10 }}>🍕 Ernesto · The Pizza, Explained</div>
            <h1 style={{ fontSize: 42, lineHeight: 1.04, margin: 0, letterSpacing: "-0.03em" }}>Le tuteur technique qui transforme une question en protocole clair.</h1>
            <div style={{ marginTop: 12, opacity: 0.86, fontSize: 16, lineHeight: 1.6 }}>
              Tuteur virtuel officiel de l’École Professionnelle de Pizza et Panification Naturelle (EPPPN). Diagnostic, actions concrètes, repères visuels et graphiques scientifiques.
            </div>
          </div>

          <button onClick={newConversation} style={{ ...ui.pill, fontSize: 14 }}>
            Nouvelle conversation
          </button>
        </div>
      </header>

      <section style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 950, marginBottom: 8, fontSize: 18 }}>Questions fréquentes</div>
        <div className="quickWrap">
          <button className="quickNavBtn" onClick={() => scrollQuick(-320)}>
            ‹
          </button>
          <div className="quickRow" ref={quickRowRef}>
            {QUICK_QUESTIONS.map((q, idx) => (
              <button key={idx} className="quickCard" onClick={() => setMessage(q.text)}>
                <div className="quickKicker">{idx < 3 ? "Technique" : idx < 6 ? "Gestion" : "Production"}</div>
                <div className="quickLabel">{q.label}</div>
                <div className="quickText">{q.text}</div>
              </button>
            ))}
          </div>
          <button className="quickNavBtn" onClick={() => scrollQuick(320)}>
            ›
          </button>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        {chat.length === 0 ? (
          <div style={{ opacity: 0.72, fontSize: 14, padding: "8px 2px" }}>Commencez avec une question précise, un problème de pâte ou une photo. Ernesto construira une réponse actionnable, puis des graphiques si le cas s’y prête.</div>
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
                      <Section title="Réponse d’Ernesto" headerClass="hAnswer">
                        <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
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

      {/* composer */}
      <div className="composer">
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontWeight: 900 }}>Vitesse</label>
            <select
              value={speed}
              onChange={(e) => setSpeed(e.target.value as Speed)}
              style={{
                padding: 10,
                borderRadius: 14,
                border: "1px solid #ddd",
                fontSize: 14,
                background: "white",
                color: "#111",
              }}
            >
              <option value="VITE">Vite</option>
              <option value="APPROFONDIE">Approfondie</option>
            </select>

            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {loading ? "Ernesto prépare sa réponse…" : "Entrée = envoyer · Shift+Entrée = nouvelle ligne"}
            </div>

            {selectedImage ? (
              <div className="attachPill" title="Photo prête à envoyer">
                <span>📷</span>
                <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedImage.name}
                </span>
                <button className="attachX" type="button" onClick={() => setSelectedImage(null)} aria-label="Retirer la photo">
                  ×
                </button>
              </div>
            ) : null}
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
              title="Micro (dictée)"
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
              placeholder="Écris ici…"
              style={ui.textarea}
            />

            <button type="button" onClick={() => fileRef.current?.click()} style={ui.iconBtn} title="Photo (camera)">
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
            {loading ? <PizzaLoader ms={loadingMs} done={pizzaDone} /> : "Envoyer à Ernesto"}
          </button>
        </div>
      </div>
    </main>
  );
}

function PizzaLoader({ ms, done }: { ms: number; done: boolean }) {
  const expected = 9000;
  const p = Math.min(0.95, ms / expected);

  return (
    <div className={`pizzaLoad ${done ? "done" : ""}`} aria-label="Ernesto prépare ta réponse">
      <div className="pizzaMotion">
        <div className="pizzaIcon" />
      </div>
      <div className="pizzaCenter">
        <div className="pizzaTrack">
          <div className="pizzaFill" style={{ width: `${Math.round(p * 100)}%` }} />
        </div>
        <div className="pizzaLabel">
          {done ? "Réponse prête — Ernesto vous la sert." : "Ernesto prépare votre réponse…"}
        </div>
      </div>
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
