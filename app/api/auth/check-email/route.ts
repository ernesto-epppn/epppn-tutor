import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function normalizeEmail(raw: unknown) {
  return String(raw || "").trim().toLowerCase();
}

function adminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function POST(req: Request) {
  try {
    const { email } = (await req.json().catch(() => ({}))) as { email?: string };
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return NextResponse.json(
        { allowed: false, error: "invalid_email", message: "Indiquez une adresse email valide." },
        { status: 400 }
      );
    }

    if (adminEmails().includes(normalizedEmail)) {
      return NextResponse.json({ allowed: true, reason: "admin_email", access_type: "admin" });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          allowed: false,
          error: "server_not_configured",
          message: "La vérification d’accès n’est pas configurée côté serveur.",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const { data, error } = await supabase
      .from("epppn_allowed_emails")
      .select("email,active,access_months,activated_at,access_ends_at,blocked_at,blocked_reason,paused_at,paused_reason")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error("Ernesto check-email lookup failed:", error.message);
      return NextResponse.json(
        {
          allowed: false,
          error: "allowlist_lookup_failed",
          message: "Impossible de vérifier l’accès pour le moment. Réessayez dans quelques instants.",
        },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          allowed: false,
          error: "email_not_allowed",
          message: "Cette adresse email n’est pas associée à un accès Ernesto autorisé par l’EPPPN.",
        },
        { status: 403 }
      );
    }

    if (data.paused_at) {
      return NextResponse.json(
        {
          allowed: false,
          error: "access_paused",
          message: "Cet accès Ernesto est actuellement en pause. Contactez l’EPPPN pour le réactiver.",
        },
        { status: 403 }
      );
    }

    if (data.blocked_at) {
      return NextResponse.json(
        {
          allowed: false,
          error: "email_blocked",
          message: "Cet accès Ernesto a été désactivé par l’administrateur EPPPN.",
        },
        { status: 403 }
      );
    }

    if (data.active !== true) {
      return NextResponse.json(
        {
          allowed: false,
          error: "email_not_allowed",
          message: "Cette adresse email n’est pas associée à un accès Ernesto actif.",
        },
        { status: 403 }
      );
    }

    if (data.access_ends_at && new Date(data.access_ends_at) <= new Date()) {
      return NextResponse.json(
        {
          allowed: false,
          error: "access_expired",
          message: "La période d’accès à Ernesto associée à cette adresse email est arrivée à son terme.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      allowed: true,
      reason: "epppn_allowed_email",
      access_type: "stagiaire_epppn",
      access_months: data.access_months ?? 4,
      activated_at: data.activated_at,
      access_ends_at: data.access_ends_at,
    });
  } catch (err) {
    console.error("Ernesto check-email route failed:", err);
    return NextResponse.json(
      {
        allowed: false,
        error: "server_error",
        message: "Erreur technique pendant la vérification d’accès.",
      },
      { status: 500 }
    );
  }
}
