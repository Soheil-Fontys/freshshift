// Supabase Edge Function: terminate-employee
// Immediately revokes an employee's app access while preserving schedules,
// hours, absences and other business records linked to the employee row.

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

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: adminProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,role,display_name,email")
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
    if (!employeeId) {
      return jsonResponse({ error: "employeeId required" }, 400, corsHeaders);
    }

    const { data: employee, error: employeeError } = await adminClient
      .from("employees")
      .select("id,name,profile_id,active,terminated_at")
      .eq("id", employeeId)
      .maybeSingle();

    if (employeeError || !employee) {
      return jsonResponse({ error: "Employee not found" }, 404, corsHeaders);
    }
    if (!employee.active || employee.terminated_at) {
      return jsonResponse({ error: "Employee is not active" }, 409, corsHeaders);
    }

    const terminatedAt = new Date().toISOString();
    const authUserId = employee.profile_id;
    const { data: updated, error: updateError } = await adminClient
      .from("employees")
      .update({
        active: false,
        archived_at: terminatedAt,
        terminated_at: terminatedAt,
        terminated_by: userData.user.id,
        profile_id: null,
      })
      .eq("id", employeeId)
      .eq("active", true)
      .is("terminated_at", null)
      .select("id")
      .limit(1);

    if (updateError || !updated?.length) {
      return jsonResponse({ error: "Employee could not be terminated" }, 409, corsHeaders);
    }

    let authAccountDeleted = false;
    if (authUserId) {
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(authUserId);
      if (deleteError) {
        console.error("Auth account deletion failed after access unlink", deleteError);
      } else {
        authAccountDeleted = true;
      }
    }

    const actorName = adminProfile.display_name || adminProfile.email || "Administrator";
    const { error: activityError } = await adminClient.from("activity_log").insert({
      actor_profile_id: adminProfile.id,
      actor_name: actorName,
      action: "employee_terminated",
      details: {
        employeeId,
        employeeName: employee.name,
        authAccountDeleted,
      },
    });
    if (activityError) console.error("Termination activity log failed", activityError);

    return jsonResponse({ ok: true, authAccountDeleted }, 200, corsHeaders);
  } catch (error) {
    console.error("terminate-employee failed", error);
    return jsonResponse({ error: "Internal server error" }, 500, corsHeaders);
  }
});
