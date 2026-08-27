// Small helper so every function fails fast with a clear message instead of
// a confusing downstream error when an env var hasn't been configured yet
// (expected during local scaffolding before Supabase/Stripe/Resend keys exist).
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
