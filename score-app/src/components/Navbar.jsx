import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useNavigate } from "react-router-dom";

export default function Navbar() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login");
    } catch (e) {
      console.error("Logout failed:", e);
      navigate("/login");
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur supports-[backdrop-filter]:bg-slate-900/70 border-b border-slate-800 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* bară mai înaltă */}
        <div className="h-16 md:h-20 flex items-center justify-between">
          {/* Stânga: logo + titlu */}
          <div className="flex items-center gap-3">
            <img
              src="/logo192.png"
              alt="Logo"
              className="w-9 h-9 rounded-lg ring-1 ring-slate-700/60"
            />
            <span className="text-xl md:text-2xl font-semibold tracking-tight text-slate-100">
              Score App
            </span>
          </div>

          {/* Dreapta: Logout (mai mare) */}
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 md:px-5 py-2.5 md:py-3 text-sm md:text-base font-semibold text-white shadow hover:bg-indigo-500 active:bg-indigo-700 transition"
            aria-label="Logout"
            title="Logout"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
