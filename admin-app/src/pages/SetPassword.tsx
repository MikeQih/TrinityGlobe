import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Lands here after an invite or password-reset email link — see
 * App.tsx#isInviteFlow, which detects `type=invite`/`type=recovery` in the
 * URL hash and routes here instead of straight into the app. Supabase
 * already turns that link into a live session on its own (createClient's
 * default detectSessionInUrl), but a session alone doesn't set a password —
 * without this page, an invited staff member would be "signed in" once,
 * then have no way back in next time.
 */
export function SetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    navigate("/orders", { replace: true });
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Trinity Globe · Staff</h1>
        <p className="login-hint">Set a password for your staff account to finish setting it up.</p>
        {error && <p className="login-error">{error}</p>}
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoFocus
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Set password"}
        </button>
      </form>
    </div>
  );
}
