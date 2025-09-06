import { useState } from "react";
import {
  signInWithEmailAndPassword,
  fetchSignInMethodsForEmail,
} from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    const emailTrim = email.trim();
    if (!emailTrim || !password) {
      return toast.error("Please enter both email and password.");
    }

    try {
      setBusy(true);
      const userCred = await signInWithEmailAndPassword(auth, emailTrim, password);
      const uid = userCred.user.uid;
      const userDoc = await getDoc(doc(db, "users", uid));
      const role = userDoc.data()?.role;

      toast.success("Logged in successfully!");

      if (role === "admin") navigate("/admin");
      else if (role === "professor") navigate("/professor");
      else if (role === "team") navigate("/team");
      else navigate("/dashboard");
    } catch (error) {

      const code = error?.code || "";

      // verifica daca emailul exista 
      if (
        code === "auth/invalid-credential" ||
        code === "auth/user-not-found" ||
        code === "auth/wrong-password"
      ) {
        try {
          const methods = await fetchSignInMethodsForEmail(auth, emailTrim);
          if (!methods || methods.length === 0) {
            toast.error("No account found for this email.");
          } else {
            // email exists -> wrong password or mismatched provider
            if (methods.includes("password")) {
              toast.error("Incorrect password.");
            } else {
              // Registered with another provider (e.g. Google)
              toast.error("This email is registered with a different sign-in method.");
            }
          }
        } catch {
          toast.error("Login failed. Please check your email and password.");
        }
        setBusy(false);
        return;
      }

      const friendly = {
        "auth/invalid-email": "Invalid email address.",
        "auth/too-many-requests":
          "Too many attempts. Please try again later or reset your password.",
        "auth/network-request-failed":
          "Network error. Please check your connection and try again.",
      };

      toast.error(friendly[code] || `Login failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
      <form onSubmit={handleLogin} className="bg-slate-800 p-8 rounded-xl shadow-md w-full max-w-md">
        <h2 className="text-3xl font-bold mb-6 text-center">🚀 Login</h2>

        <label className="text-sm mb-1 block">Email address</label>
        <input
          type="email"
          className="w-full mb-4 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md placeholder-slate-400"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="text-sm mb-1 block">Password</label>
        <input
          type="password"
          className="w-full mb-6 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md placeholder-slate-400"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={busy}
          className={`w-full py-2 rounded-md font-semibold ${busy ? "bg-indigo-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"}`}
        >
          {busy ? "Logging in..." : "Login"}
        </button>

        <div className="mt-6 text-center text-sm text-slate-400">
          Don't have an account?{" "}
          <Link to="/signup" className="text-indigo-400 underline">
            Sign up
          </Link>
        </div>

        <div className="mt-2 text-center text-sm text-slate-400">
          <Link to="/" className="text-slate-400 underline">
            ← Back to landing page
          </Link>
        </div>
      </form>
    </div>
  );
}
