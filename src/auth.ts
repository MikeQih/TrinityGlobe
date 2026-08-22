import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

type Listener = (session: Session | null) => void;

const listeners = new Set<Listener>();
let currentSession: Session | null = null;
let initPromise: Promise<void> | null = null;

export function isAuthAvailable(): boolean {
  return supabase !== null;
}

export function getSession(): Session | null {
  return currentSession;
}

export function onAuthChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  listeners.forEach((listener) => listener(currentSession));
}

// Idempotent — safe to call from multiple boot paths without double-subscribing.
export function initAuth(): Promise<void> {
  const client = supabase;
  if (!client) return Promise.resolve();
  if (!initPromise) {
    initPromise = client.auth.getSession().then(({ data }) => {
      currentSession = data.session;
      notify();
      client.auth.onAuthStateChange((_event, session) => {
        currentSession = session;
        notify();
      });
    });
  }
  return initPromise;
}

// `redirectPath` lands back on this same origin after the provider's
// consent screen — the cart drawer reopens itself from there (see cart.ts's
// REOPEN_CHECKOUT_STORAGE_KEY flag), since the OAuth round trip is a full
// page navigation and any in-memory drawer state is otherwise lost.
async function signInWithOAuth(provider: "google" | "facebook", redirectPath = "/"): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}${redirectPath}` },
  });
}

export function signInWithGoogle(redirectPath = "/"): Promise<void> {
  return signInWithOAuth("google", redirectPath);
}

export function signInWithFacebook(redirectPath = "/"): Promise<void> {
  return signInWithOAuth("facebook", redirectPath);
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
