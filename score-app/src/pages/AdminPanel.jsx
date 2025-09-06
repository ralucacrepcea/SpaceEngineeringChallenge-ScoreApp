import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, updateDoc, doc, query, where } from "firebase/firestore";
import Navbar from "../components/Navbar"; //  import Navbar

export default function AdminPanel() {
  const [pending, setPending] = useState([]);

  // Fetch pending_professor users
  useEffect(() => {
    const fetchPending = async () => {
      const q = query(collection(db, "users"), where("role", "==", "pending_professor"));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPending(data);
    };

    fetchPending();
  }, []);

  const approveProfessor = async (id) => {
    await updateDoc(doc(db, "users", id), { role: "professor" });
    setPending(pending.filter((user) => user.id !== id));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-950 text-white">
      <Navbar /> {/*  Navbar added */}
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6 text-indigo-400">Admin Panel – Approve Professors</h1>

        {pending.length === 0 ? (
          <p className="text-slate-400">✅ No pending requests</p>
        ) : (
          <ul className="space-y-4">
            {pending.map((user) => (
              <li
                key={user.id}
                className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex justify-between items-center"
              >
                <div>
                  <p className="font-semibold">{user.email}</p>
                  <p className="text-sm text-slate-400">ID: {user.id}</p>
                </div>
                <button
                  onClick={() => approveProfessor(user.id)}
                  className="bg-green-500 hover:bg-green-600 px-4 py-2 rounded-md font-semibold transition"
                >
                  ✅ Approve
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
