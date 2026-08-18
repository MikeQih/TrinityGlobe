import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, signOut, useAuth } from "./auth/AuthContext";
import { Login } from "./pages/Login";
import { OrdersList } from "./pages/OrdersList";
import { OrderDetail } from "./pages/OrderDetail";

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

function Protected({ children }: { children: React.ReactNode }) {
  const { loading, session, role } = useAuth();
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
          <Route path="/login" element={<Login />} />
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
          <Route path="*" element={<Navigate to="/orders" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
