import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";

type EntitlementPayload = {
  user_id: string;
  status: string;
  current_period_end: string | null;
  plan?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  updated_at?: string;
};

function isActiveStripeStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

async function upsertEntitlement(payload: EntitlementPayload) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server variables manquantes.");

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await supabase
    .from("user_entitlements")
    .upsert(
      {
        ...payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) throw error;
}

export async function POST(req: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook non configuré." }, { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey);
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature || "", webhookSecret);
  } catch (err: any) {
    console.error("Stripe webhook signature error:", err?.message || err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id || session.client_reference_id || null;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;

      if (userId && subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const status = isActiveStripeStatus(sub.status) ? "active" : sub.status;
        const currentPeriodEnd = (sub as any).current_period_end
          ? new Date((sub as any).current_period_end * 1000).toISOString()
          : null;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
        const plan = sub.metadata?.plan || session.metadata?.plan || null;

        await upsertEntitlement({
          user_id: userId,
          status,
          current_period_end: currentPeriodEnd,
          plan,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        });
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.user_id || null;
      if (userId) {
        const status = event.type === "customer.subscription.deleted"
          ? "canceled"
          : isActiveStripeStatus(sub.status)
          ? "active"
          : sub.status;
        const currentPeriodEnd = (sub as any).current_period_end
          ? new Date((sub as any).current_period_end * 1000).toISOString()
          : null;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

        await upsertEntitlement({
          user_id: userId,
          status,
          current_period_end: currentPeriodEnd,
          plan: sub.metadata?.plan || null,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("Stripe webhook handling error:", err);
    return NextResponse.json(
      { error: err?.message || "Webhook handling error" },
      { status: 500 }
    );
  }
}
