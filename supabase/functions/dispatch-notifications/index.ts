// Supabase Edge Function: dispatch-notifications
// Delivers already-authorized FreshShift notification jobs through Web Push
// and, for urgent messages with explicit employee consent, Twilio SMS.

import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import webPush from "npm:web-push@3.6.7";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const allowedOrigins = new Set([
  "https://freshshift.de",
  "https://www.freshshift.de",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

type Delivery = {
  delivery_id: string;
  channel: "push" | "sms";
  recipient_profile_id: string | null;
  recipient_employee_id: string | null;
  notification_type: string;
  title: string;
  message: string;
  target_url: string;
  phone_e164: string | null;
  push_subscriptions: Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;
};

function getCorsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!origin) return {};
  if (!allowedOrigins.has(origin)) return null;
  return {
    ...baseCorsHeaders,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "Delivery failed";
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return jsonResponse({ error: "Origin not allowed" }, 403, {});
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Function is not configured" }, 500, corsHeaders);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
  }
  const { data: callerIsAdmin, error: roleError } = await userClient.rpc("is_admin");
  if (roleError) {
    console.error("notification caller role check failed", roleError);
    return jsonResponse({ error: "Authorization could not be checked" }, 403, corsHeaders);
  }
  if (!callerIsAdmin) {
    return jsonResponse({ error: "Admin access required" }, 403, corsHeaders);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: providerConfig, error: providerConfigError } = await adminClient
    .rpc("get_notification_service_config");
  if (providerConfigError) {
    console.error("notification provider config failed", providerConfigError);
  }
  const config = (providerConfig ?? {}) as Record<string, string>;
  const vapidPublicKey = config.freshshift_vapid_public_key ?? "";
  const vapidPrivateKey = config.freshshift_vapid_private_key ?? "";
  const twilioAccountSid = config.freshshift_twilio_account_sid ?? "";
  const twilioAuthToken = config.freshshift_twilio_auth_token ?? "";
  const twilioMessagingServiceSid = config.freshshift_twilio_messaging_service_sid ?? "";
  const twilioFromNumber = config.freshshift_twilio_from_number ?? "";
  const { data: deliveries, error: claimError } = await adminClient
    .rpc("claim_notification_deliveries", {
      p_limit: 50,
      // The caller was verified as an admin above. The database channel filter
      // remains as a second boundary for future scheduled dispatchers.
      p_channel: null,
    });
  if (claimError) {
    console.error("notification claim failed", claimError);
    return jsonResponse({ error: "Notifications could not be prepared" }, 500, corsHeaders);
  }

  if (vapidPublicKey && vapidPrivateKey) {
    webPush.setVapidDetails("mailto:noreply@freshshift.de", vapidPublicKey, vapidPrivateKey);
  }

  const results = { sent: 0, failed: 0, skipped: 0 };
  for (const rawDelivery of (deliveries ?? []) as Delivery[]) {
    const delivery = {
      ...rawDelivery,
      push_subscriptions: Array.isArray(rawDelivery.push_subscriptions)
        ? rawDelivery.push_subscriptions
        : [],
    };

    let status: "sent" | "failed" | "skipped" = "skipped";
    let externalId: string | null = null;
    let errorMessage: string | null = null;

    try {
      if (delivery.channel === "push") {
        if (!vapidPublicKey || !vapidPrivateKey) {
          errorMessage = "Web Push is not configured";
        } else if (delivery.push_subscriptions.length === 0) {
          errorMessage = "No active push subscription";
        } else {
          let successful = 0;
          const errors: string[] = [];
          for (const subscription of delivery.push_subscriptions) {
            try {
              await webPush.sendNotification(
                {
                  endpoint: subscription.endpoint,
                  keys: { p256dh: subscription.p256dh, auth: subscription.auth },
                },
                JSON.stringify({
                  title: delivery.title,
                  body: delivery.message,
                  url: delivery.target_url,
                  tag: `freshshift-${delivery.notification_type}`,
                }),
                { TTL: 60 * 60 * 24, urgency: "high" },
              );
              successful += 1;
              await adminClient.from("push_subscriptions")
                .update({ last_success_at: new Date().toISOString(), enabled: true })
                .eq("id", subscription.id);
            } catch (error) {
              const statusCode = Number((error as { statusCode?: number })?.statusCode ?? 0);
              if (statusCode === 404 || statusCode === 410) {
                await adminClient.from("push_subscriptions")
                  .update({ enabled: false })
                  .eq("id", subscription.id);
              }
              errors.push(safeError(error));
            }
          }
          if (successful > 0) {
            status = "sent";
            externalId = `${successful}-push-subscription${successful === 1 ? "" : "s"}`;
          } else {
            status = "failed";
            errorMessage = errors.join("; ").slice(0, 1000) || "Push delivery failed";
          }
        }
      } else {
        if (!delivery.phone_e164) {
          errorMessage = "No confirmed SMS number";
        } else if (!twilioAccountSid || !twilioAuthToken ||
          (!twilioMessagingServiceSid && !twilioFromNumber)) {
          errorMessage = "SMS provider is not configured";
        } else {
          const form = new URLSearchParams({
            To: delivery.phone_e164,
            Body: `FreshShift: ${delivery.message}`,
          });
          if (twilioMessagingServiceSid) {
            form.set("MessagingServiceSid", twilioMessagingServiceSid);
          } else {
            form.set("From", twilioFromNumber);
          }
          const twilioResponse = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: form,
            },
          );
          const twilioBody = await twilioResponse.json().catch(() => ({})) as {
            sid?: string;
            message?: string;
          };
          if (!twilioResponse.ok) throw new Error(twilioBody.message || "Twilio rejected the SMS");
          status = "sent";
          externalId = twilioBody.sid ?? null;
        }
      }
    } catch (error) {
      status = "failed";
      errorMessage = safeError(error);
    }

    const { error: finishError } = await adminClient.rpc("finish_notification_delivery", {
      p_delivery_id: delivery.delivery_id,
      p_status: status,
      p_external_id: externalId,
      p_error: errorMessage,
    });
    if (finishError) console.error("notification finish failed", finishError);
    results[status] += 1;
  }

  return jsonResponse({ ok: true, processed: (deliveries ?? []).length, ...results }, 200, corsHeaders);
});
