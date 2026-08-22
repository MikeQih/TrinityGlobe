import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import type { SignupProfile } from "./types";

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

// Starts the email/password signup flow. Doesn't create a session by
// itself — Confirm Email is on for this project, so the account stays
// unusable until verifySignupOtp() below succeeds. The profile fields
// (name/gender/DOB/newsletter) aren't sent here; they're written to
// customer_profiles only once we have an authenticated user to attach them
// to, i.e. after OTP verification.
export async function signUpWithPassword(email: string, password: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Auth not configured" };
  const { error } = await supabase.auth.signUp({ email, password });
  return { error: error?.message ?? null };
}

export async function signInWithPassword(email: string, password: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Auth not configured" };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

// Confirms the 6-digit code from the "Confirm sign up" email (its template
// was switched from the default magic-link to {{ .Token }} — see
// supabase/migrations and PROJECT_STATUS.md). Success both verifies the
// email and signs the user in, so the caller can immediately write the
// customer_profiles row.
export async function verifySignupOtp(email: string, token: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Auth not configured" };
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "signup" });
  return { error: error?.message ?? null };
}

export async function resendSignupOtp(email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Auth not configured" };
  const { error } = await supabase.auth.resend({ type: "signup", email });
  return { error: error?.message ?? null };
}

// Called right after a successful verifySignupOtp() — the session is live
// by then, so this insert satisfies the "customers manage own profile" RLS
// policy (user_id = auth.uid()).
export async function saveCustomerProfile(profile: SignupProfile): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Auth not configured" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase.from("customer_profiles").insert({
    user_id: user.id,
    first_name: profile.firstName,
    last_name: profile.lastName,
    gender: profile.gender,
    date_of_birth: profile.dateOfBirth,
    newsletter_subscribed: profile.newsletterSubscribed,
  });
  return { error: error?.message ?? null };
}
