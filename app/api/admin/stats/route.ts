import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) return unauthorized();

  const url = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 1) usage
  const { data: usageRows, error: eUsage } = await supabase
    .from("user_usage")
    .select("user_id, free_queries_used, trial_started_at, updated_at");

  if (eUsage) return NextResponse.json({ error: eUsage.message }, { status: 500 });

  const users_with_usage = usageRows?.length ?? 0;
  const total_queries = (usageRows ?? []).reduce(
    (acc: number, r: any) => acc + (r.free_queries_used ?? 0),
    0
  );

  const top_users = (usageRows ?? [])
    .slice()
    .sort((a: any, b: any) => (b.free_queries_used ?? 0) - (a.free_queries_used ?? 0))
    .slice(0, 20);

  // 2) entitlements (pro)
  const { data: entRows, error: eEnt } = await supabase
    .from("user_entitlements")
    .select("user_id, status, provider, current_period_end");

  if (eEnt) return NextResponse.json({ error: eEnt.message }, { status: 500 });

  const pro_active = (entRows ?? []).filter((r: any) => r?.plan === "pro" && r?.is_active).length;

  return NextResponse.json({
    users_with_usage,
    total_queries,
    pro_active,
    top_users,
  });
}