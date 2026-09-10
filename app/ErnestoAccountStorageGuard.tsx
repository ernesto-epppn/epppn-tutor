"use client";

import { createClient } from "@supabase/supabase-js";
import { useLayoutEffect } from "react";

const LEGACY_PROJECTS_KEY = "ernesto_projects_v1";
const OWNER_KEY = "ernesto_projects_owner_v2";
const SCOPED_PREFIX = "ernesto_projects_v2";
const LEGACY_BACKUP_KEY = "ernesto_projects_legacy_backup_v1";

type MinimalUser = {
  id?: string | null;
  created_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function scopedKey(userId: string) {
  return `${SCOPED_PREFIX}:${userId}`;
}

function isFreshEpppnInvite(user: MinimalUser) {
  const accessType = String(user.user_metadata?.access_type || "");
  if (accessType !== "stagiaire_epppn") return false;

  const createdAt = user.created_at ? new Date(user.created_at).getTime() : NaN;
  if (!Number.isFinite(createdAt)) return false;

  return Date.now() - createdAt < 7 * 24 * 60 * 60 * 1000;
}

function readUserSynchronously(): MinimalUser | null {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;

      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      const parsed = JSON.parse(raw);
      const user = parsed?.user || parsed?.currentSession?.user;
      if (user?.id) return user as MinimalUser;
    }
  } catch {
    // Supabase remains the source of truth below if the cached payload cannot be parsed.
  }

  return null;
}

function preserveCurrentWorkspace(ownerId: string | null) {
  if (!ownerId) return;
  try {
    const current = window.localStorage.getItem(LEGACY_PROJECTS_KEY);
    if (current) window.localStorage.setItem(scopedKey(ownerId), current);
  } catch {
    // Ernesto keeps working even when localStorage is unavailable.
  }
}

function reconcileWorkspace(user: MinimalUser | null) {
  try {
    const currentUserId = String(user?.id || "").trim();
    const previousOwnerId = window.localStorage.getItem(OWNER_KEY);
    const currentWorkspace = window.localStorage.getItem(LEGACY_PROJECTS_KEY);

    if (!currentUserId) {
      preserveCurrentWorkspace(previousOwnerId);
      window.localStorage.removeItem(LEGACY_PROJECTS_KEY);
      window.localStorage.removeItem(OWNER_KEY);
      return;
    }

    if (previousOwnerId && previousOwnerId !== currentUserId) {
      preserveCurrentWorkspace(previousOwnerId);
      const incoming = window.localStorage.getItem(scopedKey(currentUserId));
      if (incoming) window.localStorage.setItem(LEGACY_PROJECTS_KEY, incoming);
      else window.localStorage.removeItem(LEGACY_PROJECTS_KEY);
      window.localStorage.setItem(OWNER_KEY, currentUserId);
      return;
    }

    if (!previousOwnerId) {
      const incoming = window.localStorage.getItem(scopedKey(currentUserId));

      if (incoming) {
        window.localStorage.setItem(LEGACY_PROJECTS_KEY, incoming);
      } else if (currentWorkspace) {
        if (isFreshEpppnInvite(user || {})) {
          // Old v1 projects had no owner. Never expose them to a newly invited trainee.
          // Keep one recoverable local backup instead of deleting the legacy data.
          if (!window.localStorage.getItem(LEGACY_BACKUP_KEY)) {
            window.localStorage.setItem(LEGACY_BACKUP_KEY, currentWorkspace);
          }
          window.localStorage.removeItem(LEGACY_PROJECTS_KEY);
        } else {
          // Existing users keep their pre-isolation dossiers on the first run after upgrade.
          window.localStorage.setItem(scopedKey(currentUserId), currentWorkspace);
        }
      }

      window.localStorage.setItem(OWNER_KEY, currentUserId);
      return;
    }

    // Same account: restore its workspace if the compatibility key was cleared externally.
    if (!currentWorkspace) {
      const saved = window.localStorage.getItem(scopedKey(currentUserId));
      if (saved) window.localStorage.setItem(LEGACY_PROJECTS_KEY, saved);
    }
  } catch {
    // Storage isolation is best-effort; authentication itself must never depend on it.
  }
}

export default function ErnestoAccountStorageGuard() {
  useLayoutEffect(() => {
    const syncUser = readUserSynchronously();
    reconcileWorkspace(syncUser);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return;

    const supabase = createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    void supabase.auth.getSession().then(({ data }) => {
      reconcileWorkspace(data.session?.user || null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      reconcileWorkspace(session?.user || null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return null;
}
