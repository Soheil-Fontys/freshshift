// Supabase Edge Function: invite-employee
// Sends a magic-link invite to an employee email and stores it on the employee record.
//
// Env vars needed (Supabase dashboard / CLI secrets):
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { corsHeaders as sdkCorsHeaders } from "npm:@supabase/supabase-js@2.110.7/cors";

const allowedOrigins = new Set([
  "https://freshshift.de",
  "https://www.freshshift.de",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function getCorsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!origin) return {};
  if (!allowedOrigins.has(origin)) return null;

  return {
    ...sdkCorsHeaders,
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

function getRedirectTo(value: unknown): string {
  if (!value) return "https://freshshift.de/";

  const redirectTo = new URL(String(value));
  if (!allowedOrigins.has(redirectTo.origin)) {
    throw new Error("Invalid redirect URL");
  }

  return redirectTo.toString();
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) {
    return jsonResponse({ error: "Origin not allowed" }, 403, {});
  }

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
    }

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

    // User-scoped client for auth
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
    }

    const userId = userData.user.id;

    // Admin client for DB + invite
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (profErr || profile?.role !== "admin") {
      return jsonResponse({ error: "Forbidden" }, 403, corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    const employeeId = String(body.employeeId ?? "").trim();
    const employeeName = String(body.employeeName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    let redirectTo: string;

    try {
      redirectTo = getRedirectTo(body.redirectTo);
    } catch {
      return jsonResponse({ error: "Invalid redirect URL" }, 400, corsHeaders);
    }

    if (!employeeId || !email) {
      return jsonResponse({ error: "employeeId and email required" }, 400, corsHeaders);
    }

    const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    if (!looksLikeEmail) {
      return jsonResponse({ error: "Invalid email" }, 400, corsHeaders);
    }

    const { data: employee, error: employeeErr } = await adminClient
      .from("employees")
      .select("id,name,email,active")
      .eq("id", employeeId)
      .eq("active", true)
      .maybeSingle();

    if (employeeErr || !employee) {
      return jsonResponse({ error: "Active employee not found" }, 404, corsHeaders);
    }

    const previousEmail = employee.email;

    // The email must exist before Auth creates the user so the database trigger
    // can link both records. If Auth rejects the invite, restore the old value.
    const { data: updated, error: updErr } = await adminClient
      .from("employees")
      .update({ email })
      .eq("id", employeeId)
      .eq("active", true)
      .select("id,name,email")
      .limit(1);

    if (updErr || !updated || updated.length === 0) {
      return jsonResponse(
        {
          error: "Employee not found or update failed",
          details: updErr?.message,
        },
        404,
        corsHeaders,
      );
    }

    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { display_name: employee.name || employeeName },
    });

    if (inviteErr) {
      const { error: rollbackErr } = await adminClient
        .from("employees")
        .update({ email: previousEmail })
        .eq("id", employeeId)
        .eq("email", email);

      if (rollbackErr) {
        console.error("invite-employee email rollback failed", rollbackErr);
      }
      return jsonResponse({ error: inviteErr.message }, 400, corsHeaders);
    }

    return jsonResponse(
      {
        ok: true,
        invited: inviteData?.user?.email,
        employee: updated[0],
        employeeName: employee.name,
      },
      200,
      corsHeaders,
    );
  } catch (e) {
    console.error("invite-employee failed", e);
    return jsonResponse({ error: "Internal server error" }, 500, corsHeaders);
  }
});
