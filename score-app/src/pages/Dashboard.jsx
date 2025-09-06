import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";

export default function Dashboard() {
  const { userData, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;

    // Redirect automat pentru admin
    if (userData?.role === "admin") {
      navigate("/admin");
      return;
    }
    // dacă vrei să ajungă direct în panel după ce rolul devine "professor"
    // if (userData?.role === "professor") navigate("/professor");
  }, [loading, userData, navigate]);

  if (loading) return <div className="text-center text-white mt-10">Loading...</div>;
  if (!userData) return <div className="text-center text-red-400 mt-10">User data not found</div>;

  const { role } = userData;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-950 text-white">
      <Navbar />
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-8 text-indigo-400">🚀 Dashboard ({role})</h1>

        {role === "team" && (
          <div className="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
            <h2 className="text-2xl font-semibold mb-4">Team View</h2>
            <p>📡 Robot progress: 3 / 7 checkpoints</p>
            <p>🏁 Final score: not available yet</p>
          </div>
        )}

        {role === "professor" && (
          <div className="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
            <h2 className="text-2xl font-semibold mb-4">Professor Panel</h2>
            <ul className="list-disc list-inside space-y-2 text-slate-300 mb-4">
              <li>✅ View team scores</li>
              <li>📝 Edit scores / add evaluations</li>
              <li>🔎 Review robot logs</li>
            </ul>
            <button
              onClick={() => navigate("/professor")} 
              className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
            >
              Deschide Professor Panel
            </button>
          </div>
        )}

        {role === "pending_professor" && (
          <div className="bg-yellow-200 text-yellow-900 p-4 rounded-lg mt-4 border border-yellow-300">
            ⏳ Contul tău de profesor este în așteptare pentru aprobare.
          </div>
        )}
      </div>
    </div>
  );
}
