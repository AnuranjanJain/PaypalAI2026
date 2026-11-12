import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Build the worker-only Supabase client. This key must never be exposed to browser code. */
export function createAgentAdminClient(): SupabaseClient {
  return createAdminClient();
}
