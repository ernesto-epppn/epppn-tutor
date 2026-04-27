"use client";

import { useEffect, useState } from "react";

type Stats = {
  users_total: number;
  users_last_7d: number;
  total_queries: number;
  top_users: Array<{
    user_id: string;
    free_queries_used: number;
    trial_started_at?: string | null;
    updated_at?: string | null;
  }>;
};

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    setStats(null);
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { "x-admin-key": key },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur");
      setStats(data);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // no auto-load
  }, []);

  return (
    <main style={{ maxWidth: 980, margin: "20px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ margin: 0 }}>Ernesto — Admin</h1>
      <p style={{ opacity: 0.8 }}>Stats simples (users + usage).</p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="ADMIN_KEY"
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 280 }}
        />
        <button
          onClick={load}
          disabled={!key || loading}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            cursor: !key || loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Chargement..." : "Charger"}
        </button>
      </div>

      {err ? <div style={{ marginTop: 12, color: "crimson" }}>Erreur: {err}</div> : null}

      {stats ? (
        <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <Card title="Users total" value={stats.users_total} />
            <Card title="Users (7j)" value={stats.users_last_7d} />
            <Card title="Questions totales" value={stats.total_queries} />
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: 12, fontWeight: 800, background: "#fafafa" }}>Top users</div>
            <div style={{ padding: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.7 }}>
                    <th style={{ padding: "6px 0" }}>user_id</th>
                    <th style={{ padding: "6px 0" }}>free_queries_used</th>
                    <th style={{ padding: "6px 0" }}>updated_at</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top_users.map((u) => (
                    <tr key={u.user_id} style={{ borderTop: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "8px 0", fontFamily: "monospace", fontSize: 12 }}>{u.user_id}</td>
                      <td style={{ padding: "8px 0" }}>{u.free_queries_used ?? 0}</td>
                      <td style={{ padding: "8px 0", fontSize: 12, opacity: 0.75 }}>{u.updated_at ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Card({ title, value }: { title: string; value: number }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>{value}</div>
    </div>
  );
}
