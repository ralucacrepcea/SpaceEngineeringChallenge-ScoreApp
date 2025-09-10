// src/pages/TeamDashboard.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";

/*  Helpers & constants */
const MP_ID = "Mission Performance";
const clamp010 = (v) => Math.max(0, Math.min(10, v));
const toNum = (v) => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return clamp010(Number.isFinite(n) ? n : 0);
};
const cx = (...p) => p.filter(Boolean).join(" ");
const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/* Normalize MP/Topic columns into { key, label, weight? } */
function normalizeColumns(arr) {
  const seen = new Set();
  return (Array.isArray(arr) ? arr : [])
    .map((c) => {
      if (!c) return null;
      if (typeof c === "string") return { key: slug(c), label: c };
      const label = (c.label || c.name || c.title || c.key || "").trim();
      const key = slug(c.key || label);
      const weight = Number(c.weight);
      if (!label || !key) return null;
      const out = { key, label };
      if (Number.isFinite(weight)) out.weight = weight;
      return out;
    })
    .filter((c) => c && !seen.has(c.key) && (seen.add(c.key), true));
}

const mpKey = (roundId, fieldKey) => `MP:${roundId}:${fieldKey}`;
const TOPICS_SUBTITLE =
  "Summary of topics scores from judges.";

/*  Small UI atoms */
function SectionHeader({ title, subtitle, right }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-800/80 bg-gradient-to-r from-slate-950 to-slate-900/40">
      <div>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-slate-100">{title}</h2>
        {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

function StatTile({ label, value, hint, tone = "neutral" }) {
  const tones = {
    neutral: "border-slate-800 text-slate-200",
    success: "border-emerald-500/20 text-emerald-300",
    warning: "border-amber-500/20 text-amber-300",
    danger: "border-rose-500/20 text-rose-300",
    accent: "border-indigo-500/20 text-indigo-300",
  };
  return (
    <div className={cx("rounded-xl bg-slate-900/70 border p-4 shadow-sm", tones[tone])}>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function Ring({ value = 0 }) {
  const pct = Math.max(0, Math.min(100, value * 10));
  const color = value >= 8 ? "#34d399" : value >= 5 ? "#f59e0b" : "#f87171";
  const bg = `conic-gradient(${color} ${pct}%, rgba(148,163,184,.25) ${pct}% 100%)`;
  return (
    <div className="inline-grid place-items-center w-14 h-14 relative">
      <div
        className="w-14 h-14 rounded-full"
        style={{ background: bg, boxShadow: "inset 0 0 0 6px rgba(15,23,42,.95)" }}
        aria-hidden="true"
      />
      <div className="absolute text-[11px] leading-none text-slate-200 font-semibold">
        {value.toFixed(1)}
      </div>
    </div>
  );
}

/*  Page */
export default function TeamDashboard() {
  const { currentUser } = useAuth();

  // Identity
  const [teamId, setTeamId] = useState(null);
  const [teamData, setTeamData] = useState(null);

  // Rounds
  const [roundIds, setRoundIds] = useState([]);
  const [roundTotals, setRoundTotals] = useState({});

  // Checkpoints & scans (informational only)
  const [checkpointsByRound, setCheckpointsByRound] = useState({});
  const [scansByRound, setScansByRound] = useState({});

  // Probes
  const [manualProbes, setManualProbes] = useState([]); // [{id, weight, columns:[{key,label,weight?}]}]
  const [missionWeight, setMissionWeight] = useState(20);
  const [mpColumns, setMpColumns] = useState([]); // fields for MP from Manage Topics

  /* team & live team doc */
  useEffect(() => {
    if (!currentUser) return;
    let unsub = null;
    (async () => {
      const u = await getDoc(doc(db, "users", currentUser.uid));
      const tid = u.data()?.teamId || null;
      setTeamId(tid);
      if (!tid) return;
      unsub = onSnapshot(doc(db, "teams", tid), (s) => setTeamData(s.data() || {}));
    })();
    return () => unsub && unsub();
  }, [currentUser]);

  /* rounds & totals */
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "rounds"));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRoundIds(rows.map((r) => r.id));
      const totals = {};
      rows.forEach((r) => {
        const t = r.totalCheckpoints ?? r.checkpoints?.totalCheckpoints ?? 0;
        totals[r.id] = Number(t) || 0;
      });
      setRoundTotals(totals);
    })();
  }, []);

  /* active checkpoints per round (informational) */
  useEffect(() => {
    if (roundIds.length === 0) return;
    (async () => {
      const byRound = {};
      for (const r of roundIds) {
        const qCp = query(
          collection(db, "checkpoints"),
          where("roundId", "==", r),
          where("isActive", "==", true)
        );
        const snap = await getDocs(qCp);
        byRound[r] = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => Number(a.order) - Number(b.order));
      }
      setCheckpointsByRound(byRound);
    })();
  }, [roundIds]);

  /*  live scans by team (id + legacy name) — only for dots */
  useEffect(() => {
    if (!teamId) return;
    const unsubs = [];
    let byId = {};
    let byName = {};
    const merge = () => {
      const out = {};
      for (const src of [byId, byName]) {
        Object.entries(src).forEach(([r, arr]) => {
          if (!out[r]) out[r] = [];
          out[r].push(...arr);
        });
      }
      setScansByRound(out);
    };

    unsubs.push(
      onSnapshot(query(collection(db, "scans"), where("teamId", "==", teamId)), (snap) => {
        const tmp = {};
        snap.forEach((d) => {
          const v = d.data();
          if (!v?.roundId) return;
          if (!tmp[v.roundId]) tmp[v.roundId] = [];
          tmp[v.roundId].push(v);
        });
        byId = tmp;
        merge();
      })
    );

    if (teamData?.name) {
      unsubs.push(
        onSnapshot(query(collection(db, "scans"), where("teamId", "==", teamData.name)), (snap) => {
          const tmp = {};
          snap.forEach((d) => {
            const v = d.data();
            if (!v?.roundId) return;
            if (!tmp[v.roundId]) tmp[v.roundId] = [];
            tmp[v.roundId].push(v);
          });
          byName = tmp;
          merge();
        })
      );
    }

    return () => unsubs.forEach((fn) => fn && fn());
  }, [teamId, teamData?.name]);

  /* probes & weights (also load MP columns) */
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "probes"));
      const manual = [];
      let mpW = 20;
      let mpCols = [];
      snap.forEach((d) => {
        const id = d.id;
        const data = d.data() || {};
        if (id === MP_ID) {
          const w = Number(data.weight);
          if (Number.isFinite(w)) mpW = w;
          mpCols = normalizeColumns(data.columns);
        } else {
          manual.push({
            id,
            weight: Number(data.weight ?? 0) || 0,
            // IMPORTANT: normalize columns for proper keys/weights
            columns: Array.isArray(data.columns) ? data.columns : [],
          });
        }
      });
      manual.sort((a, b) => a.id.localeCompare(b.id));
      setManualProbes(manual);
      setMissionWeight(mpW);
      setMpColumns(mpCols);
    })();
  }, []);

  /* Derived UI state */
  const roundsUi = useMemo(() => {
    return roundIds.map((r) => {
      const cps = (checkpointsByRound[r] || []).slice();
      const scans = scansByRound[r] || [];
      const cpIdToOrder = new Map(cps.map((cp) => [cp.id, Number(cp.order)]));

      const reachedOrders = new Set(
        scans.map((s) => cpIdToOrder.get(s.cpId)).filter((ord) => Number.isFinite(ord))
      );

      const tempByOrder = new Map();
      const humByOrder = new Map();
      for (const s of scans) {
        const ord = cpIdToOrder.get(s.cpId);
        if (!Number.isFinite(ord)) continue;
        if (s.temp !== undefined) tempByOrder.set(ord, s.temp ?? "–");
        if (s.humidity !== undefined) humByOrder.set(ord, s.humidity ?? "–");
      }

      const total = Number(roundTotals[r] ?? 0) || 0;
      const hitsCount = Array.from(reachedOrders).filter((ord) => ord >= 1 && ord <= total).length;
      const progress = total ? hitsCount / total : 0;

      return { roundId: r, total, hitsCount, progress, reachedOrders, tempByOrder, humByOrder };
    });
  }, [roundIds, checkpointsByRound, scansByRound, roundTotals]);

  /* Mission Performance (PROF) calculations */
  const roundProfScore = (roundId) => {
    if (!teamData) return null;
    const fields = mpColumns || [];
    if (fields.length === 0) return null;

    const hasWeights = fields.some((f) => Number(f.weight) > 0);

    if (!hasWeights) {
      const vals = [];
      let any = false;
      for (const f of fields) {
        const raw = teamData?.scores?.[mpKey(roundId, f.key)];
        const present = raw === 0 || raw === "0" || String(raw ?? "").trim() !== "";
        if (present) any = true;
        vals.push(toNum(raw));
      }
      if (!any) return null;
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }

    const totalW = fields.reduce((a, f) => a + (Number(f.weight) || 0), 0) || 1;
    let acc = 0;
    let any = false;
    for (const f of fields) {
      const raw = teamData?.scores?.[mpKey(roundId, f.key)];
      const present = raw === 0 || raw === "0" || String(raw ?? "").trim() !== "";
      if (present) any = true;
      const v = toNum(raw);
      const w = (Number(f.weight) || 0) / totalW;
      acc += v * w;
    }
    return any ? acc : null;
  };

  // IMPORTANT: MP total = media pe TOATE rundele; rundele fără note = 0 (aliniat cu ProfessorPanel)
  const perRoundProf010 = roundIds.map((rid) => {
    const v = roundProfScore(rid);
    return Number.isFinite(v) ? v : 0;
  });

  const avgMission = roundIds.length
    ? perRoundProf010.reduce((a, b) => a + b, 0) / roundIds.length
    : 0;

  // Manual probes — respect sub-field weights when present
  const manualRows = manualProbes.map((p, i) => {
    const st = teamData?.scores?.[p.id];
    const cols = Array.isArray(p.columns) ? p.columns : [];
    const hasW = cols.some((c) => Number(c.weight) > 0);

    const score = cols.length > 0
      ? (hasW
          ? (() => {
              const totalW = cols.reduce((a, c) => a + (Number(c.weight) || 0), 0) || 1;
              return cols.reduce(
                (acc, c) => acc + toNum(st?.[c.key]) * ((Number(c.weight) || 0) / totalW),
                0
              );
            })()
          : (() => {
              const vals = cols.map((c) => toNum(st?.[c.key]));
              return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
            })())
      : toNum(st);

    return {
      index: i + 1,
      probe: p.id,
      weight: Number(p.weight || 0),
      score,
      weighted: score * (Number(p.weight || 0) / 100),
      columns: cols,
    };
  });

  const manualSubtotal = manualRows.reduce((acc, r) => acc + r.weighted, 0);
  const mpWeighted = avgMission * (Number(missionWeight) / 100);
  const totalWeights =
    Number(missionWeight) + manualProbes.reduce((a, p) => a + Number(p.weight || 0), 0);
  const finalGrade = totalWeights === 100 ? manualSubtotal + mpWeighted : null;

  /* Loading skeleton */
  if (!teamId || !teamData) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-9 w-64 bg-slate-800/60 rounded" />
            <div className="h-32 w-full bg-slate-800/30 rounded-xl" />
            <div className="h-80 w-full bg-slate-800/30 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const teamName = teamData.name || teamId;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Accent wrapper with gradient border */}
        <div className="rounded-2xl p-[1px] bg-gradient-to-r from-indigo-500/40 via-slate-700/30 to-emerald-500/40 shadow-2xl">
          <section className="rounded-2xl bg-slate-900/70 backdrop-blur-xl border border-slate-800/80 overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-800/80">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                    Team Dashboard — <span className="text-indigo-300">{teamName}</span>
                  </h1>
                  <div className="mt-1 text-sm text-slate-400">
                    Weights: <b>{missionWeight}%</b> MP +{" "}
                    <b>{Math.max(0, totalWeights - missionWeight)}%</b> Topics
                    {totalWeights !== 100 && (
                      <span className="ml-2 text-amber-300">
                        (sum is {totalWeights}%, should be 100%)
                      </span>
                    )}
                  </div>
                </div>

                <div className="hidden md:flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full text-xs ring-1 ring-slate-700 text-slate-300">
                    Read-only
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-xs ring-1 ring-indigo-500/30 text-indigo-300 bg-indigo-500/10">
                    Live
                  </span>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid sm:grid-cols-3 gap-4 mt-5">
                <StatTile
                  label="Topics subtotal"
                  value={manualSubtotal.toFixed(2)}
                  hint="Sum of weighted topics"
                  tone="success"
                />
                <StatTile
                  label={`Mission Performance `}
                  value={`${avgMission.toFixed(2)} × ${(missionWeight / 100).toFixed(2)} = ${mpWeighted.toFixed(2)}`}
                  hint="Per-round mean over ALL rounds (ungraded rounds = 0)"
                  tone="accent"
                />
                <StatTile
                  label="Final grade"
                  value={finalGrade == null ? "—" : `${finalGrade.toFixed(2)} / 10`}
                  hint={finalGrade == null ? "Weights must sum to 100%" : "Computed in real time"}
                  tone={finalGrade == null ? "warning" : "neutral"}
                />
              </div>
            </div>

            {/* Mission Performance */}
            <SectionHeader
              title="Mission Performance"
              subtitle="Checkpoints are informational only. MP grade comes solely from organizer-scored fields."
            />
            <div className="px-6 py-6">
              {roundsUi.length === 0 ? (
                <div className="text-slate-400 text-sm">No rounds configured yet.</div>
              ) : null}

              {roundsUi.map(
                ({ roundId, total, hitsCount, progress, reachedOrders, tempByOrder, humByOrder }, idx) => (
                  <div
                    key={roundId}
                    className={cx(
                      "mb-6 rounded-xl p-4 border",
                      idx % 2 ? "bg-slate-900/50" : "bg-slate-900/30",
                      "border-slate-800/80"
                    )}
                  >
                    {/* Top row: ONLY title */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-medium text-slate-300">{roundId}</div>
                    </div>

                    {/* Dots row */}
                    <div className="relative flex items-center justify-between mb-3">
                      {Array.from({ length: total }).map((_, i) => {
                        const order = i + 1;
                        const reached = reachedOrders.has(order);
                        const t = tempByOrder.get(order);
                        const h = humByOrder.get(order);

                        return (
                          <div key={order} className="flex flex-col items-center w-full text-center group">
                            <div
                              className={cx(
                                "w-8 h-8 rounded-full border-2 flex items-center justify-center text-[11px] font-bold transition-all shadow ring-1",
                                reached
                                  ? "bg-emerald-400 border-emerald-300 text-black ring-emerald-600/30"
                                  : "bg-slate-900 border-slate-600 text-slate-400 ring-slate-700/30 group-hover:ring-indigo-500/30"
                              )}
                              title={reached ? "Reached" : "Not reached"}
                            >
                              {order}
                            </div>
                            <span className="text-[10px] mt-1 text-slate-400 font-mono">P{order}</span>
                            <div className="text-[10px] text-slate-400 mt-1 leading-tight">
                              {t !== undefined ? `🌡 ${t}°C` : "🌡 —"}
                              <br />
                              {h !== undefined ? `💧 ${h}%` : "💧 —"}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Progress bar (informational) */}
                    <div className="relative w-full h-[6px] bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 to-emerald-600 transition-[width] duration-700"
                        style={{ width: `${Math.min(100, progress * 100)}%` }}
                      />
                    </div>

                    {/* Hits count */}
                    <p className="mt-2 text-sm text-slate-400 text-center">
                      {hitsCount} / {total} checkpoints
                    </p>

                    {/* Professor grading recap (read-only) */}
                    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                      <div className="text-sm font-semibold text-slate-200 mb-3">
                        Topics 
                      </div>
                      {mpColumns.length === 0 ? (
                        <div className="text-sm text-slate-400">
                          No MP fields defined in <b>Manage Topics</b>.
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          {mpColumns.map((f) => {
                            const key = mpKey(roundId, f.key);
                            const valRaw = teamData?.scores?.[key];
                            const val = String(valRaw ?? "") === "" ? null : toNum(valRaw);
                            const note = teamData?.scoresNotes?.[key]?.text || "";
                            const has = val !== null || note.trim() !== "";
                            return (
                              <div
                                key={key}
                                className="rounded-md border border-slate-800 bg-slate-900/60 p-3"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-slate-200 font-medium">{f.label}</div>
                                  <div className="shrink-0">
                                    {val === null ? (
                                      <span className="px-2 py-1 text-xs rounded bg-slate-800 text-slate-400 ring-1 ring-slate-700">
                                        —
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm ring-1 ring-slate-700 bg-slate-900/60">
                                        <span className="text-xs text-slate-400">score</span>
                                        <span className="font-semibold text-slate-100">
                                          {val.toFixed(2)}
                                        </span>
                                        <span className="opacity-60 text-slate-400 text-xs">/10</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {has && note.trim() !== "" ? (
                                  <div className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">
                                    {note}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="mt-3 flex justify-end">
                        <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-sm">
                          <span className="text-slate-400 mr-2">Total score for this track</span>
                          <span className="font-semibold text-slate-100">
                            {(() => {
                              const v = roundProfScore(roundId);
                              return v == null ? "—" : v.toFixed(2);
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              )}

              {roundsUi.length > 0 && (
                <div className="mt-4 text-center">
                  <span className="text-sm text-slate-400">Average MP score (prof)</span>{" "}
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm ring-1 ring-indigo-500/30 text-indigo-200 bg-indigo-500/10 font-semibold">
                    {avgMission.toFixed(2)} <span className="opacity-70">/10</span>
                  </span>
                  <div className="text-xs text-slate-500 mt-1">
                    Per-round mean over <b>all</b> rounds; ungraded rounds count as 0.
                  </div>
                </div>
              )}
            </div>

            {/* Manual Probes */}
            <SectionHeader
              title="Topics"
              subtitle={TOPICS_SUBTITLE}
              right={null}
            />
            <div className="px-6 pb-8 pt-5">
              <div className="overflow-x-auto rounded-xl border border-slate-800/80">
                <table className="table-fixed min-w-[1100px] w-full text-sm">
                  <thead className="bg-slate-900/80 text-slate-300 text-xs uppercase">
                    <tr>
                      <th className="w-10 px-3 py-3 text-left">#</th>
                      <th className="w-48 px-3 py-3 text-left">Topic</th>
                      <th className="w-24 px-3 py-3 text-center">Weight %</th>
                      <th className="w-[580px] px-3 py-3 text-left">Fields</th>
                      <th className="w-32 px-3 py-3 text-center">Topic score</th>
                      <th className="w-28 px-3 py-3 text-center">Weighted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                    {manualRows.map((r, rowIdx) => {
                      const probeDef = manualProbes.find((p) => p.id === r.probe) || { columns: [] };
                      const cols = probeDef.columns || [];
                      const hasSub = cols.length > 0;
                      const weightedVal = r.weighted;
                      const avgVal = r.score;

                      return (
                        <tr
                          key={r.probe}
                          className={cx(
                            "align-top",
                            rowIdx % 2 ? "bg-slate-900/40" : "bg-transparent",
                            "hover:bg-slate-900/70 transition-colors"
                          )}
                        >
                          <td className="py-3 px-3">{r.index}</td>
                          <td className="py-3 px-3 font-medium text-slate-200">{r.probe}</td>
                          <td className="py-3 px-3 text-center">{r.weight}</td>
                          <td className="py-3 px-3">
                            {hasSub ? (
                              <div className="space-y-2">
                                {cols.map((c) => {
                                  const v = toNum(teamData?.scores?.[r.probe]?.[c.key]);
                                  return (
                                    <div key={c.key} className="flex items-center justify-between">
                                      <span className="text-slate-300">
                                        {c.label}{Number(c.weight) ? ` (${Number(c.weight)}%)` : ""}
                                      </span>
                                      <span className="font-semibold text-slate-200">{v.toFixed(2)}</span>
                                    </div>
                                  );
                                })}
                                <div className="flex items-center justify-end gap-2 text-sm text-slate-400">
                                  <span>Avg:</span>
                                  <span className="font-semibold text-slate-200">{avgVal.toFixed(2)}</span>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-300">Score</span>
                                <span className="font-semibold text-slate-200">
                                  {toNum(teamData?.scores?.[r.probe]).toFixed(2)}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <Ring value={avgVal} />
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full ring-1 ring-slate-700 bg-slate-900/60">
                              <span className="text-xs text-slate-400">w</span>
                              <span className="font-semibold text-slate-100">
                                {Number.isFinite(weightedVal) ? weightedVal.toFixed(2) : "0.00"}
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-800 bg-slate-900/80">
                      <td colSpan={5} className="py-3 px-3 text-right font-semibold">
                        Topics subtotal
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 font-semibold">
                          {manualSubtotal.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Bottom recap */}
              <div className="mt-5 grid gap-2 text-sm max-w-2xl ml-auto">
                <div className="flex justify-between">
                  <span className="text-slate-300">
                    Mission Performance average 
                  </span>
                  <span className="font-semibold text-emerald-300">
                    {avgMission.toFixed(2)} × {(missionWeight / 100).toFixed(2)} = {mpWeighted.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-800 pt-2 text-base">
                  <span className="font-semibold">Final grade</span>
                  {finalGrade == null ? (
                    <span className="font-bold text-amber-300">— (weights must sum to 100%)</span>
                  ) : (
                    <span className="font-bold text-yellow-300">{finalGrade.toFixed(2)} / 10</span>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
