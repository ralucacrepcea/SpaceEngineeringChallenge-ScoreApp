// src/pages/ManageProbesPage.jsx
import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  query,
  where,
  addDoc,
  updateDoc,
  writeBatch,
  deleteField,
} from "firebase/firestore";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useNavigate } from "react-router-dom";

const MP_ID = "Mission Performance";

/*  Reusable confirm toast (Da / Nu) */
function confirmToast(message, { yesLabel = "Da", noLabel = "Nu" } = {}) {
  return new Promise((resolve) => {
    toast(
      (t) => (
        <div className="space-y-2">
          <div className="font-medium">{message}</div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                resolve(true);
                toast.dismiss(t.id);
              }}
              className="px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
            >
              {yesLabel}
            </button>
            <button
              onClick={() => {
                resolve(false);
                toast.dismiss(t.id);
              }}
              className="px-3 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-white text-sm"
            >
              {noLabel}
            </button>
          </div>
        </div>
      ),
      { autoClose: false, closeOnClick: false }
    );
  });
}

/*  Utils: batch update for many team docs */
async function batchUpdateTeams(updater) {
  const teamsSnap = await getDocs(collection(db, "teams"));
  let batch = writeBatch(db);
  let ops = 0;
  const commits = [];

  for (const d of teamsSnap.docs) {
    const updates = updater(d);
    if (!updates) continue;
    batch.update(doc(db, "teams", d.id), updates);
    ops++;
    if (ops >= 450) {
      commits.push(batch.commit());
      batch = writeBatch(db);
      ops = 0;
    }
  }
  commits.push(batch.commit());
  await Promise.all(commits);
}

/*  Random secret for HMAC (QR) */
const genSecret = () => {
  try {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
};

/*  util key for columns  */
const keyFromLabel = (label) =>
  (label || "col")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") + "-" + Math.random().toString(36).slice(2, 6);

/* Align `checkpoints` docs for a round */
async function reconcileCheckpoints(roundId, targetTotal) {
  const qCp = query(collection(db, "checkpoints"), where("roundId", "==", roundId));
  const snap = await getDocs(qCp);

  const byOrder = new Map();
  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const ord = Number(data.order);
    if (Number.isFinite(ord)) {
      byOrder.set(ord, {
        id: d.id,
        isActive: data.isActive === true,
        hasSecret: !!data.secret,
      });
    }
  });

  // Create/activate 1..N and ensure secret
  for (let ord = 1; ord <= targetTotal; ord++) {
    const ex = byOrder.get(ord);
    if (!ex) {
      await addDoc(collection(db, "checkpoints"), {
        roundId,
        order: ord,
        isActive: true,
        secret: genSecret(),
        createdAt: new Date(),
      });
    } else {
      const patch = {};
      if (!ex.isActive) patch.isActive = true;
      if (!ex.hasSecret) patch.secret = genSecret();
      if (Object.keys(patch).length) {
        await updateDoc(doc(db, "checkpoints", ex.id), patch);
      }
    }
  }

  // >N -> inactive (keep for history)
  for (const [ord, ex] of byOrder.entries()) {
    if (ord > targetTotal && ex.isActive) {
      await updateDoc(doc(db, "checkpoints", ex.id), { isActive: false });
    }
  }
}

export default function ManageProbesPage() {
  const navigate = useNavigate();

  // Probes
  const [probes, setProbes] = useState([]); // MP + dynamic
  const [probeDocs, setProbeDocs] = useState({}); // {id:{weight, columns}}
  theSanityFix(probeDocs); // harmless (no-op) helper if bundlers reorder
  const [probeRename, setProbeRename] = useState({});
  const [probeWeights, setProbeWeights] = useState({});
  const [initialWeights, setInitialWeights] = useState({});
  const [expanded, setExpanded] = useState({}); // show columns editor per probe

  // Rounds
  const [rounds, setRounds] = useState([]); // list of round ids
  const [roundConfigs, setRoundConfigs] = useState({}); // {roundId: totalCheckpoints}
  const [pendingRoundCounts, setPendingRoundCounts] = useState({}); // editable buffer
  const [newRound, setNewRound] = useState("");
  const [roundRename, setRoundRename] = useState({}); // {oldId: newName}

  // New probe
  const [newProbe, setNewProbe] = useState("");

  const sumAllWeights = Object.values(probeWeights).reduce((acc, v) => acc + (parseInt(v) || 0), 0);
  const missionWeight = parseInt(probeWeights[MP_ID]) || 0;
  const dynamicSum = Math.max(0, sumAllWeights - missionWeight);

  useEffect(() => {
    const fetchData = async () => {
      //  probes
      const snap = await getDocs(collection(db, "probes"));
      const ids = [];
      const weights = {};
      const docs = {};
      let hasMP = false;

      snap.docs.forEach((d) => {
        const id = d.id;
        const data = d.data() || {};
        const w = Number(data.weight ?? 0);
        const cols =
          Array.isArray(data.columns) && data.columns.length ? data.columns : [{ key: "score", label: "Score" }];
        weights[id] = Number.isFinite(w) ? w : 0;
        ids.push(id);
        docs[id] = { weight: weights[id], columns: cols };
        if (id === MP_ID) hasMP = true;
      });

      if (!hasMP) {
        await setDoc(doc(db, "probes", MP_ID), { weight: 20, createdAt: new Date(), columns: [{ key: "score", label: "Score" }] }, { merge: true });
        weights[MP_ID] = 20;
        ids.push(MP_ID);
        docs[MP_ID] = { weight: 20, columns: [{ key: "score", label: "Score" }] };
      }

      const dynamic = ids.filter((x) => x !== MP_ID).sort((a, b) => a.localeCompare(b));
      setProbes([MP_ID, ...dynamic]);
      setProbeWeights(weights);
      setInitialWeights(weights);
      setProbeDocs(docs);

      //  rounds
      const roundsSnap = await getDocs(collection(db, "rounds"));
      const rows = roundsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const rIds = rows.map((r) => r.id);
      setRounds(rIds);
      const cfg = {};
      rows.forEach((r) => (cfg[r.id] = Number(r.totalCheckpoints || 5)));
      setRoundConfigs(cfg);
      setPendingRoundCounts(cfg);
    };

    fetchData();
  }, []);

  /* ROUNDS: Add / Save total / Delete / Rename  */

  const handleAddRound = async () => {
    const name = newRound.trim();
    if (!name) {
      toast.error("Scrie un nume de rundă.");
      return;
    }
    if (rounds.includes(name)) {
      toast.error("Există deja o rundă cu acest nume.");
      return;
    }

    const ok = await confirmToast(`Adaugi runda „${name}”?`, {
      yesLabel: "Adaugă",
      noLabel: "Anulează",
    });
    if (!ok) {
      toast.info("Adăugarea rundei a fost anulată");
      return;
    }

    const initialTotal = 6; // default
    await setDoc(doc(db, "rounds", name), { totalCheckpoints: initialTotal, createdAt: new Date() }, { merge: true });
    await reconcileCheckpoints(name, initialTotal);

    setRounds((r) => [...r, name]);
    setRoundConfigs((r) => ({ ...r, [name]: initialTotal }));
    setPendingRoundCounts((r) => ({ ...r, [name]: initialTotal }));
    setNewRound("");
    toast.success("Rundă adăugată");
  };

  const handleSaveRoundTotal = async (roundId) => {
    let target = Number(pendingRoundCounts[roundId]);
    if (!Number.isFinite(target) || target < 0) target = 0;
    if (target > 50) target = 50; // protecție

    const ok = await confirmToast(
      `Salvezi numărul de checkpoints pentru „${roundId}” la ${target}?`,
      { yesLabel: "Salvează", noLabel: "Anulează" }
    );
    if (!ok) {
      toast.info("Salvarea numărului de checkpoints a fost anulată");
      return;
    }

    await setDoc(doc(db, "rounds", roundId), { totalCheckpoints: target, updatedAt: new Date() }, { merge: true });
    await reconcileCheckpoints(roundId, target);

    setRoundConfigs((r) => ({ ...r, [roundId]: target }));
    setPendingRoundCounts((r) => ({ ...r, [roundId]: target }));
    toast.success("Numărul de checkpoints a fost salvat");
  };

  const handleDeleteRound = async (roundId) => {
    const ok = await confirmToast(`Ștergi runda „${roundId}”? Checkpoint-urile vor fi dezactivate.`);
    if (!ok) {
      toast.info("Ștergerea a fost anulată");
      return;
    }

    // dezactivează toate checkpoint-urile rundei (păstrăm istoric)
    const qCp = query(collection(db, "checkpoints"), where("roundId", "==", roundId));
    const snap = await getDocs(qCp);
    const updates = [];
    snap.docs.forEach((d) => {
      updates.push(updateDoc(doc(db, "checkpoints", d.id), { isActive: false }));
    });
    await Promise.all(updates);

    await deleteDoc(doc(db, "rounds", roundId));

    setRounds((r) => r.filter((x) => x !== roundId));
    setRoundConfigs((r) => {
      const c = { ...r };
      delete c[roundId];
      return c;
    });
    setPendingRoundCounts((r) => {
      const c = { ...r };
      delete c[roundId];
      return c;
    });

    toast.success("Runda a fost ștearsă");
  };

  const handleRenameRound = async (oldId) => {
    const newName = (roundRename[oldId] ?? "").trim();
    if (!newName || newName === oldId) return;
    if (rounds.includes(newName)) {
      toast.error("Există deja o rundă cu acest nume.");
      return;
    }

    const ok = await confirmToast(`Redenumești runda „${oldId}” în „${newName}”?`);
    if (!ok) {
      toast.info("Redenumirea a fost anulată");
      return;
    }

    // 1) Copiază/creează docul nou în "rounds"
    const oldDoc = await getDoc(doc(db, "rounds", oldId));
    const data = oldDoc.exists()
      ? oldDoc.data()
      : { totalCheckpoints: Number(roundConfigs[oldId] ?? 0) };
    await setDoc(
      doc(db, "rounds", newName),
      { ...data, updatedAt: new Date() },
      { merge: true }
    );

    // 2) Migrează checkpoint-urile (schimbă roundId -> newName)
    const qCp = query(collection(db, "checkpoints"), where("roundId", "==", oldId));
    const snap = await getDocs(qCp);
    const ops = [];
    snap.docs.forEach((d) => {
      ops.push(updateDoc(doc(db, "checkpoints", d.id), { roundId: newName }));
    });
    await Promise.all(ops);

    // 3) Șterge docul vechi
    await deleteDoc(doc(db, "rounds", oldId));

    // 4) Actualizează state
    setRounds((r) => r.map((x) => (x === oldId ? newName : x)));
    setRoundConfigs((s) => {
      const c = { ...s };
      c[newName] = c[oldId];
      delete c[oldId];
      return c;
    });
    setPendingRoundCounts((s) => {
      const c = { ...s };
      c[newName] = c[oldId];
      delete c[oldId];
      return c;
    });
    setRoundRename((s) => {
      const c = { ...s };
      delete c[oldId];
      return c;
    });

    toast.success("Numele rundei a fost actualizat");
  };

  /*  PROBES  */

  const handleAddProbe = async () => {
    const name = newProbe.trim();
    if (!name || name === MP_ID) {
      toast.error("Nume invalid.");
      return;
    }
    if (probes.includes(name)) {
      toast.error("Există deja o probă cu acest nume.");
      return;
    }

    const ok = await confirmToast(`Adaugi proba „${name}”?`, {
      yesLabel: "Adaugă",
      noLabel: "Anulează",
    });
    if (!ok) {
      toast.info("Adăugarea probei a fost anulată");
      return;
    }

    const columns = [{ key: "score", label: "Score" }];
    await setDoc(doc(db, "probes", name), { createdAt: new Date(), weight: 0, columns }, { merge: true });
    await setDoc(doc(db, "probeWeights", name), { weight: 0 }, { merge: true });

    try {
      await batchUpdateTeams(() => ({ [`scores.${name}`]: 0 }));
    } catch {}

    setProbes((p) => {
      const dynamic = [...p.filter((x) => x !== MP_ID), name].sort((a, b) => a.localeCompare(b));
      return [MP_ID, ...dynamic];
    });
    setProbeWeights((p) => ({ ...p, [name]: 0 }));
    setInitialWeights((p) => ({ ...p, [name]: 0 }));
    setProbeDocs((p) => ({ ...p, [name]: { weight: 0, columns } }));
    setNewProbe("");
    toast.success("Proba a fost adăugată");
  };

  const handleSaveColumns = async (probeId) => {
    const cols = probeDocs[probeId]?.columns || [{ key: "score", label: "Score" }];
    const ok = await confirmToast(`Salvezi coloanele pentru „${probeId}”?`, {
      yesLabel: "Salvează",
      noLabel: "Anulează",
    });
    if (!ok) {
      toast.info("Salvarea coloanelor a fost anulată");
      return;
    }
    await setDoc(doc(db, "probes", probeId), { columns: cols }, { merge: true });
    toast.success("Coloanele au fost salvate");
  };

  const addColumnRow = async (probeId) => {
    const ok = await confirmToast(`Adaugi o coloană nouă la „${probeId}”?`, {
      yesLabel: "Adaugă",
      noLabel: "Anulează",
    });
    if (!ok) {
      toast.info("Adăugarea coloanei a fost anulată");
      return;
    }
    setProbeDocs((p) => {
      const cur = p[probeId] || { columns: [] };
      const next = [...(cur.columns || []), { key: keyFromLabel("criterion"), label: "Criterion" }];
      toast.success("Coloană adăugată");
      return { ...p, [probeId]: { ...cur, columns: next } };
    });
  };

  const updateColumnLabel = (probeId, idx, label) => {
    setProbeDocs((p) => {
      const cur = p[probeId] || { columns: [] };
      const cols = [...(cur.columns || [])];
      const existing = cols[idx] || { key: keyFromLabel(label), label };
      cols[idx] = { ...existing, label };
      return { ...p, [probeId]: { ...cur, columns: cols } };
    });
  };

  const removeColumn = async (probeId, idx) => {
    const col = (probeDocs[probeId]?.columns || [])[idx];
    const label = col?.label || "coloană";
    const ok = await confirmToast(`Ștergi „${label}” din „${probeId}”?`, {
      yesLabel: "Șterge",
      noLabel: "Anulează",
    });
    if (!ok) {
      toast.info("Ștergerea coloanei a fost anulată");
      return;
    }
    setProbeDocs((p) => {
      const cur = p[probeId] || { columns: [] };
      const cols = [...(cur.columns || [])];
      cols.splice(idx, 1);
      toast.success("Coloană ștearsă");
      return { ...p, [probeId]: { ...cur, columns: cols } };
    });
  };

  const handleDeleteProbe = async (name) => {
    if (name === MP_ID) {
      toast.error("Nu poți șterge Mission Performance.");
      return;
    }
    const ok = await confirmToast(`Ștergi proba „${name}”?`);
    if (!ok) {
      toast.info("Ștergerea a fost anulată");
      return;
    }
    await deleteDoc(doc(db, "probes", name));
    await deleteDoc(doc(db, "probeWeights", name));
    try {
      await batchUpdateTeams(() => ({ [`scores.${name}`]: deleteField() }));
    } catch {}
    setProbes((p) => p.filter((x) => x !== name));
    setProbeWeights((p) => {
      const c = { ...p };
      delete c[name];
      return c;
    });
    setProbeDocs((p) => {
      const c = { ...p };
      delete c[name];
      return c;
    });
    toast.success("Proba a fost ștearsă");
  };

  const handleRenameProbe = async (oldName) => {
    if (oldName === MP_ID) {
      toast.error("Mission Performance nu poate fi redenumită.");
      return;
    }
    const newName = (probeRename[oldName] ?? "").trim();
    if (!newName || newName === oldName) return;

    if (probes.includes(newName)) {
      toast.error("Există deja o probă cu acest nume.");
      return;
    }

    const ok = await confirmToast(`Redenumești proba „${oldName}” în „${newName}”?`);
    if (!ok) {
      toast.info("Redenumirea a fost anulată");
      return;
    }

    const oldDoc = await getDoc(doc(db, "probes", oldName));
    const w = oldDoc.exists() ? oldDoc.data().weight ?? 0 : 0;
    const cols =
      oldDoc.exists() && Array.isArray(oldDoc.data().columns)
        ? oldDoc.data().columns
        : [{ key: "score", label: "Score" }];

    await setDoc(doc(db, "probes", newName), { createdAt: new Date(), weight: w, columns: cols }, { merge: true });
    await setDoc(doc(db, "probeWeights", newName), { weight: w }, { merge: true });

    try {
      await batchUpdateTeams((teamDoc) => {
        const s = teamDoc.data()?.scores || {};
        if (Object.prototype.hasOwnProperty.call(s, oldName)) {
          return { [`scores.${newName}`]: s[oldName], [`scores.${oldName}`]: deleteField() };
        }
        return null;
      });
    } catch {}

    await deleteDoc(doc(db, "probes", oldName));
    await deleteDoc(doc(db, "probeWeights", oldName));

    setProbes((p) => {
      const replaced = p.map((x) => (x === oldName ? newName : x));
      const dynamic = replaced.filter((x) => x !== MP_ID).sort((a, b) => a.localeCompare(b));
      return [MP_ID, ...dynamic];
    });
    setProbeWeights((p) => {
      const c = { ...p };
      c[newName] = c[oldName];
      delete c[oldName];
      return c;
    });
    setProbeDocs((p) => {
      const c = { ...p };
      c[newName] = c[oldName];
      delete c[oldName];
      return c;
    });
    setProbeRename((p) => {
      const c = { ...p };
      delete c[oldName];
      return c;
    });
    toast.success("Numele probei a fost actualizat");
  };

  const saveProbeWeight = async (name) => {
    const w = parseInt(probeWeights[name]) || 0;
    const totalIfSave = Object.entries(probeWeights).reduce(
      (acc, [k, v]) => acc + (k === name ? w : parseInt(v) || 0),
      0
    );
    if (totalIfSave !== 100) {
      toast.error(`Suma ponderilor trebuie să fie 100%. Ar fi ${totalIfSave}%.`);
      return;
    }
    const ok = await confirmToast(`Salvezi ponderea pentru „${name}” la ${w}%?`, {
      yesLabel: "Salvează",
      noLabel: "Anulează",
    });
    if (!ok) {
      toast.info("Salvarea ponderii a fost anulată");
      return;
    }
    await setDoc(doc(db, "probes", name), { weight: w }, { merge: true });
    await setDoc(doc(db, "probeWeights", name), { weight: w }, { merge: true });
    setInitialWeights((p) => ({ ...p, [name]: w }));
    setProbeDocs((p) => ({ ...p, [name]: { ...(p[name] || {}), weight: w } }));
    toast.success("Pondere salvată");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <ToastContainer position="top-center" />
      <header className="bg-slate-900 border-b border-slate-800">
        <div className="px-3 py-3">
          <button
            onClick={() => navigate("/professor")}
            className="text-slate-300 hover:text-white px-2 py-1 rounded border border-transparent hover:border-slate-600"
          >
            ← Back
          </button>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-3">
          <h1 className="text-xl font-semibold tracking-tight">Manage Topics and Attempts</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-8">
        {/* Intro */}
        <section>
          <h2 className="text-lg font-semibold">Configuration</h2>
          <p className="text-slate-400">
            Set topics names and weights. Mission Performance is name-locked; you can change its weight and now also its fields (columns).
          </p>
        </section>

        {/* Add probe */}
        <div className="flex flex-col sm:flex-row gap-2 justify-end">
          <input
            type="text"
            placeholder="New topic name"
            value={newProbe}
            onChange={(e) => setNewProbe(e.target.value)}
            className="bg-slate-900 px-3 py-2 rounded-md border border-slate-700 focus:border-slate-500 outline-none text-sm w-full sm:w-72"
          />
          <button
            onClick={async () => {
              await handleAddProbe();
            }}
            className="px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm"
          >
            Add
          </button>
        </div>

        {/* Probes table */}
        <section className="mt-2">
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            <div className="hidden md:grid bg-slate-900 grid-cols-[56px_1fr_minmax(220px,_auto)_minmax(240px,_auto)] text-xs uppercase tracking-wider text-slate-400 px-4 py-2">
              <div>#</div>
              <div> Topics</div>
              <div>Weight</div>
              <div className="text-right">Actions</div>
            </div>

            <div className="divide-y divide-slate-800">
              {probes.map((probe, idx) => {
                const isMP = (probe ?? "").trim() === MP_ID;
                const currentName = (probeRename[probe] ?? probe).trim();
                const currentWeight = probeWeights[probe] ?? "";
                const nameDirty = !isMP && currentName !== probe;
                const weightDirty = (initialWeights[probe] ?? 0) !== (parseInt(currentWeight) || 0);
                const cols = probeDocs[probe]?.columns || [{ key: "score", label: "Score" }];

                return (
                  <div key={probe} className="bg-slate-950 hover:bg-slate-900/60 transition-colors">
                    <div className="grid gap-3 px-4 py-3 grid-cols-1 md:grid-cols-[56px_1fr_minmax(220px,_auto)_minmax(240px,_auto)]">
                      <div className="text-slate-400 md:place-self-center">{idx + 1}.</div>
                      <div className="flex items-center gap-2 min-w-0">
                        {isMP ? (
                          <>
                            <span className="font-medium truncate">{probe}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-amber-300 shrink-0 border border-slate-700">
                              locked
                            </span>
                          </>
                        ) : (
                          <>
                            <input
                              value={currentName}
                              onChange={(e) => setProbeRename((prev) => ({ ...prev, [probe]: e.target.value }))}
                              className="flex-1 min-w-0 bg-slate-950 rounded-md px-3 py-2 outline-none border border-slate-700 focus:border-slate-500 text-sm truncate"
                              placeholder="Probe name"
                            />
                            <button
                              onClick={() => handleRenameProbe(probe)}
                              disabled={!nameDirty}
                              className={`px-3 py-2 rounded-md text-sm font-medium shrink-0 ${
                                nameDirty
                                  ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                                  : "bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700"
                              }`}
                            >
                              Save name
                            </button>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={currentWeight}
                          onChange={(e) => {
                            let clean = (e.target.value || "").replace(/\D/g, "");
                            if (clean.length > 3) clean = clean.slice(0, 3);
                            const num = Math.min(100, Number(clean || 0));
                            setProbeWeights((prev) => ({ ...prev, [probe]: isNaN(num) ? "" : num }));
                          }}
                          className="w-24 text-center bg-slate-950 rounded-md px-3 py-2 outline-none border border-slate-700 focus:border-slate-500 text-sm"
                        />
                        <span className="text-slate-400 shrink-0 text-sm">%</span>
                      </div>
                      <div className="flex items-center gap-2 justify-end flex-wrap">
                        <button
                          onClick={() => saveProbeWeight(probe)}
                          disabled={!weightDirty}
                          className={`px-3 py-2 rounded-md text-sm font-medium shrink-0 ${
                            weightDirty
                              ? "bg-blue-600 hover:bg-blue-500 text-white"
                              : "bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700"
                          }`}
                        >
                          Save weight
                        </button>

                        {/* Columns editor is available for ALL probes, including MP */}
                        <button
                          onClick={async () => {
                            const willOpen = !expanded[probe];
                            const ok = await confirmToast(
                              willOpen
                                ? `Deschizi editorul de coloane pentru „${currentName}”?`
                                : `Închizi editorul de coloane pentru „${currentName}”?`,
                              { yesLabel: willOpen ? "Deschide" : "Închide", noLabel: "Anulează" }
                            );
                            if (!ok) {
                              toast.info("Acțiunea a fost anulată");
                              return;
                            }
                            setExpanded((p) => ({ ...p, [probe]: willOpen }));
                            toast.info(willOpen ? "Editor coloane deschis" : "Editor coloane închis");
                          }}
                          className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium shrink-0"
                        >
                          {expanded[probe] ? "Hide" : "Columns"}
                        </button>

                        {/* Delete only for non-MP */}
                        {!isMP && (
                          <button
                            onClick={() => handleDeleteProbe(probe)}
                            className="px-3 py-2 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium shrink-0"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Columns editor (enabled for MP too) */}
                    {expanded[probe] && (
                      <div className="px-6 pb-4">
                        <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-slate-300 font-medium">Columns for {currentName}</div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => addColumnRow(probe)}
                                className="px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
                              >
                                + Add column
                              </button>
                              <button
                                onClick={() => handleSaveColumns(probe)}
                                className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
                              >
                                Save columns
                              </button>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {cols.map((c, i) => (
                              <div key={c.key} className="flex items-center gap-2">
                                <input
                                  value={c.label}
                                  onChange={(e) => updateColumnLabel(probe, i, e.target.value)}
                                  className="flex-1 bg-slate-950 rounded-md px-3 py-2 outline-none border border-slate-700 focus:border-slate-500 text-sm"
                                />
                                <button
                                  onClick={() => removeColumn(probe, i)}
                                  className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-sm"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                            {cols.length === 0 && (
                              <div className="text-sm text-slate-400">
                                No columns — scorul pe probă nu va putea fi introdus.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className={`mt-4 text-sm ${sumAllWeights === 100 ? "text-emerald-400" : "text-rose-400"}`}>
            Topics: <b>{dynamicSum}%</b> + Mission Performance: <b>{missionWeight}%</b> ={" "}
            <b>{sumAllWeights}%</b> — trebuie să fie <b>100%</b>.
          </div>
        </section>

        {/* ROUNDS: Manage Checkpoints per Round  */}
        <section className="rounded-lg border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900 text-center">
            <h3 className="font-semibold">📍 Manage Checkpoints per Attempts</h3>
          </div>

          <div className="divide-y divide-slate-800">
            {rounds.map((rId) => {
              const pending = pendingRoundCounts[rId] ?? roundConfigs[rId] ?? 0;
              const dirty = Number(pending) !== Number(roundConfigs[rId] ?? 0);
              const currentName = (roundRename[rId] ?? rId).trim();
              const nameDirty = currentName !== rId;

              return (
                <div key={rId} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[260px] font-medium flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 border border-slate-700">
                      🏁
                    </span>
                    <input
                      value={currentName}
                      onChange={(e) => setRoundRename((prev) => ({ ...prev, [rId]: e.target.value }))}
                      className="flex-1 min-w-0 bg-slate-950 rounded-md px-3 py-2 outline-none border border-slate-700 focus:border-slate-500 text-sm truncate"
                      placeholder="Round name"
                    />
                    <button
                      onClick={() => handleRenameRound(rId)}
                      disabled={!nameDirty}
                      className={`px-3 py-2 rounded-md text-sm font-medium shrink-0 ${
                        nameDirty
                          ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                          : "bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700"
                      }`}
                    >
                      Save name
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={pending}
                      onChange={(e) => {
                        let v = (e.target.value || "").replace(/\D/g, "");
                        if (v.length > 2) v = v.slice(0, 2);
                        const n = Math.max(0, Math.min(50, Number(v || 0)));
                        setPendingRoundCounts((p) => ({ ...p, [rId]: n }));
                      }}
                      className="w-20 text-center bg-slate-950 rounded-md px-3 py-2 outline-none border border-slate-700 focus:border-slate-500 text-sm"
                    />
                    <span className="text-slate-400 text-sm">checkpoints</span>
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => handleSaveRoundTotal(rId)}
                      disabled={!dirty}
                      className={`px-3 py-2 rounded-md text-sm font-medium ${
                        dirty
                          ? "bg-slate-700 hover:bg-slate-600 text-white"
                          : "bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700"
                      }`}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => handleDeleteRound(rId)}
                      className="px-3 py-2 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add new round */}
          <div className="px-4 py-3 border-t border-slate-800 flex items-center gap-2">
            <input
              type="text"
              placeholder="New round name"
              value={newRound}
              onChange={(e) => setNewRound(e.target.value)}
              className="flex-1 bg-slate-950 rounded-md px-3 py-2 outline-none border border-slate-700 focus:border-slate-500 text-sm"
            />
            <button
              onClick={async () => {
                await handleAddRound();
              }}
              className="px-3 py-2 rounded-md bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-sm font-medium"
            >
              + Add
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

/* tiny helper to placate some IDEs when state is unused in preview builds */
function theSanityFix(_) { return _; }
