import { useState } from "react";
import { createUserWithEmailAndPassword, sendEmailVerification } from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, setDoc } from "firebase/firestore";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";

const PROD_FALLBACK_URL = "https://spaceengineeringchallenge.web.app"; 

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [role, setRole] = useState("team");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState([{ firstName: "", lastName: "" }]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const navigate = useNavigate();

  const APP_URL = (() => {
    const envUrl =
      (typeof process !== "undefined" &&
        process.env &&
        (process.env.REACT_APP_URL || process.env.APP_URL)) ||
      "";
    if (envUrl) return envUrl;
    if (typeof window !== "undefined") {
      return window.location.origin.includes("localhost")
        ? PROD_FALLBACK_URL
        : window.location.origin;
    }
    return PROD_FALLBACK_URL;
  })();

  const validatePassword = (pass) =>
    /[A-Z]/.test(pass) && /\d/.test(pass) && /[!@#$%^&*(),.?":{}|<>]/.test(pass) && pass.length >= 6;

  const handleSignup = async (e) => {
    e.preventDefault();

    if (!email || !password || !confirmPass) return toast.error("Please fill in all required fields.");
    if (password !== confirmPass) return toast.error("Passwords do not match.");
    if (!validatePassword(password)) {
      return toast.error("Password must have: 1 uppercase, 1 number, 1 special character, min 6 characters.");
    }
    if (role === "team") {
      if (!teamName.trim()) return toast.error("Please enter team name.");
      if (members.some((m) => !m.firstName.trim() || !m.lastName.trim()))
        return toast.error("Please fill out all member names.");
    }
    if (role === "organizer" && (!firstName.trim() || !lastName.trim()))
      return toast.error("Please enter your first and last name.");

    try {
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCred.user.uid;

      // 1) trimite emailul de verificare (redirect pe APP_URL/login după confirmare)
      try {
        await sendEmailVerification(userCred.user, { url: `${APP_URL}/login`, handleCodeInApp: true });
      } catch (ve) {
        console.warn("sendEmailVerification failed:", ve);
      }

      // 2) NU creăm echipa încă. Stocăm pending în users
      if (role === "team") {
        const teamId = teamName.trim().toLowerCase().replace(/\s+/g, "-");
        await setDoc(
          doc(db, "users", uid),
          {
            email,
            role: "pending_team",
            createdAt: new Date(),
            emailVerified: false,
            status: "pending",
            pendingTeam: { teamId, teamName: teamName.trim(), members },
          },
          { merge: true }
        );
      } else {
        await setDoc(
          doc(db, "users", uid),
          {
            email,
            role: "pending_professor",
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            createdAt: new Date(),
            emailVerified: false,
            status: "pending",
          },
          { merge: true }
        );
      }

      toast.success("Account created. Please verify your email.");
      navigate("/verify-email");
    } catch (err) {
      const friendly = {
        "auth/email-already-in-use": "An account with this email already exists.",
        "auth/invalid-email": "Invalid email address.",
        "auth/weak-password":
          "Password is too weak. Use at least 6 characters with uppercase, number and special.",
      };
      toast.error(friendly[err.code] || `Signup failed: ${err.message}`);
    }
  };

  const handleAddMember = () => {
    if (members.length >= 3) return toast.error("Maximum 3 members allowed.");
    setMembers([...members, { firstName: "", lastName: "" }]);
  };
  const handleRemoveMember = (i) => setMembers((arr) => arr.filter((_, idx) => idx !== i));
  const handleMemberChange = (i, field, val) =>
    setMembers((arr) => arr.map((m, idx) => (idx === i ? { ...m, [field]: val } : m)));

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
      <form onSubmit={handleSignup} className="bg-slate-800 p-8 rounded-xl shadow-md w-full max-w-md">
        <h2 className="text-3xl font-bold mb-6 text-center">🧑‍🚀 Sign Up</h2>

        <label className="text-sm mb-1 block">Email address</label>
        <input type="email" className="w-full mb-4 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md"
          placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label className="text-sm mb-1 block">Password</label>
        <input type="password" className="w-full mb-4 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md"
          placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />

        <label className="text-sm mb-1 block">Confirm Password</label>
        <input type="password" className="w-full mb-4 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md"
          placeholder="Confirm Password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} required />

        <label className="text-sm mb-1 block">Select Role</label>
        <select className="w-full mb-4 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md"
          value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="team">Team</option>
          <option value="organizer">Organizer</option>
        </select>

        {role === "team" ? (
          <>
            <label className="text-sm mb-1 block">Team Name</label>
            <input type="text" placeholder="Team name"
              className="w-full mb-4 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md"
              value={teamName} onChange={(e) => setTeamName(e.target.value)} required />

            {members.map((m, idx) => (
              <div key={idx} className="mb-4 relative">
                <label className="text-sm mb-1 block">Member {idx + 1}</label>
                <input type="text" placeholder="First Name"
                  className="w-full mb-2 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md"
                  value={m.firstName} onChange={(e) => handleMemberChange(idx, "firstName", e.target.value)} required />
                <input type="text" placeholder="Last Name"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-md"
                  value={m.lastName} onChange={(e) => handleMemberChange(idx, "lastName", e.target.value)} required />
                {members.length > 1 && (
                  <button type="button" onClick={() => handleRemoveMember(idx)}
                    className="absolute top-0 right-0 text-sm text-red-400 hover:text-red-600" title="Remove member">❌</button>
                )}
              </div>
            ))}

            {members.length < 3 && (
              <button type="button" onClick={handleAddMember}
                className="mb-4 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md text-white font-semibold">➕ Add Member</button>
            )}
          </>
        ) : (
          <>
            <label className="text-sm mb-1 block">First Name</label>
            <input type="text" className="w-full mb-4 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md"
              placeholder="First Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            <label className="text-sm mb-1 block">Last Name</label>
            <input type="text" className="w-full mb-4 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md"
              placeholder="Last Name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </>
        )}

        <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 py-2 rounded-md font-semibold transition">
          Create Account
        </button>

        <div className="mt-6 text-center text-sm text-slate-400">
          Already have an account? <Link to="/login" className="text-indigo-400 underline">Login</Link>
        </div>
        <div className="mt-2 text-center text-sm text-slate-400">
          <Link to="/" className="text-slate-400 underline">← Back to landing page</Link>
        </div>
      </form>
    </div>
  );
}
