import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, signOut, useAuth } from "./auth/AuthContext";
import { Login } from "./pages/Login";
import { SetPassword } from "./pages/SetPassword";
import { OrdersList } from "./pages/OrdersList";
import { OrderDetail } from "./pages/OrderDetail";

// Read once at module load, before Supabase's own detectSessionInUrl (on by
// default in lib/supabase.ts's createClient) has a chance to parse and then
// strip the tokens from the URL bar — an invite/recovery email link lands
// here as `#access_token=...&type=invite`, and by the time any component
// renders, that hash may already be gone. This flag is the only reliable
// place to catch it.
const isInviteFlow = /type=(invite|recovery)/.test(window.location.hash);

function Shell({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <Link to="/orders" className="admin-logo">
          Trinity Globe · Staff
        </Link>
        <div className="admin-topbar-right">
          <span className="muted">{role}</span>
          <button onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}

// Covers paths back into /login that don't go through Login.tsx's own
// post-submit navigate() — browser back/forward, a stale bookmark, or a
// tab that was already signed in when it loaded this route.
function LoginRoute() {
  const { loading, session } = useAuth();
  if (!loading && session) return <Navigate to="/orders" replace />;
  return <Login />;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { loading, session, role } = useAuth();
  if (isInviteFlow) return <Navigate to="/set-password" replace />;
  if (loading) return <p className="muted center-page">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (!role) {
    return (
      <p className="error-banner center-page">
        Your account isn't set up as staff yet. Ask an admin to add you to admin_profiles.
      </p>
    );
  }
  return <Shell>{children}</Shell>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route
            path="/orders"
            element={
              <Protected>
                <OrdersList />
              </Protected>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <Protected>
                <OrderDetail />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to={isInviteFlow ? "/set-password" : "/orders"} replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
