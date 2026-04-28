import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";

function getOrigin(req: Request) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    req.headers.get("origin") ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export async function POST(req: Request) {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const monthlyPrice = process.env.STRIPE_PRICE_MONTHLY;
    const yearlyPrice = process.env.STRIPE_PRICE_YEARLY;

    if (!stripeSecretKey || !monthlyPrice || !yearlyPrice) {
      return NextResponse.json(
        { error: "Stripe n’est pas encore configuré côté serveur." },
        { status: 500 }
      );
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Supabase server variables manquantes." },
        { status: 500 }
      );
    }

    const { plan } = (await req.json().catch(() => ({}))) as { plan?: "monthly" | "yearly" };
    if (plan !== "monthly" && plan !== "yearly") {
      return NextResponse.json({ error: "Plan invalide." }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearer) {
      return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(bearer);
    const user = userData?.user;
    if (userErr || !user) {
      return NextResponse.json({ error: "Session invalide." }, { status: 401 });
    }

    const price = plan === "monthly" ? monthlyPrice : yearlyPrice;
    const origin = getOrigin(req);
    const stripe = new Stripe(stripeSecretKey);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      customer_email: user.email || undefined,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        plan,
        product: "ernesto_plus",
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan,
          product: "ernesto_plus",
        },
      },
      allow_promotion_codes: true,
      locale: "fr",
      success_url: `${origin}/?payment=success`,
      cancel_url: `${origin}/?payment=cancel`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    console.error("Stripe checkout error:", e);
    return NextResponse.json(
      { error: e?.message || "Erreur Stripe." },
      { status: 500 }
    );
  }
}
