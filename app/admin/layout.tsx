"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import AdminLargePdfBridge from "./AdminLargePdfBridge";
import AdminLargePdfPanelV2 from "./AdminLargePdfPanelV2";
import AdminPilotConsole from "./AdminPilotConsole";
import AdminRagUsagePanel from "./AdminRagUsagePanel";
import AdminRolesPanel from "./AdminRolesPanel";

type AdminSection = "pilot" | "management" | "knowledge" | "roles";

const ADMIN_SECTIONS: Array<{ key: AdminSection; label: string; note: string }> = [
  { key: "pilot", label: "Pilotage", note: "Santé, stagiaires, qualité et coûts" },
  { key: "management", label: "Utilisateurs", note: "Accréditer par email, suspendre ou prolonger les accès" },
  { key: "knowledge", label: "Connaissances EPPPN", note: "PDF, RAG et diagnostic documentaire" },
  { key: "roles", label: "Rôles", note: "Utilisateur, formateur, administrateur" },
];

function isAdminSection(value: unknown): value is AdminSection {
  return value === "pilot" || value === "management" || value === "knowledge" || value === "roles";
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [section, setSection] = useState<AdminSection>("pilot");

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("ernesto_admin_section");
      if (isAdminSection(saved)) setSection(saved);
    } catch {
      // sessionStorage may be unavailable in restrictive browser modes.
    }
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const requested = (event as CustomEvent<{ section?: string }>).detail?.section;
      if (!isAdminSection(requested)) return;
      setSection(requested);
      try {
        window.sessionStorage.setItem("ernesto_admin_section", requested);
      } catch {
        // no-op
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("ernesto:admin-section", handler as EventListener);
    return () => window.removeEventListener("ernesto:admin-section", handler as EventListener);
  }, []);

  function openSection(next: AdminSection) {
    setSection(next);
    try {
      window.sessionStorage.setItem("ernesto_admin_section", next);
    } catch {
      // no-op
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    let active = true;

    async function verifyAdmin() {
      if (!supabase) {
        window.location.replace("/");
        return;
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        window.location.replace("/connexion");
        return;
      }

      const response = await fetch("/api/admin/check", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!active) return;

      if (response.status === 401) {
        window.location.replace("/connexion");
        return;
      }

      if (!response.ok) {
        window.location.replace("/");
        return;
      }

      setAuthorized(true);
      setChecking(false);
    }

    verifyAdmin().catch(() => {
      if (active) window.location.replace("/");
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  if (checking || !authorized) {
    return (
      <main
        style={{
          minHeight: "100svh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          color: "#315d45",
          background: "#fffaf5",
        }}
      >
        <div style={{ fontWeight: 800 }}>Vérification de l’accès administrateur…</div>
      </main>
    );
  }

  return (
    <div className="adminWorkspace">
      <style>{workspaceCss}</style>

      <div className="adminNavShell">
        <div className="adminNavInner">
          <div className="adminNavBrand">
            <span>ADMIN</span>
            <strong>Ernesto</strong>
          </div>

          <nav className="adminTabs" aria-label="Sections d’administration">
            {ADMIN_SECTIONS.map((item) => (
              <button
                type="button"
                key={item.key}
                className={section === item.key ? "active" : ""}
                onClick={() => openSection(item.key)}
              >
                <strong>{item.label}</strong>
                <small>{item.note}</small>
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="adminSectionIntro">
        <div>
          <span>{ADMIN_SECTIONS.find((item) => item.key === section)?.label}</span>
          <p>{ADMIN_SECTIONS.find((item) => item.key === section)?.note}</p>
        </div>
      </div>

      <div className="adminSectionBody">
        <div className={section === "pilot" ? "adminPane active" : "adminPane"} aria-hidden={section !== "pilot"}>
          <AdminPilotConsole />
        </div>

        <div className={section === "management" ? "adminPane active" : "adminPane"} aria-hidden={section !== "management"}>
          {children}
        </div>

        <div className={section === "knowledge" ? "adminPane active" : "adminPane"} aria-hidden={section !== "knowledge"}>
          <AdminLargePdfPanelV2 />
          <AdminRagUsagePanel />
        </div>

        <div className={section === "roles" ? "adminPane active" : "adminPane"} aria-hidden={section !== "roles"}>
          <AdminRolesPanel />
        </div>
      </div>

      <AdminLargePdfBridge />
    </div>
  );
}

const workspaceCss = `
  .adminWorkspace{min-height:100svh;background:#f6f7f4;color:#172132}
  .adminNavShell{position:sticky;top:0;z-index:40;background:rgba(250,251,248,.96);backdrop-filter:blur(14px);border-bottom:1px solid #dde3d9}
  .adminNavInner{max-width:1480px;margin:0 auto;padding:13px clamp(14px,3vw,34px);display:flex;align-items:center;gap:22px}
  .adminNavBrand{display:flex;align-items:center;gap:8px;white-space:nowrap;padding-right:14px;border-right:1px solid #dde3d9}.adminNavBrand span{font-size:9px;font-weight:950;letter-spacing:.14em;color:#73806d}.adminNavBrand strong{font-size:15px;letter-spacing:-.02em;color:#31402f}
  .adminTabs{display:flex;align-items:stretch;gap:6px;overflow:auto;scrollbar-width:none;flex:1}.adminTabs::-webkit-scrollbar{display:none}.adminTabs button{border:1px solid transparent;background:transparent;border-radius:12px;padding:8px 11px;min-width:max-content;text-align:left;cursor:pointer;color:#687567;transition:background .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease}.adminTabs button strong{display:block;font-size:12px;font-weight:900}.adminTabs button small{display:block;margin-top:2px;font-size:9px;color:#8b9588;font-weight:650}.adminTabs button:hover{background:#f1f4ee}.adminTabs button.active{background:#fff;border-color:#dbe2d6;color:#35452f;box-shadow:0 4px 14px rgba(34,49,31,.06)}.adminTabs button.active small{color:#6d7969}
  .adminSectionIntro{max-width:1480px;margin:0 auto;padding:16px clamp(18px,4vw,58px) 2px}.adminSectionIntro span{display:block;font-size:11px;font-weight:950;letter-spacing:.09em;text-transform:uppercase;color:#627052}.adminSectionIntro p{margin:3px 0 0;font-size:12px;color:#879083}
  .adminSectionBody{min-height:70vh}.adminPane{display:none}.adminPane.active{display:block}
  @media(max-width:820px){.adminNavInner{display:grid;gap:9px}.adminNavBrand{border-right:0;padding-right:0}.adminTabs{margin:0 -2px;padding-bottom:1px}.adminTabs button small{display:none}.adminTabs button{padding:8px 10px}.adminSectionIntro{padding-top:12px}}
`;
