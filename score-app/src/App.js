import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import AdminPanel from "./pages/AdminPanel";
import ProfessorPanel from "./pages/ProfessorPanel";
import TeamDashboard from "./pages/TeamDashboard";
import VerifyEmail from "./pages/VerifyEmail"; // ✅ new

import PrivateRoute from "./components/PrivateRoute";
import { useAuth } from "./context/AuthContext";
import ManageProbesPage from "./pages/ManageProbesPage";

/*  Admin access only */
function AdminRoute({ children }) {
  const { userData, loading } = useAuth();
  if (loading) return null;
  // fix: wrong redirect path; send non-admins to dashboard
  if (userData?.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

/*  Professor access only */
function ProfessorRoute({ children }) {
  const { userData, loading } = useAuth();
  if (loading) return null;
  if (userData?.role !== "professor") return <Navigate to="/dashboard" replace />;
  return children;
}

function App() {
  return (
    <Router>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/manage-probes" element={<ManageProbesPage />} />

        {/* Email verification screen (must be logged in) */}
        <Route
          path="/verify-email"
          element={
            <PrivateRoute>
              <VerifyEmail />
            </PrivateRoute>
          }
        />

        {/* Authenticated users */}
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />

        {/* Team view with real-time scores */}
        <Route
          path="/team"
          element={
            <PrivateRoute>
              <TeamDashboard />
            </PrivateRoute>
          }
        />

        {/* Professors only */}
        <Route
          path="/professor"
          element={
            <PrivateRoute>
              <ProfessorRoute>
                <ProfessorPanel />
              </ProfessorRoute>
            </PrivateRoute>
          }
        />

        {/* Admin only */}
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <AdminRoute>
                <AdminPanel />
              </AdminRoute>
            </PrivateRoute>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
