// One-shot: create a super_admin for manual testing.
// Usage: node scripts/seed-test-admin.mjs
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { randomBytes } from "crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = `test-admin-${Date.now()}@proxy-manager.local`;
const password = randomBytes(12).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) + "Aa1!";

console.log(`Creating auth user: ${email} ...`);
const { data: authData, error: authErr } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (authErr) {
  console.error("auth.admin.createUser failed:", authErr.message);
  process.exit(1);
}
console.log(`✓ auth.users id: ${authData.user.id}`);

console.log("Inserting admins row (super_admin) ...");
const { error: insertErr } = await sb.from("admins").insert({
  email,
  full_name: "Test Super Admin",
  role: "super_admin",
  is_active: true,
});
if (insertErr) {
  console.error("admins insert failed:", insertErr.message);
  // Roll back the auth user so you can re-run cleanly
  await sb.auth.admin.deleteUser(authData.user.id);
  process.exit(1);
}

console.log("\n=================================================");
console.log("  TEST SUPER_ADMIN CREATED");
console.log("=================================================");
console.log(`  URL:      https://proxy-manager-telebot.vercel.app/login`);
console.log(`  Email:    ${email}`);
console.log(`  Password: ${password}`);
console.log(`  Role:     super_admin`);
console.log("=================================================");
console.log("Note: ephemeral test creds. Rotate or revoke when done");
console.log("via /settings -> Admins, or:");
console.log(`  await sb.from('admins').delete().eq('email', '${email}')`);
console.log(`  await sb.auth.admin.deleteUser('${authData.user.id}')`);
