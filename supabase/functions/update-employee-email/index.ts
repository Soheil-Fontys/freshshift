// Supabase Edge Function: update-employee-email
// Lets an authenticated administrator correct a linked employee's Auth email.
// The service-role key stays on the server and is never exposed to the app.

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
  if (!corsHeaders) return jsonResponse({ error: "Origin not allowed" }, 403, {});

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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: adminProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profileError || adminProfile?.role !== "admin") {
      return jsonResponse({ error: "Forbidden" }, 403, corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    const employeeId = String(body.employeeId ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const expectedEmail = String(body.expectedEmail ?? "").trim().toLowerCase();
    let redirectTo: string;
    try {
      redirectTo = getRedirectTo(body.redirectTo);
    } catch {
      return jsonResponse({ error: "Invalid redirect URL" }, 400, corsHeaders);
    }

    if (!employeeId || !email) {
      return jsonResponse({ error: "employeeId and email required" }, 400, corsHeaders);
    }
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return jsonResponse({ error: "Invalid email" }, 400, corsHeaders);
    }

    const { data: employee, error: employeeError } = await adminClient
      .from("employees")
      .select("id,name,email,profile_id,active")
      .eq("id", employeeId)
      .eq("active", true)
      .maybeSingle();

    if (employeeError || !employee) {
      return jsonResponse({ error: "Active employee not found" }, 404, corsHeaders);
    }
    if (!employee.profile_id) {
      return jsonResponse({ error: "Employee is not invited yet" }, 409, corsHeaders);
    }

    const currentEmployeeEmail = String(employee.email ?? "").trim().toLowerCase();
    if (expectedEmail && currentEmployeeEmail !== expectedEmail) {
      return jsonResponse(
        { error: "Die Email wurde bereits von einem anderen Admin geändert. Bitte neu laden." },
        409,
        corsHeaders,
      );
    }
    if (currentEmployeeEmail === email) {
      return jsonResponse({ error: "Die neue Email ist unverändert." }, 409, corsHeaders);
    }

    const { data: authData, error: authReadError } = await adminClient.auth.admin
      .getUserById(employee.profile_id);
    if (authReadError || !authData?.user) {
      return jsonResponse({ error: "Auth account not found" }, 404, corsHeaders);
    }

    const previousAuthEmail = authData.user.email ?? currentEmployeeEmail;
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(
      employee.profile_id,
      { email },
    );
    if (authUpdateError) {
      return jsonResponse({ error: authUpdateError.message }, 400, corsHeaders);
    }

    const { error: syncError } = await adminClient.rpc("sync_employee_email_from_auth", {
      p_employee_id: employee.id,
      p_profile_id: employee.profile_id,
      p_email: email,
      p_actor_profile_id: adminProfile.id,
    });

    if (syncError) {
      const { error: rollbackError } = await adminClient.auth.admin.updateUserById(
        employee.profile_id,
        { email: previousAuthEmail },
      );
      if (rollbackError) {
        console.error("Auth email rollback failed", rollbackError);
      }
      return jsonResponse({ error: syncError.message }, 400, corsHeaders);
    }

    // Send one fresh code/link to the corrected address. A mail failure does not
    // undo the corrected account; the employee can request another code in-app.
    const mailClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: mailError } = await mailClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });

    if (mailError) {
      console.error("Corrected-email login message failed", mailError);
    }

    return jsonResponse(
      {
        ok: true,
        email,
        employeeName: employee.name,
        loginEmailSent: !mailError,
      },
      200,
      corsHeaders,
    );
  } catch (error) {
    console.error("update-employee-email failed", error);
    return jsonResponse({ error: "Internal server error" }, 500, corsHeaders);
  }
});
