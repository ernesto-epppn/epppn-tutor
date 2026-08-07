"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);

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

  return <>{children}</>;
}
