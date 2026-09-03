import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function clampMonths(value: unknown) {
  const parsed = Number(value ?? 4);
  if (!Number.isFinite(parsed)) return 4;
  return Math.min(6, Math.max(1, Math.floor(parsed)));
}

function addMonthsClamped(date: Date, months: number) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function envAdminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

export async function POST(req: Request) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!bearer) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
    const adminUser = userData?.user;
    if (userError || !adminUser) return NextResponse.json({ error: "invalid_session" }, { status: 401 });

    const adminEmail = normalizeEmail(adminUser.email);
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", adminUser.id)
      .maybeSingle();
    const isAdmin = profile?.role === "admin" || envAdminEmails().includes(adminEmail);
    if (!isAdmin) return NextResponse.json({ error: "admin_required" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      full_name?: string;
      access_months?: number;
      access_ends_at?: string;
    };

    const email = normalizeEmail(body.email);
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }

    const accessMonths = clampMonths(body.access_months);
    const now = new Date();
    const requestedEnd = body.access_ends_at ? new Date(body.access_ends_at) : null;
    const accessEndsAt =
      requestedEnd && !Number.isNaN(requestedEnd.getTime()) && requestedEnd > now
        ? requestedEnd
        : addMonthsClamped(now, accessMonths);

    const { error: allowlistError } = await supabase
      .from("epppn_allowed_emails")
      .upsert(
        {
          email,
          full_name: String(body.full_name || "").trim() || null,
          active: true,
          access_months: accessMonths,
          access_ends_at: accessEndsAt.toISOString(),
          blocked_at: null,
          blocked_reason: null,
          paused_at: null,
          paused_reason: null,
          invited_at: now.toISOString(),
          invited_by: adminUser.id,
          updated_at: now.toISOString(),
        },
        { onConflict: "email" }
      );

    if (allowlistError) {
      console.error("V14 allowlist upsert failed:", allowlistError.message);
      return NextResponse.json({ error: "allowlist_update_failed" }, { status: 500 });
    }

    const siteUrl = new URL(req.url).origin;
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: `${siteUrl}/auth/set-password`,
        data: {
          full_name: String(body.full_name || "").trim() || undefined,
          access_type: "stagiaire_epppn",
        },
      }
    );

    if (inviteError) {
      const alreadyRegistered = /already|registered|exists/i.test(inviteError.message || "");
      if (!alreadyRegistered) {
        console.error("V14 invite failed:", inviteError.message);
        return NextResponse.json(
          {
            error: "invite_failed",
            message: "L’adresse est autorisée, mais l’invitation n’a pas pu être envoyée.",
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      email,
      user_id: inviteData?.user?.id || null,
      access_months: accessMonths,
      access_ends_at: accessEndsAt.toISOString(),
    });
  } catch (error) {
    console.error("V14 invite route failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
