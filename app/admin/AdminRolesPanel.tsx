"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

type AppRole = "user" | "formateur" | "admin";

type RoleRow = {
  email: string;
  full_name?: string | null;
  role: AppRole;
  system_admin: boolean;
  active: boolean;
  linked: boolean;
};

const ROLE_LABELS: Record<AppRole, string> = {
  user: "Utilisateur",
  formateur: "Formateur EPPPN",
  admin: "Administrateur",
};

const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  user: "Utilise Ernesto normalement, sans accès à l’administration.",
  formateur: "Identifie un formateur EPPPN. Accès à Ernesto, sans droits d’administration.",
  admin: "Accès complet à /admin : stagiaires, statistiques, documents RAG et rôles.",
};

export default function AdminRolesPanel() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [rows, setRows] = useState<RoleRow[]>([]);
  const [currentEmail, setCurrentEmail] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function token() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadRoles() {
    setLoading(true);
    setError("");
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Session administrateur introuvable.");
      const response = await fetch("/api/admin/roles", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || data?.error || "Chargement des rôles impossible.");
      setRows(data.roles || []);
      setCurrentEmail(data.current_email || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement des rôles impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeRole(row: RoleRow, role: AppRole) {
    if (role === row.role) return;
    const label = ROLE_LABELS[role];
    if (!window.confirm(`Attribuer le rôle « ${label} » à ${row.email} ?`)) return;

    setUpdating(row.email);
    setMessage("");
    setError("");
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Session administrateur introuvable.");
      const response = await fetch("/api/admin/roles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ email: row.email, role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || data?.error || "Modification impossible.");
      setRows((prev) => prev.map((item) => item.email === row.email ? { ...item, role } : item));
      setMessage(`${row.email} · rôle « ${label} » enregistré.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Modification impossible.");
    } finally {
      setUpdating("");
    }
  }

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => `${row.full_name || ""} ${row.email} ${ROLE_LABELS[row.role]}`.toLowerCase().includes(q));
  }, [rows, query]);

  const counts = useMemo(() => rows.reduce(
    (acc, row) => {
      acc[row.role] += 1;
      return acc;
    },
    { user: 0, formateur: 0, admin: 0 } as Record<AppRole, number>
  ), [rows]);

  return (
    <section className="rolesAdminShell">
      <style>{css}</style>
      <div className="rolesCard">
        <div className="rolesHead">
          <div>
            <div className="rolesKicker">Permissions</div>
            <h2>Rôles Ernesto</h2>
            <p>Le rôle est indépendant de la durée d’accès. Une adresse peut rester en pause ou expirer même si elle est identifiée comme formateur.</p>
          </div>
          <div className="roleCounts" aria-label="Répartition des rôles">
            <span><b>{counts.user}</b> utilisateurs</span>
            <span><b>{counts.formateur}</b> formateurs</span>
            <span className="adminCount"><b>{counts.admin}</b> admins</span>
          </div>
        </div>

        <div className="roleLegend">
          {(["user", "formateur", "admin"] as AppRole[]).map((role) => (
            <div key={role} className={`legendItem legend-${role}`}>
              <strong>{ROLE_LABELS[role]}</strong>
              <span>{ROLE_DESCRIPTIONS[role]}</span>
            </div>
          ))}
        </div>

        <div className="roleToolbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une adresse ou un rôle…" />
          <button onClick={loadRoles} disabled={loading}>{loading ? "Actualisation…" : "Actualiser"}</button>
        </div>

        {message ? <div className="roleNotice success">{message}</div> : null}
        {error ? <div className="roleNotice error">{error}</div> : null}

        <div className="roleTableWrap">
          <table className="roleTable">
            <thead>
              <tr>
                <th>Compte</th>
                <th>Rôle</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const locked = row.system_admin || (row.email === currentEmail && row.role === "admin");
                return (
                  <tr key={row.email}>
                    <td>
                      <strong>{row.full_name || "—"}</strong>
                      <small>{row.email}</small>
                    </td>
                    <td>
                      <div className="roleSelectLine">
                        <select
                          value={row.role}
                          disabled={updating === row.email || row.system_admin}
                          onChange={(e) => changeRole(row, e.target.value as AppRole)}
                          className={`roleSelect role-${row.role}`}
                          aria-label={`Rôle de ${row.email}`}
                        >
                          <option value="user">Utilisateur</option>
                          <option value="formateur">Formateur EPPPN</option>
                          <option value="admin">Administrateur</option>
                        </select>
                        {updating === row.email ? <span className="saving">Enregistrement…</span> : null}
                        {row.system_admin ? <span className="systemBadge">Admin système</span> : null}
                        {locked && !row.system_admin ? <span className="selfHint">Votre compte</span> : null}
                      </div>
                    </td>
                    <td>
                      <span className={`accountState ${row.active ? "active" : "inactive"}`}><i />{row.active ? "Accès autorisé" : "Accès suspendu"}</span>
                      <small>{row.linked ? "Compte activé" : "Invitation / activation en attente"}</small>
                    </td>
                  </tr>
                );
              })}
              {!visibleRows.length ? <tr><td colSpan={3} className="roleEmpty">Aucun compte correspondant.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <p className="roleFootnote">Sécurité : un administrateur système ne peut pas être rétrogradé depuis cette page, et vous ne pouvez pas retirer votre propre rôle administrateur.</p>
      </div>
    </section>
  );
}

const css = `
.rolesAdminShell{background:#f6f7f4;padding:0 clamp(18px,4vw,58px) 70px;font-family:var(--font-geist-sans),system-ui,sans-serif;color:#172132}.rolesCard{max-width:1380px;margin:0 auto;background:#fff;border:1px solid #e3e7df;border-radius:21px;box-shadow:0 10px 32px rgba(23,33,50,.045);padding:22px}.rolesHead{display:flex;justify-content:space-between;align-items:flex-start;gap:22px}.rolesKicker{font-size:11px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#455b6d}.rolesHead h2{margin:4px 0 6px;font-size:22px;letter-spacing:-.025em}.rolesHead p{margin:0;color:#64748b;line-height:1.55;max-width:760px}.roleCounts{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.roleCounts span{padding:7px 10px;border-radius:999px;background:#f3f5f7;color:#566272;font-size:11px;font-weight:750;white-space:nowrap}.roleCounts .adminCount{background:#eef3f6;color:#455b6d}.roleCounts b{font-size:13px}.roleLegend{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}.legendItem{border:1px solid #e6e9e5;border-radius:14px;padding:12px 13px;background:#fafbfa}.legendItem strong{display:block;font-size:12px;margin-bottom:4px}.legendItem span{display:block;color:#7a8490;font-size:11px;line-height:1.4}.legend-user{border-left:4px solid #94a3b8}.legend-formateur{border-left:4px solid #6f7d3c}.legend-admin{border-left:4px solid #455b6d}.roleToolbar{display:flex;gap:9px;margin-bottom:12px}.roleToolbar input{flex:1;min-width:0;border:1px solid #dfe4df;border-radius:12px;padding:10px 12px;background:#fff;color:#172132;outline:none}.roleToolbar input:focus{border-color:#9aa8b2;box-shadow:0 0 0 3px rgba(69,91,109,.08)}.roleToolbar button{border:1px solid #d9dfd5;background:#fff;color:#435331;border-radius:12px;padding:9px 13px;font-weight:800;cursor:pointer}.roleToolbar button:disabled{opacity:.5}.roleNotice{padding:10px 12px;border-radius:12px;font-size:12px;margin:8px 0}.roleNotice.success{background:#f0f5ec;color:#435331;border:1px solid #d5e1cc}.roleNotice.error{background:#fff2ed;color:#8c442d;border:1px solid #eed4ca}.roleTableWrap{overflow:auto;border:1px solid #e7eae6;border-radius:15px}.roleTable{width:100%;border-collapse:collapse;min-width:720px}.roleTable th{background:#fafbfa;color:#77818b;font-size:10px;letter-spacing:.055em;text-transform:uppercase;text-align:left;padding:10px 13px}.roleTable td{padding:12px 13px;border-top:1px solid #ecefec;vertical-align:middle}.roleTable td:first-child strong,.roleTable td:first-child small,.roleTable td:last-child small{display:block}.roleTable td small{color:#8a929a;margin-top:3px;font-size:11px}.roleSelectLine{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.roleSelect{border:1px solid #dbe0df;border-radius:999px;padding:7px 30px 7px 11px;font-size:11px;font-weight:850;background:#f8faf9;color:#475569;cursor:pointer}.roleSelect.role-formateur{background:#f1f5ec;color:#52602f;border-color:#d6dfca}.roleSelect.role-admin{background:#eef3f6;color:#455b6d;border-color:#cfdbe3}.roleSelect:disabled{cursor:not-allowed;opacity:.72}.systemBadge,.selfHint,.saving{font-size:10px;font-weight:800;padding:5px 7px;border-radius:999px}.systemBadge{background:#172132;color:#fff}.selfHint{background:#f0f3f5;color:#5a6670}.saving{color:#718096}.accountState{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800}.accountState i{width:7px;height:7px;border-radius:50%}.accountState.active{color:#52602f}.accountState.active i{background:#6f7d3c}.accountState.inactive{color:#9a5c47}.accountState.inactive i{background:#b4684d}.roleEmpty{text-align:center;color:#8a929a;padding:24px!important}.roleFootnote{margin:12px 2px 0;color:#8a929a;font-size:10.5px;line-height:1.45}@media(max-width:820px){.rolesHead{flex-direction:column}.roleCounts{justify-content:flex-start}.roleLegend{grid-template-columns:1fr}.roleToolbar{flex-direction:column}.rolesCard{padding:16px}.rolesAdminShell{padding-left:12px;padding-right:12px}}
`;
