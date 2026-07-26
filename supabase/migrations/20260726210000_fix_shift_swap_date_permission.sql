-- Employees may create a shift handover request. The RPC validates the request,
-- but it calls this small date helper with the employee's database role.
grant usage on schema private to authenticated;
grant execute on function private.shift_date(text, text) to authenticated, service_role;
