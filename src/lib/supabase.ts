import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Unlike admin-app (where nothing works without auth, so failing loudly at
// startup is fine), this client ships inside storefront.js alongside the
// cart/checkout bundle — a thrown error here would take the entire cart down
// with it. Google sign-in is an optional enhancement on top of guest
// checkout, so a missing config just silently disables it instead.
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

if (!supabase && import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — Google sign-in disabled, guest checkout still works."
  );
}
