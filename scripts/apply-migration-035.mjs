// Apply mig 035 directly to Supabase via PostgREST exec_sql RPC.
// Works ONLY if the project has an exec_sql function. Otherwise prints
// the SQL for manual paste in Supabase Dashboard SQL Editor.
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local","utf8").split("\n").filter(l=>l&&!l.startsWith("#")).map(l=>{
    const i=l.indexOf("="); return [l.slice(0,i),l.slice(i+1)];
  }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const sql = readFileSync("supabase/migrations/035_wave22f_admin_lifecycle.sql","utf8");

// Try via the management API (Personal Access Token required, not in env)
// Falls back to the most-portable: print the SQL with a direct dashboard URL.
const projectRef = (env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/(\w+)\.supabase\.co/) || [])[1];

console.log("Wave 22F migration 035:");
console.log("Project:", projectRef);
console.log();
console.log("Apply manually at:");
console.log(`  https://supabase.com/dashboard/project/${projectRef}/sql/new`);
console.log();
console.log("Or paste the SQL below:");
console.log("---");
console.log(sql);
