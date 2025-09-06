import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { sendEmailVerification } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteField } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

const PROD_FALLBACK_URL = "https://spaceengineeringchallenge.web.app";

export default function VerifyEmail() {
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [email, setEmail] = useState("");
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

  useEffect(() => {
    const u = auth.currentUser;
    if (u) setEmail(u.email || "");
  }, []);

  const friendlyError = (code, fallback) => {
    const map = {
      "auth/too-many-requests":
        "Too many requests. Please wait a bit and try again.",
      "auth/invalid-continue-uri":
        "The redirect URL is not allowed. Add it to Firebase Authentication → Settings → Authorized domains.",
      "auth/missing-continue-uri":
        "Missing redirect URL for the email action.",
      "auth/user-token-expired":
        "Session expired. Please sign in again and retry.",
      "auth/user-not-found":
        "User not found. Please sign in again.",
      "auth/network-request-failed":
        "Network error. Check your connection and try again.",
    };
    return map[code] || fallback || "Could not send email now.";
  };

  const resend = async () => {
    const u = auth.currentUser;
    if (!u) {
      toast.error("You are not signed in. Please login and try again.");
      return;
    }
    setSending(true);
    try {

      try { auth.languageCode = "en"; } catch {}

      await sendEmailVerification(u, {
        url: `${APP_URL}/verify-email`,
        handleCodeInApp: true,
      });

      toast.success("Verification email sent. Please check your inbox/spam.");
    } catch (e) {
      console.error("sendEmailVerification error:", e);
      toast.error(friendlyError(e?.code, e?.message));
    } finally {
      setSending(false);
    }
  };

  const checkNow = async () => {
    const u = auth.currentUser;
    if (!u) {
      toast.error("You are not signed in. Please login again.");
      return;
    }
    setChecking(true);
    try {
      await u.reload(); // refreshes u.emailVerified
      if (!u.emailVerified) {
        toast("Not verified yet.");
        return;
      }

      // Email verified: finalize in Firestore 
      const uref = doc(db, "users", u.uid);
      const usnap = await getDoc(uref);
      if (!usnap.exists()) {
        navigate("/login");
        return;
      }
      const data = usnap.data();

      if (data.role === "pending_team" && data.pendingTeam?.teamId) {
        const { teamId, teamName, members } = data.pendingTeam;
        await setDoc(
          doc(db, "teams", teamId),
          {
            name: teamName,
            members: Array.isArray(members) ? members : [],
            checkpointsReached: 0,
            totalCheckpoints: 7,
            scores: {},
          },
          { merge: true }
        );
        await updateDoc(uref, {
          role: "team",
          teamId,
          emailVerified: true,
          status: "active",
          pendingTeam: deleteField(),
        });
        toast.success("Email verified. Team created!");
        navigate("/team");
        return;
      }

      if (data.role === "pending_professor") {
        await updateDoc(uref, { emailVerified: true, status: "active" });
        toast.success("Email verified. Awaiting professor approval.");
        navigate("/dashboard");
        return;
      }

      await updateDoc(uref, { emailVerified: true, status: "active" });
      toast.success("Email verified.");
      navigate("/dashboard");
    } finally {
      setChecking(false);
    }
  };

  // No auto-poll. Only manual check.
  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
      <div className="bg-slate-800 p-8 rounded-xl shadow-md w-full max-w-md text-center">
        <h1 className="text-2xl font-bold mb-3">Verify your email</h1>
        <p className="text-slate-300 mb-6">
          We sent a verification link to{" "}
          <span className="text-white font-semibold">{email}</span>. Open the
          link from your inbox (or spam), then press <b>“I verified”</b>.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={checkNow}
            disabled={checking}
            className="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-md font-semibold transition disabled:opacity-60"
          >
            {checking ? "Checking…" : "I verified"}
          </button>

          <button
            onClick={resend}
            disabled={sending}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-md font-semibold transition disabled:opacity-60"
          >
            {sending ? "Sending…" : "Resend verification email"}
          </button>
        </div>

        <p className="mt-6 text-sm text-slate-400">
          If you created the account on mobile, open the link in the same device’s browser.
        </p>
      </div>
    </div>
  );
}
