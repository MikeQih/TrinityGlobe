import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Fails loudly at startup rather than producing confusing "fetch failed"
  // errors the first time a page tries to query something.
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy admin-app/.env.example to admin-app/.env and fill them in."
  );
}

export const supabase = createClient(url, anonKey);
