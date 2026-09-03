"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo } from "react";

export default function ErnestoAccessTracker() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;

    async function track() {
      const { data } = await client.auth.getSession();
      const session = data.session;
      if (!session || cancelled) return;

      const key = `ernesto_access_ping:${session.user.id}`;
      if (sessionStorage.getItem(key) === "1") return;

      try {
        const response = await fetch("/api/access/ping", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        if (response.ok) sessionStorage.setItem(key, "1");
      } catch {
        // Tracking must never interfere with the tutor experience.
      }
    }

    track();
    const { data: subscription } = client.auth.onAuthStateChange(() => {
      track();
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  return null;
}
