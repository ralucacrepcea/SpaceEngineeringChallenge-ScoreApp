import { useEffect, useMemo, useState, memo, useCallback, useRef } from "react";
import { db, auth as authInstance, rtdb as rtdbInstance } from "../firebase";
import {
  collection,
  doc,
  onSnapshot,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useNavigate } from "react-router-dom";
import { ref as dbRef, onValue } from "firebase/database";

/*  Const & Utils  */
const MP_ID = "Mission Performance";
const GRACE_MS = 60 * 1000;
const scanKey = (teamId, roundId, cpId) => `${teamId}_${roundId}_${cpId}`;

const clamp010 = (v) => Math.max(0, Math.min(10, v));
const toNum = (v) => {
  let n = parseFloat(String(v ?? "").replace(",", "."));
  if (Number.isNaN(n)) n = 0;
  return clamp010(n);
};
const cleanStr = (s) => (s == null ? "" : String(s));
const norm = (v) => (typeof v === "number" ? Number(v.toFixed(3)) : toNum(v));
const hashOf = (value, note = "") => JSON.stringify([norm(value), cleanStr(note)]);
const normText = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);

/* Format HH:MM:SS local time for a given epoch ms */
const fmtClock = (ms) =>
  ms ? new Date(ms).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

/* Normalize columns into { key, label, weight? } */
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

/*  Small helpers / hooks  */
function cx(...parts) { return parts.filter(Boolean).join(" "); }
function useAutoGrow(value) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}
function useLocalStorageState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : initialValue;
    } catch { return initialValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

/*  Visual bits  */
const Ring = ({ value = 0, size = 56 }) => {
  const pct = Math.max(0, Math.min(100, value * 10));
  const color = value >= 8 ? "#34d399" : value >= 5 ? "#f59e0b" : "#f87171";
  const bg = `conic-gradient(${color} ${pct}%, rgba(148,163,184,0.2) ${pct}% 100%)`;
  return (
    <div className="inline-grid place-items-center relative" style={{ width: size, height: size }}>
      <div className="rounded-full shadow-[inset_0_0_0_6px_rgba(15,23,42,.9)]"
           style={{ width: size, height: size, background: bg, transition: "background 600ms ease" }} />
      <div className="absolute text-xs leading-none text-slate-100 font-semibold drop-shadow">
        {Number.isFinite(value) ? value.toFixed(2) : "0.00"}<span className="text-[10px] opacity-70">/10</span>
      </div>
    </div>
  );
};
const SaveButton = ({ saved, onClick }) => (
  <button
    type="button"
    onClick={saved ? undefined : onClick}
    disabled={!!saved}
    className={cx(
      "px-3 py-2 rounded text-xs font-medium inline-flex items-center gap-1 transition",
      saved ? "bg-emerald-600/90 text-white cursor-default"
            : "bg-indigo-600 hover:bg-indigo-500 text-white shadow hover:shadow-indigo-500/20"
    )}
    title={saved ? "Saved" : "Save (Ctrl/Cmd+Enter)"}
  >
    <svg className={cx("w-3.5 h-3.5", saved ? "" : "animate-pulse")} viewBox="0 0 20 20" fill="currentColor">
      {saved
        ? <path d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 011.414-1.414l2.543 2.543 6.543-6.543a1 1 0 011.414 0z" />
        : <path d="M10 2a1 1 0 011 1v7h7a1 1 0 110 2h-7v7a1 1 0 11-2 0v-7H2a1 1 0 110-2h7V3a1 1 0 011-1z" />}
    </svg>
    {saved ? "Saved" : "Save"}
  </button>
);
const StatBox = ({ label, value, title }) => (
  <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-right shadow-sm min-w-[112px]"
       title={title} aria-label={title || label}>
    <div className="text-[11px] leading-none text-slate-400 mb-1">{label}</div>
    <div className="font-semibold">{value}</div>
  </div>
);

/* Collapsible (kept for detailed cards) */
function CollapsibleSection({ title, subtitle, right, children, storageKey = "", defaultOpen = true }) {
  const [open, setOpen] = useLocalStorageState(storageKey || `pp:sec:${title}`, defaultOpen);
  return (
    <section className="rounded-2xl border border-slate-900/80 bg-slate-900/60 shadow-xl overflow-hidden ring-1 ring-inset ring-white/5">
      <div className="px-6 py-4 flex items-center justify-between bg-gradient-to-r from-slate-900 via-slate-900/80 to-slate-900/60"
           style={{ backgroundImage:
             "radial-gradient(1200px 200px at 20% -20%, rgba(56,189,248,.06), transparent 60%), radial-gradient(1200px 200px at 80% 120%, rgba(99,102,241,.06), transparent 60%)" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <button
              className="grid place-items-center w-7 h-7 rounded-md bg-slate-800/70 border border-slate-700 hover:bg-slate-800 transition"
              onClick={() => setOpen(!open)} title={open ? "Collapse" : "Expand"}>
              <svg className={cx("w-4 h-4 text-slate-200 transition-transform", open ? "rotate-90" : "")}
                   viewBox="0 0 20 20" fill="currentColor">
                <path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707A1 1 0 018.707 5.293l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
              </svg>
            </button>
            <h2 className="text-xl font-bold">{title}</h2>
          </div>
          {subtitle ? <p className="text-sm text-slate-400 mt-1">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">{right}</div>
      </div>
      <div className="transition-[grid-template-rows] duration-300 grid">
        <div className={cx("overflow-hidden transition-all", open ? "max-h-[100000px] opacity-100" : "max-h-0 opacity-0","px-6 py-6")}>
          {children}
        </div>
      </div>
    </section>
  );
}

/* Charts (AxisChart) — unchanged */
function niceTicks(min, max, count = 6) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (min === max) { min -= 0.5; max += 0.5; }
  const span = max - min;
  const step0 = span / Math.max(1, count - 1);
  const pow10 = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / pow10;
  let step;
  if (err >= 7.5) step = 10 * pow10;
  else if (err >= 3.5) step = 5 * pow10;
  else if (err >= 1.5) step = 2 * pow10;
  else step = 1 * pow10;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + 1e-9; v += step) ticks.push(Number(v.toFixed(2)));
  return { ticks, niceMin, niceMax };
}
function AxisChart({ labels, series, unit = "", height = 190 }) {
  const W = 640, H = height;
  const pad = { top: 16, right: 12, bottom: 28, left: 56 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;

  const allVals = series.flatMap((s) => (s.data || []).filter((v) => v != null && isFinite(v)));
  let min = Math.min(...allVals), max = Math.max(...allVals);
  if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
  if (min === max) { min -= 0.5; max += 0.5; }
  const { ticks, niceMin, niceMax } = niceTicks(min, max, 6);

  const x = (i) => pad.left + (labels.length <= 1 ? 0 : (iw * i) / (labels.length - 1));
  const y = (v) => pad.top + ih - ((v - niceMin) / (niceMax - niceMin)) * ih;

  const buildPath = (arr) => {
    let d = "", pen = false;
    arr.forEach((v, i) => {
      if (v == null || !isFinite(v)) { pen = false; return; }
      const X = x(i), Y = y(v);
      d += `${pen ? " L " : " M "}${X.toFixed(2)} ${Y.toFixed(2)}`;
      pen = true;
    });
    return d.trim();
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
        {ticks.map((tv, idx) => {
          const Y = y(tv);
          return (
            <g key={`gy:${idx}`}>
              <line x1={pad.left} y1={Y} x2={W - pad.right} y2={Y} stroke="#334155" strokeWidth="1" opacity="0.5" />
              <text x={pad.left - 8} y={Y} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#94a3b8">
                {tv.toFixed(2)}{unit}
              </text>
            </g>
          );
        })}
        <line x1={pad.left} y1={pad.top + ih} x2={W - pad.right} y2={pad.top + ih} stroke="#475569" strokeWidth="1" />
        {labels.map((lb, i) => (
          <text key={`xl:${i}`} x={x(i)} y={pad.top + ih + 16} textAnchor="middle" fontSize="11" fill="#94a3b8">
            {lb}
          </text>
        ))}
        {series.map((s, i) => (
          <g key={`s:${i}`}>
            <path d={buildPath(s.data || [])} fill="none" stroke={s.color} strokeWidth="2.5" />
            {(s.data || []).map((v, idx) =>
              (v == null || !isFinite(v)) ? null : (
                <circle key={`pt:${i}:${idx}`} cx={x(idx)} cy={y(v)} r="3.5" fill={s.color} stroke="#0f172a" strokeWidth="1" />
              )
            )}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex items-center gap-4 text-xs text-slate-300">
        {series.map((s, i) => (
          <div key={`lg:${i}`} className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded" style={{ background: s.color }} />
            <span>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Inline editor for organizer reference values (unchanged) */
function RoundRefsInlineEditor({ total, curTemps = [], curHums = [], onSave }) {
  const [open, setOpen] = useState(false);
  const [temps, setTemps] = useState(() => Array.from({ length: total }, (_, i) => curTemps[i] ?? ""));
  const [hums, setHums] = useState(() => Array.from({ length: total }, (_, i) => curHums[i] ?? ""));

  useEffect(() => {
    setTemps(Array.from({ length: total }, (_, i) => curTemps[i] ?? ""));
    setHums(Array.from({ length: total }, (_, i) => curHums[i] ?? ""));
  }, [total, curTemps, curHums]);

  const normalize = (arr) =>
    Array.from({ length: total }, (_, i) => {
      const v = Number(String(arr[i]).replace(",", "."));
      return Number.isFinite(v) ? Number(v.toFixed(2)) : null;
    });

  if (!open) {
    return (
      <button
        className="text-[11px] px-2 py-1 rounded border border-violet-400/60 text-violet-200 hover:bg-violet-500/10"
        onClick={() => setOpen(true)}
      >
        Set refs (organizer)
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-violet-700/40 bg-violet-950/20 p-3 mb-3">
      <div className="text-sm font-medium text-violet-200 mb-2">Organizer reference values</div>
      <div className="overflow-auto">
        <table className="min-w-[560px] w-full text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-slate-300">Checkpoint</th>
              {Array.from({ length: total }, (_, i) => (
                <th key={`h:${i}`} className="px-2 py-1 text-center text-slate-300">P{i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-2 py-1 text-slate-300">Temp (°C)</td>
              {Array.from({ length: total }, (_, i) => (
                <td key={`t:${i}`} className="px-2 py-1">
                  <input
                    type="number" step="0.01" value={temps[i] ?? ""}
                    onChange={(e) => setTemps((arr) => { const copy = [...arr]; copy[i] = e.target.value; return copy; })}
                    className="w-24 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm outline-none focus:border-violet-400"
                  />
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-1 text-slate-300">Humidity (%)</td>
              {Array.from({ length: total }, (_, i) => (
                <td key={`h2:${i}`} className="px-2 py-1">
                  <input
                    type="number" step="0.01" value={hums[i] ?? ""}
                    onChange={(e) => setHums((arr) => { const copy = [...arr]; copy[i] = e.target.value; return copy; })}
                    className="w-24 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm outline-none focus:border-violet-400"
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          className="px-3 py-1 rounded border border-violet-400/60 text-violet-200 hover:bg-violet-500/10 text-[12px]"
          onClick={() => { setTemps(Array.from({ length: total }, () => "")); setHums(Array.from({ length: total }, () => "")); }}
        >
          Clear
        </button>
        <button
          className="px-3 py-1 rounded border border-emerald-400/60 text-emerald-200 hover:bg-emerald-500/10 text-[12px]"
          onClick={() => { onSave(normalize(temps), normalize(hums)); setOpen(false); }}
        >
          Save refs
        </button>
        <button
          className="px-3 py-1 rounded border border-slate-600 text-slate-200 hover:bg-slate-800/60 text-[12px]"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>
    </div>
  );
}

/* ScoreWithNote, LockTimerControl — unchanged */
const ScoreWithNote = memo(function ScoreWithNote({
  title = "Score & Justification",
  weightPct,
  valueFromStore,
  noteFromStore,
  onChangeValue,
  onChangeNote,
  onSave,
  saved,
}) {
  const [localV, setLocalV] = useState(
    valueFromStore === 0 || valueFromStore === "0" ? "0" : String(valueFromStore ?? "")
  );
  const [localN, setLocalN] = useState(cleanStr(noteFromStore));

  useEffect(() => {
    const nextV = valueFromStore === 0 || valueFromStore === "0" ? "0" : String(valueFromStore ?? "");
    if (localV !== nextV) setLocalV(nextV);
  }, [valueFromStore]); // eslint-disable-line
  useEffect(() => {
    const nextN = cleanStr(noteFromStore);
    if (localN !== nextN) setLocalN(nextN);
  }, [noteFromStore]); // eslint-disable-line

  const taRef = useAutoGrow(localN);
  const baseInput =
    "px-3 py-2 bg-slate-800/80 border border-slate-700 rounded-md text-white focus:outline-none focus:border-indigo-400 transition-shadow focus:shadow-[0_0_0_2px_rgba(99,102,241,.25)]";

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 p-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[12px] uppercase tracking-wide text-slate-400">Field</div>
          <div className="flex items-center gap-2">
            <span className="text-slate-200 font-medium truncate">{title}</span>
            {Number(weightPct) > 0 && <span className="text-[11px] text-slate-400">({Number(weightPct)}%)</span>}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="w-[112px]">
            <div className="text-[11px] text-slate-400 mb-1">Grade</div>
            <input
              type="text" inputMode="decimal" className={cx(baseInput, "text-right w-full")}
              value={localV} placeholder="0–10"
              onChange={(e) => { setLocalV(e.target.value); onChangeValue?.(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave?.(); e.stopPropagation(); }}
            />
          </div>
          <div><SaveButton saved={saved} onClick={onSave} /></div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[11px] text-slate-400 mb-1">Justification</div>
        <textarea
          ref={taRef} rows={3} className={cx(baseInput, "leading-6 resize-none min-h-[88px] w-full")}
          value={localN} placeholder="Justification — de ce ai acordat nota…"
          onChange={(e) => { setLocalN(e.target.value); onChangeNote?.(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave?.(); } e.stopPropagation(); }}
        />
      </div>
    </div>
  );
});

function LockTimerControl({ scan, onReopen }) {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id); }, []);
  if (!scan) return null;
  const created = Number(scan.createdAtMs || 0);
  const leftSec = Math.max(0, Math.ceil((created + GRACE_MS - nowMs) / 1000));
  const windowActive = leftSec > 0 && scan.locked !== true;

  if (windowActive) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[11px] px-2 py-0.5 rounded border border-emerald-400 text-emerald-300">Unlocked</span>
        <span className="text-[11px] px-2 py-0.5 rounded border border-indigo-400 text-indigo-300">⏳ {leftSec}s</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] px-2 py-0.5 rounded border border-amber-400 text-amber-300">Locked</span>
      <button onClick={onReopen} className="text-[11px] px-2 py-0.5 rounded border border-indigo-400 text-indigo-300">
        Re-open 60s
      </button>
    </div>
  );
}

/*  MAIN  */
export default function ProfessorPanel() {
  const navigate = useNavigate();
  theScrollRestorationShim();

  // RTDB live
  const [sensorData, setSensorData] = useState({});
  // Firestore data
  const [teams, setTeams] = useState([]);
  const [manualProbes, setManualProbes] = useState([]);
  const [missionWeight, setMissionWeight] = useState(20);
  const [mpColumns, setMpColumns] = useState([]);

  const [rounds, setRounds] = useState([]);
  const [roundConfigs, setRoundConfigs] = useState({});
  const [checkpoints, setCheckpoints] = useState([]);
  const [scans, setScans] = useState([]);

  const [roundRefs, setRoundRefs] = useState({}); // { [roundId]: { temp:number[], humidity:number[] } }
  const [roundTargets, setRoundTargets] = useState({}); // { [roundId]: { targetTemp, targetHumidity } }

  const [fullName, setFullName] = useState("Professor");

  // local edit buffers
  const [editedValues, setEditedValues] = useState({});
  const [editedNotes, setEditedNotes] = useState({});

  const dirty = useMemo(
    () => Object.keys(editedValues).length > 0 || Object.keys(editedNotes).length > 0,
    [editedValues, editedNotes]
  );

  // Compare + heatmap
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);

  // Tabs
  const [tab, setTab] = useLocalStorageState("pp:tab", "dashboard");
  const [detailTeamId, setDetailTeamId] = useLocalStorageState("pp:teamId", "");
  const [teamTab, setTeamTab] = useLocalStorageState("pp:teamTab", "topics");
  const [selectedRoundId, setSelectedRoundId] = useLocalStorageState("pp:selectedRound", "");

  /*  RTDB  */
  useEffect(() => {
    const dataRef = dbRef(rtdbInstance, "readings");
    const unsubscribe = onValue(dataRef, (snapshot) => setSensorData(snapshot.val() || {}));
    return () => unsubscribe();
  }, []);

  /* Firestore: teams live + MP doc live  */
  useEffect(() => {
    const unsubTeams = onSnapshot(collection(db, "teams"), (snap) => {
      setTeams(
        snap.docs.map((d) => {
          const data = d.data() || {};
          return {
            id: d.id,
            name: data.name || d.id,
            scores: data.scores || {},
            scoresNotes: data.scoresNotes || {},
            scoresMeta: data.scoresMeta || {},
          };
        })
      );
    });

    // MP global din Manage Topics (probes/Mission Performance)
    const unsubMP = onSnapshot(doc(db, "probes", MP_ID), (snap) => {
      const data = snap.data() || {};
      const w = Number(data.weight);
      if (Number.isFinite(w)) setMissionWeight(w);
      setMpColumns(normalizeColumns(data.columns));
    });

    (async () => {
      const user = getAuth().currentUser || authInstance.currentUser;
      if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const data = userDoc.data();
        if (data?.firstName) setFullName(`${data.firstName} ${data.lastName ?? ""}`);
      }
    })();

    return () => {
      unsubTeams();
      unsubMP();
    };
  }, []);

  /*  Firestore: static  */
  useEffect(() => {
    (async () => {
      const [probesSnap, roundsSnap, cpsSnap] = await Promise.all([
        getDocs(collection(db, "probes")),
        getDocs(collection(db, "rounds")),
        getDocs(collection(db, "checkpoints")),
      ]);

      const list = [];
      probesSnap.docs.forEach((d) => {
        const id = d.id;
        if (id === MP_ID) return;
        const dat = d.data() || {};
        list.push({
          id,
          weight: Number(dat.weight ?? 0) || 0,
          columns: Array.isArray(dat.columns) ? dat.columns : [],
        });
      });
      list.sort((a, b) => a.id.localeCompare(b.id));
      setManualProbes(list);

      const roundsData = roundsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRounds(roundsData.map((r) => r.id));
      const cfg = {};
      const targets = {};
      roundsData.forEach((r) => {
        const t = r.totalCheckpoints ?? r.checkpoints?.totalCheckpoints ?? 0;
        cfg[r.id] = Number(t) || 0;

        const tt = Number(r.targetTemp);
        const hh = Number(r.targetHumidity);
        targets[r.id] = {
          targetTemp: Number.isFinite(tt) ? tt : null,
          targetHumidity: Number.isFinite(hh) ? hh : null,
        };
      });
      setRoundConfigs(cfg);
      setRoundTargets(targets);

      const refs = {};
      roundsData.forEach((r) => {
        refs[r.id] = {
          temp: Array.isArray(r.refTemps) ? r.refTemps.map((n) => Number(n)) : [],
          humidity: Array.isArray(r.refHumidity) ? r.refHumidity.map((n) => Number(n)) : [],
        };
      });
      setRoundRefs(refs);

      const cps = cpsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCheckpoints(cps);
    })();
  }, []);

  /*  Firestore: scans live  */
  useEffect(() => {
    const sinceMs = Date.now() - 12 * 60 * 60 * 1000; // ultimele 12h
    const qScans = query(
      collection(db, "scans"),
      where("createdAtMs", ">=", sinceMs),
      orderBy("createdAtMs", "desc"),
      limit(5000)
    );

    const unsubScans = onSnapshot(qScans, (snap) => {
      const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const byKey = new Map();
      for (const s of raw) {
        if (!s.teamId || !s.roundId || !s.cpId) continue;
        const key = scanKey(s.teamId, s.roundId, s.cpId);
        const prev = byKey.get(key);
        const prefer =
          s.id === key ||
          ((s.timestamp?.seconds || 0) > (prev?.timestamp?.seconds || 0)) ||
          ((s.createdAtMs || 0) > (prev?.createdAtMs || 0));
        if (!prev || prefer) byKey.set(key, { ...s, id: key });
      }
      setScans([...byKey.values()]);
    });

    return () => unsubScans();
  }, []);

  const handleLogout = () => {
    const a = getAuth();
    a.signOut().then(() => (window.location.href = "/"));
  };

  /*  indices  */
  const cpOrderIndex = useMemo(() => {
    const idx = {};
    for (const cp of checkpoints) {
      if ((cp.isActive ?? true) && cp.roundId && cp.order != null) {
        idx[`${cp.roundId}:${cp.id}`] = Number(cp.order);
      }
    }
    return idx;
  }, [checkpoints]);

  const orderToCpIdByRound = useMemo(() => {
    const map = {};
    for (const cp of checkpoints) {
      if (!(cp.isActive ?? true)) continue;
      if (!map[cp.roundId]) map[cp.roundId] = {};
      map[cp.roundId][Number(cp.order)] = cp.id;
    }
    return map;
  }, [checkpoints]);

  /*  unlock 60s  */
  const unlock60s = async (teamId, roundId, order) => {
    const cpId =
      orderToCpIdByRound?.[roundId]?.[order] ??
      checkpoints.find((c) => (c.isActive ?? true) && c.roundId === roundId && Number(c.order) === Number(order))?.id;

    if (!cpId) { alert(`Nu găsesc checkpoint activ pentru ${roundId} P${order}.`); return; }
    const id = scanKey(teamId, roundId, cpId);
    const now = Date.now();
    await setDoc(
      doc(db, "scans", id),
      { teamId, roundId, cpId, locked: false, createdAtMs: now, updatedAtMs: now, timestamp: new Date() },
      { merge: true }
    );
  };

  /*  local edit buffers  */
  const setEditedVal = useCallback((teamId, probeId, raw, colKey) => {
    setEditedValues((prev) => {
      const team = prev[teamId] ? { ...prev[teamId] } : {};
      if (colKey) {
        const base = team[probeId] && typeof team[probeId] === "object" ? { ...team[probeId] } : {};
        base[colKey] = raw;
        team[probeId] = base;
      } else { team[probeId] = raw; }
      return { ...prev, [teamId]: team };
    });
  }, []);
  const setEditedNote = useCallback((teamId, probeId, text, colKey) => {
    setEditedNotes((prev) => {
      const team = prev[teamId] ? { ...prev[teamId] } : {};
      if (colKey) {
        const base = team[probeId] && typeof team[probeId] === "object" ? { ...team[probeId] } : {};
        base[colKey] = text;
        team[probeId] = base;
      } else { team[probeId] = text; }
      return { ...prev, [teamId]: team };
    });
  }, []);

  /*  getters  */
  const getInput = (team, probeId, colKey) => {
    const tid = team.id;
    const ed = editedValues?.[tid]?.[probeId];
    const st = team?.scores?.[probeId];

    if (colKey) {
      if (ed && typeof ed === "object" && ed[colKey] !== undefined) return String(ed[colKey]);
      if (st && typeof st === "object" && st[colKey] !== undefined) return String(st[colKey]);
      return "";
    } else {
      if (ed !== undefined && typeof ed !== "object") return String(ed);
      if (st && typeof st !== "object" && st !== undefined) return String(st);
      return "";
    }
  };
  const getNote = (team, probeId, colKey) => {
    const tid = team.id;
    const ed = editedNotes?.[tid]?.[probeId];
    const st = team?.scoresNotes?.[probeId];

    if (colKey) {
      if (ed && typeof ed === "object" && ed[colKey] !== undefined) return String(ed[colKey]);
      if (st?.cols && st.cols[colKey] !== undefined) return String(st.cols[colKey]);
      return "";
    } else {
      if (ed !== undefined && typeof ed !== "object") return String(ed);
      if (st?.text !== undefined) return String(st.text);
      return "";
    }
  };

  /*  probe scoring  */
  const weightedAvg = (cols, ed, st) => {
    const hasWeights = cols.some((c) => Number(c.weight) > 0);
    if (!hasWeights) {
      const vals = cols.map((c) => {
        const v = ed?.[c.key] ?? st?.[c.key];
        return toNum(v);
      });
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    const totalW = cols.reduce((a, c) => a + (Number(c.weight) || 0), 0) || 1;
    const sum = cols.reduce((acc, c) => {
      const v = ed?.[c.key] ?? st?.[c.key];
      const w = (Number(c.weight) || 0) / totalW;
      return acc + toNum(v) * w;
    }, 0);
    return sum;
  };

  const liveScore = (team, probeDef) => {
    const tid = team.id;
    const ed = editedValues?.[tid]?.[probeDef.id];
    const st = team.scores?.[probeDef.id];

    if (Array.isArray(probeDef.columns) && probeDef.columns.length > 0) {
      return weightedAvg(probeDef.columns, ed, st);
    } else {
      if (ed !== undefined && typeof ed !== "object") return toNum(ed);
      return toNum(st);
    }
  };

  /*  weights  */
  const totals = useMemo(() => {
    const totalManual = manualProbes.reduce((a, p) => a + Number(p.weight || 0), 0);
    const totalW = (Number(missionWeight) || 0) + totalManual;
    return { totalManual, totalW };
  }, [manualProbes, missionWeight]);

  /*  per-team rounds UI  */
  const buildRoundsUiForTeam = useCallback(
    (teamId) => {
      const perRound = {};
      for (const roundId of rounds) {
        const total = Number(roundConfigs[roundId] ?? 0) || 0;
        const teamRoundScans = scans.filter((s) => s.teamId === teamId && s.roundId === roundId);
        const reachedOrders = new Set();
        const scanByOrder = new Map();
        for (const s of teamRoundScans) {
          const order = cpOrderIndex[`${roundId}:${s.cpId}`];
          if (Number.isFinite(order)) {
            reachedOrders.add(order);
            const prev = scanByOrder.get(order);
            if (!prev || (s.timestamp?.seconds || 0) > (prev?.timestamp?.seconds || 0)) {
              scanByOrder.set(order, s);
            }
          }
        }
        const hitsCount = Array.from(reachedOrders).filter((ord) => ord >= 1 && ord <= total).length;
        const progress = total ? hitsCount / total : 0;
        perRound[roundId] = { total, hitsCount, progress, reachedOrders, scanByOrder };
      }
      return perRound;
    },
    [rounds, roundConfigs, scans, cpOrderIndex]
  );

  /*  round metrics for Benchmarks (with per-QR times)  */
  const roundMetrics = useMemo(() => {
    const out = {};
    for (const roundId of rounds) {
      const total = Number(roundConfigs[roundId] ?? 0) || 0;
      const targ = roundTargets?.[roundId] || {};
      const refsT = roundRefs?.[roundId]?.temp || [];
      const refsH = roundRefs?.[roundId]?.humidity || [];

      let minFinish = Infinity, maxFinish = -Infinity;
      const byTeam = {};

      for (const team of teams) {
        const teamId = team.id;
        const teamRound = scans.filter((s) => s.teamId === teamId && s.roundId === roundId);

        const reached = new Set();
        const tempByOrder  = Array.from({ length: total }, () => null);
        const humByOrder   = Array.from({ length: total }, () => null);
        const timesByOrder = Array.from({ length: total }, () => null); // NEW: ora fiecărui scan (ms)

        let lastMs = 0;

        for (const s of teamRound) {
          const ord = cpOrderIndex[`${roundId}:${s.cpId}`];
          if (!Number.isFinite(ord)) continue;
          reached.add(ord);
          const idx = ord - 1;

          const t = Number.isFinite(Number(s.temp)) ? Number(s.temp) : null;
          const h = Number.isFinite(Number(s.humidity)) ? Number(s.humidity) : null;
          if (t != null) tempByOrder[idx] = t;
          if (h != null) humByOrder[idx] = h;

          const tms = s.createdAtMs || (s.timestamp?.seconds || 0) * 1000;

          // păstrăm primul (cel mai timpuriu) scan pentru fiecare punct
          if (tms && (!timesByOrder[idx] || tms < timesByOrder[idx])) {
            timesByOrder[idx] = tms;
          }

          if (tms > lastMs) lastMs = tms; // finalizare rundă = ultimul scan
        }

        const finished =
          total > 0 && Array.from({ length: total }, (_, i) => i + 1).every((k) => reached.has(k));

        const validTemps = tempByOrder.filter((v) => Number.isFinite(v));
        const validHums  = humByOrder.filter((v) => Number.isFinite(v));
        const avgTemp = validTemps.length ? validTemps.reduce((a, b) => a + b, 0) / validTemps.length : null;
        const avgHum  = validHums.length  ? validHums.reduce((a, b) => a + b, 0) / validHums.length  : null;

        let sumAbsT = 0, nT = 0;
        let sumAbsH = 0, nH = 0;

        for (let i = 0; i < total; i++) {
          const rT = refsT[i]; const rH = refsH[i];
          const vT = tempByOrder[i]; const vH = humByOrder[i];
          if (Number.isFinite(rT) && Number.isFinite(vT)) { sumAbsT += Math.abs(vT - rT); nT += 1; }
          if (Number.isFinite(rH) && Number.isFinite(vH)) { sumAbsH += Math.abs(vH - rH); nH += 1; }
        }

        let maeTemp = null, maeHum = null;
        if (nT > 0) maeTemp = sumAbsT / nT;
        else if (avgTemp != null && targ?.targetTemp != null) { maeTemp = Math.abs(avgTemp - Number(targ.targetTemp)); nT = 1; }

        if (nH > 0) maeHum = sumAbsH / nH;
        else if (avgHum != null && targ?.targetHumidity != null) { maeHum = Math.abs(avgHum - Number(targ.targetHumidity)); nH = 1; }

        byTeam[teamId] = {
          finished,
          finishTimeMs: finished ? lastMs : null,
          timesMs: timesByOrder,          // NEW: orele scanărilor P1…Pn (ms)
          avgTemp, avgHum,
          maeTemp, maeTempN: nT,
          maeHum,  maeHumN:  nH,
        };

        if (finished) {
          if (lastMs < minFinish) minFinish = lastMs;
          if (lastMs > maxFinish) maxFinish = lastMs;
        }
      }

      out[roundId] = {
        total,
        targetTemp: targ?.targetTemp ?? null,
        targetHumidity: targ?.targetHumidity ?? null,
        byTeam,
        minFinish: Number.isFinite(minFinish) ? minFinish : null,
        maxFinish: Number.isFinite(maxFinish) ? maxFinish : null,
      };
    }
    return out;
  }, [rounds, roundConfigs, roundTargets, roundRefs, scans, teams, cpOrderIndex]);
  /*  MP helper keys */
  const mpKey = (roundId, fieldKey) => `MP:${roundId}:${fieldKey}`;

  /*  MP round score (respectă ponderile când există)  */
  function roundScoreForTeam(roundId, teamId) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) return 0;
    const fields = mpColumns || [];
    if (!fields.length) return 0;

    const hasWeights = fields.some((f) => Number(f.weight) > 0);
    if (!hasWeights) {
      let sum = 0;
      for (const f of fields) {
        const raw = getInput(team, mpKey(roundId, f.key));
        let n = parseFloat(String(raw ?? "").replace(",", "."));
        if (Number.isNaN(n)) n = 0;
        n = Math.max(0, Math.min(10, n));
        sum += n;
      }
      return sum / fields.length;
    }

    const totalW = fields.reduce((a, f) => a + (Number(f.weight) || 0), 0) || 1;
    return fields.reduce((acc, f) => {
      const raw = getInput(team, mpKey(roundId, f.key));
      let n = parseFloat(String(raw ?? "").replace(",", "."));
      if (Number.isNaN(n)) n = 0;
      n = Math.max(0, Math.min(10, n));
      return acc + n * ((Number(f.weight) || 0) / totalW);
    }, 0);
  }

  /*
   * MP TOTAL:
   *  - media pe fiecare rundă (folosind roundScoreForTeam)
   *  - apoi media aritmetică peste TOATE rundele definite (runde fără note = 0)
   */
  function missionScoreAvgForTeam(teamId) {
    const fields = mpColumns || [];
    if (!fields.length) return 0;

    const perRound = rounds.map((rid) => {
      const v = roundScoreForTeam(rid, teamId);
      return Number.isFinite(v) ? v : 0;
    });
    if (!perRound.length) return 0;
    return perRound.reduce((a, b) => a + b, 0) / perRound.length;
  }

  /*  final grade per team  */
  const finalGradeForTeam = (team, roundsUi) => {
    const avgMission = missionScoreAvgForTeam(team.id);
    const rows = manualProbes.map((p, i) => {
      const val = liveScore(team, p);
      return {
        index: i + 1,
        probe: p.id,
        weight: Number(p.weight || 0),
        score: isFinite(val) ? val : 0,
        columns: Array.isArray(p.columns) ? p.columns : [],
        weighted: (isFinite(val) ? val : 0) * (Number(p.weight || 0) / 100),
      };
    });
    const manualSubtotal = rows.reduce((acc, r) => acc + r.weighted, 0);
    const mpWeighted = (avgMission * Number(missionWeight)) / 100;

    if (totals.totalW !== 100) return { avgMission, rows, manualSubtotal, mpWeighted, final: null };
    return { avgMission, rows, manualSubtotal, mpWeighted, final: manualSubtotal + mpWeighted };
  };

  /*  ranking  */
  const ranking = useMemo(() => {
    const items = teams.map((t) => {
      const rUi = buildRoundsUiForTeam(t.id);
      const br = finalGradeForTeam(t, rUi);
      const final = br.final == null ? 0 : Number(br.final);
      return { teamId: t.id, name: t.name || t.id, final };
    });
    items.sort((a, b) => b.final - a.final);
    let last = null; let r = 0;
    return items.map((it, i) => {
      if (last === null || it.final !== last) { r = i + 1; last = it.final; }
      return { ...it, rank: r };
    });
  }, [teams, buildRoundsUiForTeam, missionWeight, manualProbes, totals.totalW]);

  /*  teams summary (for cards)  */
  const teamsSummary = useMemo(() => {
    const rankMap = new Map(ranking.map((r) => [r.teamId, r]));
    return teams.map((t) => {
      const rUi = buildRoundsUiForTeam(t.id);
      const br = finalGradeForTeam(t, rUi);
      const totalsAcrossRounds = Object.values(rUi).reduce(
        (acc, r) => { acc.hits += r.hitsCount || 0; acc.total += r.total || 0; return acc; },
        { hits: 0, total: 0 }
      );
      const progress = totalsAcrossRounds.total ? totalsAcrossRounds.hits / totalsAcrossRounds.total : 0;
      return {
        id: t.id,
        name: t.name || t.id,
        rank: rankMap.get(t.id)?.rank ?? "-",
        final: rankMap.get(t.id)?.final ?? 0,
        manualSubtotal: br.manualSubtotal,
        avgMission: br.avgMission,
        mpProgress: progress,
        totalsAcrossRounds,
      };
    });
  }, [teams, ranking, buildRoundsUiForTeam]);

  /*  Export helpers  */
  const csvEsc = (val) => {
    if (val == null) return "";
    const s = String(val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  // Live (summary) CSV — one row per team with real-time grades
  const exportLiveCsv = useCallback(() => {
    const tsIso = new Date().toISOString();

    const meta = [
      ["Export", "Live grades (summary)"],
      ["Generated at", tsIso],
      [
        "Weights",
        `MP ${missionWeight}%`,
        `Topics ${totals.totalManual}%`,
        "Total",
        `${missionWeight + totals.totalManual}%`,
      ],
      ["Note", "Values are live (include unsaved edits). MP total is mean of per-round scores (zeros included)."],
      [],
    ];

    const header = [
      "Rank",
      "Team",
      "Final",
      "Topics subtotal",
      "MP avg (prof, per-round mean)",
      "MP weighted",
      "MP weight (%)",
      ...manualProbes.map((p) => `${p.id} (topic)`),
      ...rounds.map((r) => `MP round ${r} (prof)`),
    ];

    const rankMap = new Map(ranking.map((r) => [r.teamId, r]));
    const teamsByRank = [...teams].sort((a, b) => {
      const ra = rankMap.get(a.id)?.rank ?? 9999;
      const rb = rankMap.get(b.id)?.rank ?? 9999;
      return ra - rb;
    });

    const rows = [];
    for (const team of teamsByRank) {
      const rUi = buildRoundsUiForTeam(team.id);
      const br = finalGradeForTeam(team, rUi);

      const base = [
        rankMap.get(team.id)?.rank ?? "",
        team.name || team.id,
        br.final == null ? "" : br.final.toFixed(2),
        br.manualSubtotal.toFixed(2),
        br.avgMission.toFixed(2),
        br.mpWeighted.toFixed(2),
        missionWeight,
      ];

      const topicVals = manualProbes.map((p) => {
        const v = liveScore(team, p);
        return Number.isFinite(v) ? v.toFixed(2) : "0.00";
      });

      const roundVals = rounds.map((rid) => {
        const v = roundScoreForTeam(rid, team.id) || 0;
        return v.toFixed(2);
      });

      rows.push([...base, ...topicVals, ...roundVals]);
    }

    const csvArray = [...meta, header, ...rows];
    const csv = csvArray
      .map((line) => (line.length ? line.map(csvEsc).join(",") : ""))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `live-grades-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Live grades CSV salvat");
  }, [
    teams,
    rounds,
    manualProbes,
    missionWeight,
    totals.totalManual,
    ranking,
    buildRoundsUiForTeam,
    finalGradeForTeam,
  ]);

  const exportRankingCsv = useCallback(() => {
    const header = ["Rank", "Team", "FinalGrade"];
    const rows = ranking.map((r) => [r.rank, r.name, r.final.toFixed(2)]);
    const csv = [header, ...rows].map((line) => line.map(csvEsc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url; a.download = `ranking-${ts}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Ranking exportat ca CSV");
  }, [ranking]);

  const exportFullCsv = useCallback(() => {
    const tsIso = new Date().toISOString();
    const meta = [
      ["Export", "Full – vertical (profesional)"],
      ["Generat la", tsIso],
      [
        "Ponderi",
        `MP ${missionWeight}%`,
        `Probe ${totals.totalManual}%`,
        "Total",
        `${missionWeight + totals.totalManual}%`,
      ],
      ["Mission Performance", "MP total = media aritmetică a mediilor pe rundă; rundele fără note contează cu 0."],
      [],
    ];

    const header = [
      "Rank","Echipă","Secțiune","Proba / Runda","Criteriu","Pondere (%)","Scor","Notă","Lovituri (Hits/Total)","Ponderat","Subtotal Manual","MP (Medie)","MP (Ponderat)","Finală",
    ];

    const rankMap = new Map(ranking.map((r) => [r.teamId, { rank: r.rank, final: r.final }]));
    const teamsByRank = [...teams].sort((a, b) => {
      const ra = rankMap.get(a.id)?.rank ?? 9999;
      const rb = rankMap.get(b.id)?.rank ?? 9999;
      return ra - rb;
    });

    const rows = [];
    for (const team of teamsByRank) {
      const teamName = team.name || team.id;
      const roundsUi = buildRoundsUiForTeam(team.id);
      const breakdown = finalGradeForTeam(team, roundsUi);
      const rankInfo = rankMap.get(team.id) || { rank: "", final: 0 };

      for (const p of manualProbes) {
        const cols = Array.isArray(p.columns) ? p.columns : [];
        if (cols.length > 0) {
          for (const c of cols) {
            const score = toNum(getInput(team, p.id, c.key));
            const note = getNote(team, p.id, c.key);
            rows.push([
              rankInfo.rank, teamName, "Probe", p.id, c.label, p.weight, score.toFixed(2), note, "", "",
              breakdown.manualSubtotal.toFixed(2), breakdown.avgMission.toFixed(2), breakdown.mpWeighted.toFixed(2), (breakdown.final ?? 0).toFixed(2)
            ]);
          }
          const avg = liveScore(team, p);
          const weighted = avg * (Number(p.weight || 0) / 100);
          rows.push([
            rankInfo.rank, teamName, "Rezumat probă", p.id, "AVG", p.weight, avg.toFixed(2), "", "", weighted.toFixed(2),
            breakdown.manualSubtotal.toFixed(2), breakdown.avgMission.toFixed(2), breakdown.mpWeighted.toFixed(2), (breakdown.final ?? 0).toFixed(2)
          ]);
        } else {
          const score = toNum(getInput(team, p.id));
          const note = getNote(team, p.id);
          const weighted = score * (Number(p.weight || 0) / 100);
          rows.push([
            rankInfo.rank, teamName, "Probe", p.id, "—", p.weight, score.toFixed(2), note, "", weighted.toFixed(2),
            breakdown.manualSubtotal.toFixed(2), breakdown.avgMission.toFixed(2), breakdown.mpWeighted.toFixed(2), (breakdown.final ?? 0).toFixed(2)
          ]);
        }
      }

      for (const roundId of rounds) {
        const ui = roundsUi[roundId] || { total: 0, hitsCount: 0, progress: 0 };
        const score010 = roundScoreForTeam(roundId, team.id) || 0;
        const hits = `${ui.hitsCount}/${ui.total}`;
        rows.push([
          rankInfo.rank, teamName, "MP rundă (prof)", roundId, "—", "", score010.toFixed(2), "", hits, "",
          breakdown.manualSubtotal.toFixed(2), breakdown.avgMission.toFixed(2), breakdown.mpWeighted.toFixed(2), (breakdown.final ?? 0).toFixed(2)
        ]);
      }

      rows.push([
        rankInfo.rank, teamName, "MP Rezumat", "Mission Performance", "AVG (prof, per-round mean)", missionWeight,
        breakdown.avgMission.toFixed(2), "", "", breakdown.mpWeighted.toFixed(2),
        breakdown.manualSubtotal.toFixed(2), breakdown.avgMission.toFixed(2), breakdown.mpWeighted.toFixed(2), (rankInfo.final ?? 0).toFixed(2)
      ]);

      rows.push([
        rankInfo.rank, teamName, "TOTAL", "—", "—", "", "", "", "", "",
        breakdown.manualSubtotal.toFixed(2), breakdown.avgMission.toFixed(2), breakdown.mpWeighted.toFixed(2), (rankInfo.final ?? 0).toFixed(2)
      ]);
    }

    const csvArray = [...meta, header, ...rows];
    const csv = csvArray.map((line) => (line.length ? line.map(csvEsc).join(",") : "")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url; a.download = `full-export-${ts}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Full export CSV (profesional) salvat");
  }, [teams, manualProbes, rounds, missionWeight, totals.totalManual, ranking, buildRoundsUiForTeam]);

  const exportRankingPdf = useCallback(() => { window.print(); }, []);

  // one-button export menu state
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);
  useEffect(() => {
    const onDocClick = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setExportOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, []);

  /*  SAVE + audit  */
  const logAudit = useCallback(async (payload) => {
    try {
      const user = getAuth().currentUser || authInstance.currentUser;
      const who = user?.uid || "unknown";
      await addDoc(collection(db, "audits"), { ...payload, uid: who, at: Date.now() });
    } catch (e) { console.warn("audit failed", e); }
  }, []);

  // IMPORTANT: updateDoc + field paths (nu suprascriem alte valori)
  const saveField = useCallback(
    async (teamId, probeId, colKey) => {
      try {
        const team = teams.find((t) => t.id === teamId);
        const teamDocRef = doc(db, "teams", teamId);

        let rawV, rawN, valueToSave, noteToSave, oldV, oldN;

        if (colKey) {
          rawV = editedValues?.[teamId]?.[probeId]?.[colKey] ?? team?.scores?.[probeId]?.[colKey] ?? "";
          rawN = editedNotes?.[teamId]?.[probeId]?.[colKey] ?? team?.scoresNotes?.[probeId]?.cols?.[colKey] ?? "";
          oldV = team?.scores?.[probeId]?.[colKey] ?? "";
          oldN = team?.scoresNotes?.[probeId]?.cols?.[colKey] ?? "";
          valueToSave = toNum(rawV);
          noteToSave = cleanStr(rawN);

          const patch = {
            [`scores.${probeId}.${colKey}`]: valueToSave,
            [`scoresNotes.${probeId}.cols.${colKey}`]: noteToSave,
            [`scoresMeta.${probeId}.cols.${colKey}.lastSavedAt`]: Date.now(),
            [`scoresMeta.${probeId}.cols.${colKey}.hash`]: hashOf(valueToSave, noteToSave),
          };
          await updateDoc(teamDocRef, patch);

          await logAudit({ teamId, probeId, colKey, before: { v: oldV, n: oldN }, after: { v: valueToSave, n: noteToSave } });

          setEditedValues((prev) => {
            const c = { ...prev }, t = c[teamId] ? { ...c[teamId] } : {};
            const obj = t[probeId] && typeof t[probeId] === "object" ? { ...t[probeId] } : {};
            if (obj[colKey] !== undefined) delete obj[colKey];
            t[probeId] = obj; c[teamId] = t; return c;
          });
          setEditedNotes((prev) => {
            const c = { ...prev }, t = c[teamId] ? { ...c[teamId] } : {};
            const obj = t[probeId] && typeof t[probeId] === "object" ? { ...t[probeId] } : {};
            if (obj[colKey] !== undefined) delete obj[colKey];
            t[probeId] = obj; c[teamId] = t; return c;
          });
        } else {
          rawV = editedValues?.[teamId]?.[probeId] ?? team?.scores?.[probeId] ?? "";
          rawN = editedNotes?.[teamId]?.[probeId] ?? team?.scoresNotes?.[probeId]?.text ?? "";
          oldV = team?.scores?.[probeId] ?? "";
          oldN = team?.scoresNotes?.[probeId]?.text ?? "";
          valueToSave = toNum(rawV);
          noteToSave = cleanStr(rawN);

          const patch = {
            [`scores.${probeId}`]: valueToSave,
            [`scoresNotes.${probeId}.text`]: noteToSave,
            [`scoresMeta.${probeId}.lastSavedAt`]: Date.now(),
            [`scoresMeta.${probeId}.hash`]: hashOf(valueToSave, noteToSave),
          };
          await updateDoc(teamDocRef, patch);

          await logAudit({ teamId, probeId, before: { v: oldV, n: oldN }, after: { v: valueToSave, n: noteToSave } });

          setEditedValues((prev) => {
            const c = { ...prev }, t = c[teamId] ? { ...c[teamId] } : {};
            if (typeof t[probeId] !== "object") delete t[probeId];
            c[teamId] = t; return c;
          });
          setEditedNotes((prev) => {
            const c = { ...prev }, t = c[teamId] ? { ...c[teamId] } : {};
            if (typeof t[probeId] !== "object") delete t[probeId];
            c[teamId] = t; return c;
          });
        }

        toast.success("Saved");
      } catch (e) {
        console.error("Save failed", e);
        toast.error("Save failed");
      }
    },
    [editedValues, editedNotes, teams, logAudit]
  );

  /*  save round refs & targets  */
  const saveRoundRefs = useCallback(async (roundId, temps, hums) => {
    const padTo = (arr, n) => Array.from({ length: n }, (_, i) => (arr[i] ?? null));
    const total = Number(roundConfigs[roundId] ?? 0) || 0;
    const refTemps = padTo(temps, total);
    const refHumidity = padTo(hums, total);
    try {
      await setDoc(doc(db, "rounds", roundId), { refTemps, refHumidity }, { merge: true });
      setRoundRefs((prev) => ({ ...prev, [roundId]: { temp: refTemps, humidity: refHumidity } }));
      toast.success(`Refs saved for ${roundId}`);
    } catch (e) { console.error(e); toast.error("Failed to save refs"); }
  }, [roundConfigs]);

  const saveRoundTargets = useCallback(async (roundId, nextTemp, nextHum) => {
    try {
      const tVal = nextTemp === "" ? null : Number(nextTemp);
      const hVal = nextHum === "" ? null : Number(nextHum);
      await setDoc(doc(db, "rounds", roundId), { targetTemp: tVal, targetHumidity: hVal }, { merge: true });
      setRoundTargets((prev) => ({ ...prev, [roundId]: { targetTemp: tVal, targetHumidity: hVal } }));
      toast.success("Targets saved");
    } catch (e) { console.error(e); toast.error("Saving targets failed"); }
  }, []);

  /* UI  */
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <ToastContainer position="top-center" autoClose={1100} />

      {/* HEADER BAR */}
      <header className="sticky top-0 z-30 backdrop-blur border-b border-slate-800 bg-slate-900/70">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <h1 className="text-lg sm:text-xl font-semibold tracking-tight shrink-0">
            Hello, <span className="text-indigo-300">{fullName}</span>
          </h1>

          {/* Primary Tabs */}
          <nav className="ml-4 inline-flex rounded-lg border border-slate-700 overflow-hidden">
            {["dashboard","teams","team","Performance Benchmarks"].map((t) => (
              <button
                key={t}
                className={cx("px-3 py-1.5 text-sm capitalize",
                  tab === t ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60")}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {dirty ? <span className="text-xs text-amber-300">Unsaved changes</span> : null}
            <button onClick={() => navigate("/manage-probes")} className="text-[12px] px-3 py-1 rounded-md border border-slate-600 text-slate-200 hover:bg-slate-800/60">Manage Topics</button>

            {/* Export menu  */}
            <div ref={exportRef} className="relative">
              <button
                onClick={() => setExportOpen((v) => !v)}
                className="text-[12px] px-3 py-1 rounded-md border border-sky-400/50 text-sky-200 hover:bg-sky-500/10"
                aria-haspopup="menu"
                aria-expanded={exportOpen ? "true" : "false"}
                title="Export options"
              >
                Export
                <svg className="inline ml-1 w-3 h-3 opacity-80" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.24 4.5a.75.75 0 01-1.08 0l-4.24-4.5a.75.75 0 01.02-1.06z" />
                </svg>
              </button>

              {exportOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1 w-64 rounded-md border border-slate-700 bg-slate-900/95 shadow-2xl z-40 overflow-hidden"
                >
                  <button
                    role="menuitem"
                    onClick={() => { exportLiveCsv(); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800"
                  >
                    Live grades (CSV) <span className="text-[11px] text-slate-400">— recomandat</span>
                  </button>
                  <div className="h-px bg-slate-800" />
                  <button
                    role="menuitem"
                    onClick={() => { exportRankingCsv(); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800"
                  >
                    Ranking (CSV)
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { exportFullCsv(); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800"
                  >
                    Detailed (legacy) CSV
                  </button>
                  <div className="h-px bg-slate-800" />
                  <button
                    role="menuitem"
                    onClick={() => { exportRankingPdf(); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800"
                  >
                    Print / PDF
                  </button>
                </div>
              )}
            </div>

            <button onClick={handleLogout} className="bg-rose-600 hover:bg-rose-500 px-3 py-1.5 rounded-md text-sm">Logout</button>
          </div>
        </div>
      </header>

      {/* MAIN AREA — one screen per tab */}
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <DashboardTab
            ranking={ranking}
            totals={totals}
            missionWeight={missionWeight}
            teamsSummary={teamsSummary}
            onOpenHeatmap={() => setHeatmapOpen(true)}
            onOpenCompare={() => setCompareOpen(true)}
            selectedTeamIds={selectedTeamIds}
            setSelectedTeamIds={setSelectedTeamIds}
            onOpenTeam={(id) => { setDetailTeamId(id); setTab("team"); }}
          />
        )}

        {/* TEAMS LIST */}
        {tab === "teams" && (
          <TeamsTab
            teamsSummary={teamsSummary}
            selectedTeamIds={selectedTeamIds}
            setSelectedTeamIds={setSelectedTeamIds}
            onOpenTeam={(id) => { setDetailTeamId(id); setTab("team"); }}
            onOpenCompare={() => setCompareOpen(true)}
            onOpenHeatmap={() => setHeatmapOpen(true)}
          />
        )}

        {/* TEAM VIEW (compact, with its own sub-tabs) */}
        {tab === "team" && (
          <TeamTab
            teamTab={teamTab}
            setTeamTab={setTeamTab}
            detailTeamId={detailTeamId}
            setDetailTeamId={setDetailTeamId}
            rounds={rounds}
            selectedRoundId={selectedRoundId}
            setSelectedRoundId={setSelectedRoundId}
            teams={teams}
            manualProbes={manualProbes}
            missionWeight={missionWeight}
            buildRoundsUiForTeam={buildRoundsUiForTeam}
            finalGradeForTeam={finalGradeForTeam}
            mpColumns={mpColumns}
            roundConfigs={roundConfigs}
            sensorData={sensorData}
            roundRefs={roundRefs}
            saveRoundRefs={saveRoundRefs}
            roundTargets={roundTargets}
            saveRoundTargets={saveRoundTargets}
            getInput={getInput}
            getNote={getNote}
            setEditedVal={setEditedVal}
            setEditedNote={setEditedNote}
            saveField={saveField}
            unlock60s={unlock60s}
            mpKeyFn={(rid, key) => `MP:${rid}:${key}`}
          />
        )}

        {/* BENCH (compact page) */}
        {tab === "Performance Benchmarks" && (
          <BenchTab
            rounds={rounds}
            teams={teams}
            roundMetrics={roundMetrics}
            buildSpeedTop={buildSpeedTop}
            buildTempTop={buildTempTop}
            buildHumTop={buildHumTop}
          />
        )}
      </main>

      {/* MODALS */}
      {heatmapOpen && (
        <HeatmapModal
          teams={teams}
          manualProbes={manualProbes}
          liveScore={(team, probe) => {
            const tid = team.id;
            const ed = editedValues?.[tid]?.[probe.id];
            const st = team.scores?.[probe.id];
            if (Array.isArray(probe.columns) && probe.columns.length > 0) {
              const hasW = probe.columns.some((c) => Number(c.weight) > 0);
              if (!hasW) {
                const vals = probe.columns.map((c) => {
                  const v = ed?.[c.key] ?? st?.[c.key];
                  let n = parseFloat(String(v ?? "").replace(",", "."));
                  if (Number.isNaN(n)) n = 0;
                  return Math.max(0, Math.min(10, n));
                });
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
              }
              const totalW = probe.columns.reduce((a, c) => a + (Number(c.weight) || 0), 0) || 1;
              return probe.columns.reduce((acc, c) => {
                const v = ed?.[c.key] ?? st?.[c.key];
                let n = parseFloat(String(v ?? "").replace(",", "."));
                if (Number.isNaN(n)) n = 0;
                n = Math.max(0, Math.min(10, n));
                return acc + n * ((Number(c.weight) || 0) / totalW);
              }, 0);
            } else {
              const v = editedValues?.[tid]?.[probe.id] ?? st;
              let n = parseFloat(String(v ?? "").replace(",", "."));
              if (Number.isNaN(n)) n = 0;
              return Math.max(0, Math.min(10, n));
            }
          }}
          onClose={() => setHeatmapOpen(false)}
        />
      )}

      {compareOpen && (
        <CompareModal
          teams={teams}
          selectedTeamIds={selectedTeamIds}
          manualProbes={manualProbes}
          finalGradeForTeam={finalGradeForTeam}
          buildRoundsUiForTeam={buildRoundsUiForTeam}
          onClose={() => setCompareOpen(false)}
          onClear={() => { setSelectedTeamIds([]); setCompareOpen(false); }}
        />
      )}

      {benchOpen && (
        <BenchModal
          onClose={() => setBenchOpen(false)}
          rounds={rounds}
          teams={teams}
          roundMetrics={roundMetrics}
          buildSpeedTop={buildSpeedTop}
          buildTempTop={buildTempTop}
          buildHumTop={buildHumTop}
        />
      )}
    </div>
  );
}

/*  Builders for Benchmarks  */
function buildSpeedTop(rounds, roundMetrics, teams) {
  const perTeam = new Map();
  for (const roundId of rounds) {
    const M = roundMetrics[roundId];
    if (!M) continue;
    const finishedArr = teams
      .map((t) => ({ team: t, ft: M.byTeam?.[t.id]?.finishTimeMs ?? null }))
      .filter((x) => x.ft != null)
      .sort((a, b) => a.ft - b.ft);
    finishedArr.forEach((x, idx) => {
      const rec = perTeam.get(x.team.id) || { wins: 0, ranksSum: 0, ranksCnt: 0, finishedCount: 0, name: x.team.name || x.team.id };
      rec.ranksSum += (idx + 1); rec.ranksCnt += 1; rec.finishedCount += 1; if (idx === 0) rec.wins += 1;
      perTeam.set(x.team.id, rec);
    });
  }
  const arr = [...teams].map((t) => {
    const a = perTeam.get(t.id) || { wins: 0, ranksSum: 0, ranksCnt: 0, finishedCount: 0, name: t.name || t.id };
    return { teamId: t.id, name: a.name, wins: a.wins, avgRank: a.ranksCnt ? a.ranksSum / a.ranksCnt : Infinity, finishedCount: a.finishedCount };
  });
  arr.sort((a, b) => (b.wins !== a.wins) ? b.wins - a.wins : (a.avgRank !== b.avgRank ? a.avgRank - b.avgRank : b.finishedCount - a.finishedCount));
  return arr;
}
function buildTempTop(rounds, roundMetrics, teams) {
  const res = [];
  for (const t of teams) {
    let sum = 0, cnt = 0;
    for (const roundId of rounds) {
      const M = roundMetrics[roundId];
      const per = M?.byTeam?.[t.id];
      if (!per) continue;
      if (Number.isFinite(per.maeTemp) && Number(per.maeTempN) > 0) {
        sum += per.maeTemp * per.maeTempN; // media ponderată
        cnt += per.maeTempN;
      }
    }
    res.push({
      teamId: t.id,
      name: t.name || t.id,
      maeTemp: cnt ? sum / cnt : Infinity,
      samples: cnt,
    });
  }
  res.sort((a, b) => a.maeTemp - b.maeTemp);
  return res;
}
function buildHumTop(rounds, roundMetrics, teams) {
  const res = [];
  for (const t of teams) {
    let sum = 0, cnt = 0;
    for (const roundId of rounds) {
      const M = roundMetrics[roundId];
      const per = M?.byTeam?.[t.id];
      if (!per) continue;
      if (Number.isFinite(per.maeHum) && Number(per.maeHumN) > 0) {
        sum += per.maeHum * per.maeHumN;
        cnt += per.maeHumN;
      }
    }
    res.push({
      teamId: t.id,
      name: t.name || t.id,
      maeHum: cnt ? sum / cnt : Infinity,
      samples: cnt,
    });
  }
  res.sort((a, b) => a.maeHum - b.maeHum);
  return res;
}

/* Scroll restoration  */
function theScrollRestorationShim() {
  try { if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual"; } catch {}
}


/*  Dashboard  */
function DashboardTab({
  ranking,
  totals,
  missionWeight,
  teamsSummary,
  onOpenHeatmap,
  onOpenCompare,
  selectedTeamIds,
  setSelectedTeamIds,
  onOpenTeam,
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Left: Ranking */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden">
        <div className="px-5 py-3 flex items-center justify-between border-b border-slate-800 bg-slate-900/80">
          <div>
            <h2 className="text-lg font-semibold">Overall ranking</h2>
            <p className="text-xs text-slate-400">
              Weights: <span className="text-slate-200">{missionWeight}%</span> MP +{" "}
              <span className="text-slate-200">{totals.totalManual || 0}%</span> Topics
            </p>
          </div>
          <button
            className="text-[12px] px-3 py-1 rounded-md border border-slate-700 hover:bg-slate-800"
            onClick={onOpenCompare}
            disabled={selectedTeamIds.length < 2}
            title="Open compare"
          >
            Compare ({selectedTeamIds.length})
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/90 text-slate-300 text-xs uppercase">
              <tr>
                <th className="w-16 px-4 py-3 text-left">Rank</th>
                <th className="px-4 py-3 text-left">Team</th>
                <th className="w-40 px-4 py-3 text-right">Final</th>
                <th className="w-24 px-4 py-3 text-center">Pick</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900">
              {ranking.map((r) => {
                const selected = selectedTeamIds.includes(r.teamId);
                return (
                  <tr key={`rk:${r.teamId}`} className="hover:bg-slate-900/60">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-800 text-[12px]">
                        {r.rank}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        className="text-left hover:underline"
                        onClick={() => onOpenTeam(r.teamId)}
                        title="Open team"
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-yellow-300">
                      {r.final.toFixed(2)} / 10
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setSelectedTeamIds((arr) =>
                            selected ? arr.filter((x) => x !== r.teamId) : [...arr, r.teamId]
                          )
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Right: quick cards & actions */}
      <aside className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-sm font-semibold mb-2">Quick actions</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onOpenHeatmap}
              className="px-3 py-2 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-sm"
            >
              Open scores grid
            </button>
            <button
              onClick={onOpenCompare}
              className="px-3 py-2 rounded-lg border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/10 text-sm"
              disabled={selectedTeamIds.length < 2}
            >
              Compare ({selectedTeamIds.length})
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-sm font-semibold mb-3">Teams — progress today</div>
          <div className="space-y-3 max-h-[52vh] overflow-auto pr-1">
            {teamsSummary
              .slice()
              .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
              .map((t) => {
                const pct = Math.min(100, (t.mpProgress || 0) * 100);
                return (
                  <div key={`tcard:${t.id}`} className="rounded-lg border border-slate-800 p-3 bg-slate-900/50">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate">TEAM — {t.name}</div>
                          <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-300">
                            #{t.rank}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">ID: {t.id}</div>
                      </div>
                      <Ring value={Number(t.final) || 0} />
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <StatBox label="Topics subtotal" value={t.manualSubtotal.toFixed(2)} />
                      <StatBox label="Mission Performance avg" value={t.avgMission.toFixed(2)} />
                    </div>

                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Mission progress</span>
                        <span>
                          {t.totalsAcrossRounds.hits}/{t.totalsAcrossRounds.total}
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-green-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-2 flex justify-end">
                      <button
                        className="text-[12px] px-3 py-1 rounded-md border border-slate-700 hover:bg-slate-800"
                        onClick={() => onOpenTeam(t.id)}
                      >
                        Open team
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </aside>
    </div>
  );
}

/* Teams  */
function TeamsTab({
  teamsSummary,
  selectedTeamIds,
  setSelectedTeamIds,
  onOpenTeam,
  onOpenCompare,
  onOpenHeatmap,
}) {
  const [q, setQ] = useState("");
  const filtered = teamsSummary.filter((t) => {
    const s = (t.name + " " + t.id).toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter teams…"
          className="w-72 px-3 py-2 rounded-md bg-slate-800 border border-slate-700 outline-none focus:border-sky-400 text-sm"
        />
        <button
          onClick={onOpenHeatmap}
          className="text-[12px] px-3 py-1 rounded-md border border-emerald-400/60 text-emerald-300 hover:bg-emerald-500/10"
        >
          Heatmap
        </button>
        <button
          onClick={onOpenCompare}
          disabled={selectedTeamIds.length < 2}
          className={cx(
            "text-[12px] px-3 py-1 rounded-md border",
            selectedTeamIds.length < 2
              ? "border-slate-700 text-slate-400 cursor-not-allowed"
              : "border-indigo-400/60 text-indigo-200 hover:bg-indigo-500/10"
          )}
        >
          Compare ({selectedTeamIds.length})
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {filtered
          .slice()
          .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
          .map((t) => {
            const selected = selectedTeamIds.includes(t.id);
            const pct = Math.min(100, (t.mpProgress || 0) * 100);

            return (
              <article
                key={`card:${t.id}`}
                role="button"
                tabIndex={0}
                onClick={() => onOpenTeam(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenTeam(t.id);
                  }
                }}
                className={cx(
                  "group relative overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/50 backdrop-blur",
                  "hover:shadow-2xl hover:shadow-indigo-500/10 hover:border-slate-700/80 transition cursor-pointer"
                )}
                title={`Open team ${t.name}`}
              >
                <div
                  className="pointer-events-none absolute -inset-1 opacity-0 group-hover:opacity-100 transition"
                  style={{
                    background:
                      "radial-gradient(600px 120px at 20% 0%, rgba(99,102,241,.12), transparent 40%), radial-gradient(600px 120px at 80% 100%, rgba(56,189,248,.12), transparent 40%)",
                  }}
                />
                <div className="relative p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-base truncate">{t.name}</h3>
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-300">
                          #{t.rank}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400 break-words">
                        ID: <span className="font-mono">{t.id}</span>
                      </div>
                    </div>
                    <Ring value={Number(t.final) || 0} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                      <div className="text-[11px] text-slate-400">Topics subtotal</div>
                      <div className="font-semibold">{t.manualSubtotal.toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                      <div className="text-[11px] text-slate-400">MP avg (prof)</div>
                      <div className="font-semibold">{t.avgMission.toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="mt-1">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Mission progress</span>
                      <span>
                        {t.totalsAcrossRounds.hits}/{t.totalsAcrossRounds.total}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="pt-1 flex justify-between items-center">
                    <label
                      className="flex items-center gap-2 text-[12px] select-none cursor-pointer"
                      onClick={(e) => e.stopPropagation()} // prevenim click pe card
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onClick={(e) => e.stopPropagation()} // prevenim click pe card
                        onChange={() =>
                          setSelectedTeamIds((arr) =>
                            arr.includes(t.id) ? arr.filter((x) => x !== t.id) : [...arr, t.id]
                          )
                        }
                      />
                      Compare
                    </label>
                    <div className="space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // nu declanșăm click-ul cardului
                          onOpenTeam(t.id);
                        }}
                        className="text-[12px] px-3 py-1 rounded-md border border-slate-600 text-slate-200 hover:bg-slate-800/60"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
      </div>
    </div>
  );
}

/*  Team view (compact, with sub-tabs)  */
function TeamTab({
  teamTab, setTeamTab,
  detailTeamId, setDetailTeamId,
  rounds, selectedRoundId, setSelectedRoundId,
  teams, manualProbes, missionWeight,
  buildRoundsUiForTeam, finalGradeForTeam,
  mpColumns,
  roundConfigs, sensorData, roundRefs, saveRoundRefs,
  roundTargets, saveRoundTargets,
  getInput, getNote, setEditedVal, setEditedNote, saveField,
  unlock60s, mpKeyFn,
}) {
  const team = teams.find((t) => t.id === detailTeamId) || teams[0];
  const teamId = team?.id;
  const teamName = team?.name || teamId || "—";

  // derived
  const roundsUiByTeam = team ? buildRoundsUiForTeam(team.id) : {};
  const breakdown = team ? finalGradeForTeam(team, roundsUiByTeam) : { final: 0, manualSubtotal: 0, avgMission: 0, mpWeighted: 0, rows: [] };

  // sub-state
  const [topicId, setTopicId] = useState(manualProbes[0]?.id || "");
  useEffect(() => {
    if (manualProbes.length && !topicId) setTopicId(manualProbes[0].id);
  }, [manualProbes.length]);

  useEffect(() => {
    if (!selectedRoundId && rounds.length) setSelectedRoundId(rounds[0]);
  }, [rounds.length]); // eslint-disable-line

  if (!team) {
    return <div className="text-slate-300">No team selected. Pick one from Teams tab.</div>;
  }

  const onEditVal = (probeId, raw, colKey) => setEditedVal(teamId, probeId, raw, colKey);
  const onEditNote = (probeId, text, colKey) => setEditedNote(teamId, probeId, text, colKey);

  /* Helper: compute MP round score (respectă ponderile când există) */
  const roundScore = (roundId) => {
    const fields = mpColumns || [];
    if (!fields.length) return 0;

    const hasWeights = fields.some((f) => Number(f.weight) > 0);
    if (!hasWeights) {
      let sum = 0;
      for (const f of fields) {
        const raw = getInput(team, mpKeyFn(roundId, f.key));
        let n = parseFloat(String(raw ?? "").replace(",", "."));
        if (Number.isNaN(n)) n = 0;
        n = Math.max(0, Math.min(10, n));
        sum += n;
      }
      return sum / fields.length;
    }
    const totalW = fields.reduce((a, f) => a + (Number(f.weight) || 0), 0) || 1;
    return fields.reduce((acc, f) => {
      const raw = getInput(team, mpKeyFn(roundId, f.key));
      let n = parseFloat(String(raw ?? "").replace(",", "."));
      if (Number.isNaN(n)) n = 0;
      n = Math.max(0, Math.min(10, n));
      return acc + n * ((Number(f.weight) || 0) / totalW);
    }, 0);
  };

  return (
    <div className="space-y-6">
      {/* Top bar for the team */}
      <div className="rounded-2xl border bg-slate-900/60 shadow-xl overflow-hidden border-slate-800 ring-1 ring-inset ring-white/5">
        <div className="px-5 py-3 flex items-center justify-between bg-slate-900/80 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{teamName}</h2>
            <span className="text-[12px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-300">
              {teamId}
            </span>
          </div>
          <div className="flex items-center gap-5">
            <div className="hidden md:flex text-sm text-slate-400">
              Weights:&nbsp;
              <span className="text-slate-200">{missionWeight}% Mission Performance</span>&nbsp;+&nbsp;
              <span className="text-slate-200">
                {manualProbes.reduce((a, p) => a + (p.weight || 0), 0)}%
              </span>
              &nbsp;Topics
            </div>
            <Ring value={Number(breakdown.final ?? 0)} />
          </div>
        </div>

        <div className="px-5 py-3 flex items-center gap-2">
          <label className="text-xs text-slate-400">Team:</label>
          <select
            value={teamId}
            onChange={(e) => setDetailTeamId(e.target.value)}
            className="px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-sm outline-none focus:border-sky-400"
          >
            {teams.map((t) => (
              <option key={`opt:${t.id}`} value={t.id}>
                {t.name || t.id}
              </option>
            ))}
          </select>

          <nav className="ml-3 inline-flex rounded-lg border border-slate-700 overflow-hidden">
            {[
              { value: "topics", label: "topics" },
              { value: "mission", label: "Mission Performance" },
            ].map(({ value, label }) => (
              <button
                key={value}
                className={cx(
                  "px-3 py-1.5 text-sm capitalize",
                  teamTab === value ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60"
                )}
                onClick={() => setTeamTab(value)}
              >
                {label}
              </button>
            ))}
          </nav>

          {teamTab === "mission" && (
            <div className="ml-auto flex items-center gap-2">
              <label className="text-xs text-slate-400">Round:</label>
              <select
                value={selectedRoundId || ""}
                onChange={(e) => setSelectedRoundId(e.target.value)}
                className="px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-sm outline-none focus:border-sky-400"
              >
                {rounds.map((r) => (
                  <option key={`r:${r}`} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <div className="text-xs text-slate-400">
                Round Mission Performance score:{" "}
                <span className="text-slate-100 font-semibold">{roundScore(selectedRoundId).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CONTENT: sub-tab */}
      {teamTab === "topics" ? (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Left: topic list */}
          <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="text-sm font-semibold mb-2">Topics</div>
            <div className="space-y-1 max-h-[62vh] overflow-auto pr-1">
              {manualProbes.map((p, idx) => (
                <button
                  key={`tp:${p.id}`}
                  className={cx(
                    "w-full text-left px-3 py-2 rounded-md border",
                    topicId === p.id
                      ? "border-indigo-400/60 bg-slate-800"
                      : "border-slate-700 hover:bg-slate-800/60"
                  )}
                  onClick={() => setTopicId(p.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate">
                      <span className="text-slate-200 font-medium">{p.id}</span>
                      {Number(p.weight) ? (
                        <span className="ml-2 text-[11px] text-slate-400">({Number(p.weight)}%)</span>
                      ) : null}
                    </div>
                    <span className="text-[12px] text-slate-300">
                      {(() => {
                        const t = team;
                        const v = (() => {
                          const ed = t?.scores?.[p.id];
                          if (Array.isArray(p.columns) && p.columns.length > 0) return "…";
                          return Number.isFinite(Number(ed)) ? Number(ed) : 0;
                        })();
                        return typeof v === "string" ? v : v.toFixed(2);
                      })()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {/* Right: selected topic editor */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold truncate">
                  Topic: <span className="text-indigo-300">{topicId || "—"}</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Weighted into final by topic weight.
                </p>
              </div>
              <div className="flex items-center gap-5">
                <StatBox label="Topic score" value={(() => {
                  const p = manualProbes.find((x) => x.id === topicId);
                  if (!p) return "0.00";
                  const v = (() => {
                    if (Array.isArray(p.columns) && p.columns.length > 0) {
                      const vals = p.columns.map((c) => {
                        const raw = getInput(team, p.id, c.key);
                        let n = parseFloat(String(raw ?? "").replace(",", "."));
                        if (Number.isNaN(n)) n = 0;
                        return Math.max(0, Math.min(10, n));
                      });
                      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                    }
                    const raw = getInput(team, p.id);
                    let n = parseFloat(String(raw ?? "").replace(",", "."));
                    if (Number.isNaN(n)) n = 0;
                    return Math.max(0, Math.min(10, n));
                  })();
                  return Number(v).toFixed(2);
                })()} />
                <StatBox label="Weighted subtotal" value={breakdown.manualSubtotal.toFixed(2)} />
              </div>
            </div>

            <div className="p-5">
              {(() => {
                const p = manualProbes.find((x) => x.id === topicId);
                if (!p) return <div className="text-sm text-slate-400">Pick a topic from the left.</div>;

                const cols = Array.isArray(p.columns) ? p.columns : [];
                return (
                  <div className="space-y-4">
                    {cols.length > 0 ? (
                      cols.map((col) => {
                        const curVal = getInput(team, p.id, col.key);
                        const curNote = getNote(team, p.id, col.key);
                        const saved = team?.scoresMeta?.[p.id]?.cols?.[col.key]?.hash ===
                          JSON.stringify([Number(Number(curVal || 0).toFixed(3)), String(curNote || "")]);
                        return (
                          <ScoreWithNote
                            key={col.key}
                            title={col.label}
                            weightPct={col.weight}
                            valueFromStore={curVal}
                            noteFromStore={curNote}
                            onChangeValue={(raw) => onEditVal(p.id, raw, col.key)}
                            onChangeNote={(txt) => onEditNote(p.id, txt, col.key)}
                            onSave={() => saveField(teamId, p.id, col.key)}
                            saved={saved}
                          />
                        );
                      })
                    ) : (
                      <ScoreWithNote
                        title="Score & Justification"
                        valueFromStore={getInput(team, p.id)}
                        noteFromStore={getNote(team, p.id)}
                        onChangeValue={(raw) => onEditVal(p.id, raw)}
                        onChangeNote={(txt) => onEditNote(p.id, txt)}
                        onSave={() => saveField(teamId, p.id)}
                        saved={
                          team?.scoresMeta?.[p.id]?.hash ===
                          JSON.stringify([Number(Number(getInput(team, p.id) || 0).toFixed(3)), String(getNote(team, p.id) || "")])
                        }
                      />
                    )}
                  </div>
                );
              })()}
            </div>
          </section>
        </div>
      ) : (
        /* Mission sub-tab — single round at a time (fields from Manage Topics) */
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden">
          {(() => {
            const roundId = selectedRoundId || rounds[0];
            const ui = roundsUiByTeam[roundId] || {
              total: Number(roundConfigs[roundId] ?? 0),
              hitsCount: 0,
              progress: 0,
              reachedOrders: new Set(),
              scanByOrder: new Map(),
            };
            const { total, hitsCount, progress, reachedOrders, scanByOrder } = ui;

            const labels = Array.from({ length: total }, (_, i) => `P${i + 1}`);
            const teamTemps = labels.map((_, i) => {
              const order = i + 1;
              const scan = scanByOrder.get(order);
              const live = sensorData?.[teamId]?.[roundId]?.[order]?.temp;
              const v = Number.isFinite(live) ? live : Number(scan?.temp);
              return Number.isFinite(v) ? v : null;
            });
            const teamHums = labels.map((_, i) => {
              const order = i + 1;
              const scan = scanByOrder.get(order);
              const live = sensorData?.[teamId]?.[roundId]?.[order]?.humidity;
              const v = Number.isFinite(live) ? live : Number(scan?.humidity);
              return Number.isFinite(v) ? v : null;
            });
            const orgTemps = labels.map((_, i) => {
              const v = roundRefs?.[roundId]?.temp?.[i];
              return Number.isFinite(v) ? v : null;
            });
            const orgHums = labels.map((_, i) => {
              const v = roundRefs?.[roundId]?.humidity?.[i];
              return Number.isFinite(v) ? v : null;
            });

            const fields = mpColumns || [];

            return (
              <>
                <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">Round: {roundId}</h3>
                    <p className="text-xs text-slate-400">
                      Edit criteria below. Left column shows live/status by checkpoint.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <RoundRefsInlineEditor
                      total={total}
                      curTemps={roundRefs?.[roundId]?.temp || []}
                      curHums={roundRefs?.[roundId]?.humidity || []}
                      onSave={(temps, hums) => saveRoundRefs(roundId, temps, hums)}
                    />
                  </div>
                </div>

                {/* Charts */}
                <div className="p-5 grid md:grid-cols-2 gap-6">
                  <AxisChart
                    labels={labels}
                    unit="°C"
                    series={[
                      { name: "Organizer", color: "#a78bfa", data: orgTemps },
                      { name: "Team", color: "#2dd4bf", data: teamTemps },
                    ]}
                    height={190}
                  />
                  <AxisChart
                    labels={labels}
                    unit="%"
                    series={[
                      { name: "Organizer", color: "#a78bfa", data: orgHums },
                      { name: "Team", color: "#2dd4bf", data: teamHums },
                    ]}
                    height={190}
                  />
                </div>

                {/* Checkpoints row */}
                <div className="px-5 pb-3">
                  <div className="relative flex items-center justify-between mb-3">
                    {Array.from({ length: total }).map((_, i) => {
                      const order = i + 1;
                      const reached = reachedOrders.has(order);
                      const scan = scanByOrder.get(order);
                      const tempLive = sensorData?.[teamId]?.[roundId]?.[order]?.temp;
                      const humLive = sensorData?.[teamId]?.[roundId]?.[order]?.humidity;
                      const temp = Number.isFinite(tempLive) ? tempLive : scan?.temp;
                      const humidity = Number.isFinite(humLive) ? humLive : scan?.humidity;

                      return (
                        <div key={order} className="flex flex-col items-center w-full text-center">
                          <div
                            className={cx(
                              "w-8 h-8 rounded-full border-2 flex items-center justify-center text-[11px] font-bold transition-all shadow",
                              reached
                                ? "bg-green-400 border-emerald-300 text-black"
                                : "bg-slate-900 border-slate-600 text-slate-400"
                            )}
                            title={reached ? (scan?.locked ? "Locked" : "Unlocked") : "Not scanned"}
                          >
                            {order}
                          </div>

                          <div className="mt-1 flex items-center gap-1">
                            {reached ? (
                              <LockTimerControl scan={scan} onReopen={() => unlock60s(teamId, roundId, order)} />
                            ) : (
                              <button
                                onClick={() => unlock60s(teamId, roundId, order)}
                                className="text-[11px] px-2 py-0.5 rounded border border-indigo-400 text-indigo-300"
                              >
                                Open 60s
                              </button>
                            )}
                          </div>

                          <span className="text-xs mt-1 text-slate-400 font-mono">P{order}</span>
                          <div className="text-[11px] text-slate-300 mt-1 text-center">
                            {temp !== undefined ? `🌡 ${Number(temp).toFixed(2)}°C` : "🌡 -°C"}
                            <br />
                            {humidity !== undefined ? `💧 ${Number(humidity).toFixed(2)}%` : "💧 -%"}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="relative w-full h-[6px] bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="absolute h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, progress * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Professor grading for round (fields from Manage Topics) */}
                <div className="px-5 pb-5">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                    <div className="text-sm font-semibold text-slate-200 mb-3">
                      Professor grading for this round
                    </div>
                    {fields.length === 0 ? (
                      <div className="text-sm text-slate-400">
                        No MP fields defined in <b>Manage Topics</b> (Mission Performance). Add them there.
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {fields.map((f) => {
                          const pid = mpKeyFn(roundId, f.key);
                          const curVal = getInput(team, pid);
                          const curNote = getNote(team, pid);
                          const saved =
                            team?.scoresMeta?.[pid]?.hash ===
                            JSON.stringify([Number(Number(curVal || 0).toFixed(3)), String(curNote || "")]);
                          return (
                            <ScoreWithNote
                              key={pid}
                              title={f.label}
                              valueFromStore={curVal}
                              noteFromStore={curNote}
                              onChangeValue={(raw) => onEditVal(pid, raw)}
                              onChangeNote={(txt) => onEditNote(pid, txt)}
                              onSave={() => saveField(teamId, pid)}
                              saved={saved}
                            />
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-3 flex justify-end">
                      <StatBox label="Total for this trek" value={roundScore(roundId).toFixed(2)} />
                    </div>
                  </div>

                  <p className="mt-2 text-sm text-center text-slate-400">
                    {hitsCount} / {total} checkpoints
                  </p>
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* bottom summary */}
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">Topics subtotal</div>
          <div className="font-semibold">{breakdown.manualSubtotal.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">Mission Performance subtotal</div>
          <div className="font-semibold">
            {breakdown.avgMission.toFixed(2)} × {(missionWeight / 100).toFixed(2)} = {breakdown.mpWeighted.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">Final grade</div>
          <div className="font-bold text-yellow-300">
            {breakdown.final == null ? "—" : `${breakdown.final.toFixed(2)} / 10`}
          </div>
        </div>
      </div>
    </div>
  );
}

/*  Bench tab (compact)  */
function BenchTab({ rounds, teams, roundMetrics, buildSpeedTop, buildTempTop, buildHumTop }) {
  const speedStats = buildSpeedTop(rounds, roundMetrics, teams);
  const tempStats = buildTempTop(rounds, roundMetrics, teams);
  const humStats = buildHumTop(rounds, roundMetrics, teams);

  const fmtTime = (ms) =>
    !Number.isFinite(ms) || ms == null
      ? "—"
      : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40">
          <div className="px-3 py-2 text-sm font-semibold border-b border-slate-800">Finishing order </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-right">Wins</th>
                <th className="px-3 py-2 text-right">Avg rank</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {speedStats.slice(0, 10).map((r) => (
                <tr key={`top:speed:${r.teamId}`}>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right">{r.wins}</td>
                  <td className="px-3 py-2 text-right">{r.avgRank === Infinity ? "—" : r.avgRank.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40">
          <div className="px-3 py-2 text-sm font-semibold border-b border-slate-800">Temperature accuracy (MAE)</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-right">Mean Absolute Error (°C)</th>
                <th className="px-3 py-2 text-right">Records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {tempStats.slice(0, 10).map((r) => (
                <tr key={`top:temp:${r.teamId}`}>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right">{r.maeTemp === Infinity ? "—" : r.maeTemp.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{r.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40">
          <div className="px-3 py-2 text-sm font-semibold border-b border-slate-800">Humidity accuracy (MAE)</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-right">Mean Absolute Error (%RH)</th>
                <th className="px-3 py-2 text-right">Records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {humStats.slice(0, 10).map((r) => (
                <tr key={`top:hum:${r.teamId}`}>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right">{r.maeHum === Infinity ? "—" : r.maeHum.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{r.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* NEW: Completion order per round (with times) */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="px-3 py-2 text-sm font-semibold border-b border-slate-800">
          Round completion order & times <span className="text-slate-400 text-xs">(time = last QR scan)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Round</th>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-left">Finished at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rounds.map((rid) => {
                const M = roundMetrics[rid];
                if (!M) return null;
                const finished = teams
                  .map((t) => ({ t, ft: M.byTeam?.[t.id]?.finishTimeMs ?? null }))
                  .filter((x) => x.ft != null)
                  .sort((a, b) => a.ft - b.ft);

                if (finished.length === 0) {
                  return (
                    <tr key={`cmp:none:${rid}`}>
                      <td className="px-3 py-2">{rid}</td>
                      <td className="px-3 py-2 text-slate-400" colSpan={2}>
                        — no team finished yet —
                      </td>
                    </tr>
                  );
                }

                return finished.map((row, idx) => (
                  <tr key={`cmp:${rid}:${row.t.id}`}>
                    <td className="px-3 py-2">{idx === 0 ? rid : ""}</td>
                    <td className="px-3 py-2">{row.t.name || row.t.id}</td>
                    <td className="px-3 py-2">{fmtTime(row.ft)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/*  Heatmap modal  */
function HeatmapModal({ teams, manualProbes, liveScore, onClose }) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative mx-auto mt-16 w-[95vw] max-w-6xl rounded-xl border border-slate-700 bg-slate-900 p-4 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Score Grid — Topics × Teams</h3>
          <button onClick={onClose} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800">
            Close
          </button>
        </div>

        <div className="overflow-auto">
          <table className="text-sm min-w-[720px] w-full border border-slate-800 rounded-lg overflow-hidden">
            <thead className="bg-slate-800 text-slate-300 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Topic</th>
                {teams.map((t) => (
                  <th key={`hm:h:${t.id}`} className="px-3 py-2 text-center">
                    {t.name || t.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900">
              {manualProbes.map((p) => (
                <tr key={`hm:${p.id}`}>
                  <td className="px-3 py-2">{p.id}</td>
                  {teams.map((t) => {
                    const v = liveScore(t, p);
                    const g = Math.round((v / 10) * 120);
                    const bg = `hsl(${g}, 60%, 22%)`;
                    const bd = `hsl(${g}, 60%, 32%)`;
                    return (
                      <td key={`hm:${p.id}:${t.id}`} className="px-3 py-2 text-center">
                        <span
                          className="inline-block min-w-[56px] px-2 py-1 rounded-md border"
                          style={{ background: bg, borderColor: bd }}
                          title={v.toFixed(2)}
                        >
                          {v.toFixed(2)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/*  Compare modal  */
function CompareModal({
  teams,
  selectedTeamIds,
  manualProbes,
  finalGradeForTeam,
  buildRoundsUiForTeam,
  onClose,
  onClear,
}) {
  const selected = teams.filter((t) => selectedTeamIds.includes(t.id));
  const perTeam = selected.map((t) => {
    const rUi = buildRoundsUiForTeam(t.id);
    const br = finalGradeForTeam(t, rUi);
    return { team: t, br };
  });

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative mx-auto mt-16 w-[95vw] max-w-6xl rounded-xl border border-slate-700 bg-slate-900 p-4 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Compare — {perTeam.length} teams</h3>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800 text-sm">
              Close
            </button>
            <button onClick={onClear} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800 text-sm">
              Clear selection
            </button>
          </div>
        </div>

        {perTeam.length < 2 ? (
          <div className="text-sm text-slate-300">
            Select at least two teams from Teams tab and press <b>Compare</b>.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="text-sm min-w-[880px] w-full border border-slate-800 rounded-lg overflow-hidden">
              <thead className="bg-slate-800 text-slate-300 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">Metric</th>
                  {perTeam.map(({ team }) => (
                    <th key={`cmp:h:${team.id}`} className="px-3 py-2 text-center">
                      {team.name || team.id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900">
                <tr>
                  <td
                    colSpan={1 + perTeam.length}
                    className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 bg-slate-900/70"
                  >
                    Topics
                  </td>
                </tr>

                {manualProbes.map((p, idx) => (
                  <tr key={`cmp:topic:${p.id}`}>
                    <td className="px-3 py-2">
                      <span className="font-semibold">Topic {idx + 1}:</span>{" "}
                      <span className="font-medium">{p.id}</span>{" "}
                      {Number(p.weight) ? <span className="text-slate-400">({Number(p.weight)}%)</span> : null}
                    </td>
                    {perTeam.map(({ team }) => {
                      const v = (() => {
                        const st = team.scores?.[p.id];
                        if (Array.isArray(p.columns) && p.columns.length > 0) {
                          const vals = p.columns.map((c) => {
                            const raw = st?.[c.key];
                            let n = parseFloat(String(raw ?? "").replace(",", "."));
                            if (Number.isNaN(n)) n = 0;
                            return Math.max(0, Math.min(10, n));
                          });
                          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                        }
                        let n = parseFloat(String(st ?? "").replace(",", "."));
                        if (Number.isNaN(n)) n = 0;
                        return Math.max(0, Math.min(10, n));
                      })();
                      return (
                        <td key={`cmp:topic:${p.id}:${team.id}`} className="px-3 py-2 text-center" title={v.toFixed(2)}>
                          {v.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                <tr className="border-t border-slate-800">
                  <td className="px-3 py-2 font-semibold text-teal-300">Topics subtotal</td>
                  {perTeam.map(({ br, team }) => (
                    <td key={`cmp:topics-sub:${team.id}`} className="px-3 py-2 text-center font-semibold text-teal-300">
                      {br.manualSubtotal.toFixed(2)}
                    </td>
                  ))}
                </tr>

                <tr className="text-teal-300 font-bold">
                  <td className="px-3 py-2">Mission Performance (avg, prof)</td>
                  {perTeam.map(({ br, team }) => (
                    <td key={`cmp:mp:${team.id}`} className="px-3 py-2 text-center">
                      {br.avgMission.toFixed(2)}
                    </td>
                  ))}
                </tr>

                <tr className="bg-slate-900/60">
                  <td className="px-3 py-2 font-bold">Final grade</td>
                  {perTeam.map(({ br, team }) => (
                    <td key={`cmp:final:${team.id}`} className="px-3 py-2 text-center font-bold text-yellow-300">
                      {br.final == null ? "—" : br.final.toFixed(2)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/*  Benchmarks (modal)  */
function BenchModal({ onClose, rounds, teams, roundMetrics, buildSpeedTop, buildTempTop, buildHumTop }) {
  const speedStats = buildSpeedTop(rounds, roundMetrics, teams);
  const tempStats = buildTempTop(rounds, roundMetrics, teams);
  const humStats = buildHumTop(rounds, roundMetrics, teams);

  const fmtTime = (ms) =>
    !Number.isFinite(ms) || ms == null
      ? "—"
      : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative mx-auto mt-16 w-[95vw] max-w-6xl rounded-xl border border-slate-700 bg-slate-900 p-4 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Benchmarks (for grading)</h3>
          <button onClick={onClose} className="px-3 py-1 rounded border border-slate-700 hover:bg-slate-800 text-sm">
            Close
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {/* Speed */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/40">
            <div className="px-3 py-2 text-sm font-semibold border-b border-slate-800">Finish order (global)</div>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-right">Wins</th>
                  <th className="px-3 py-2 text-right">Avg rank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {speedStats.slice(0, 10).map((r) => (
                  <tr key={`top:speed:${r.teamId}`}>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right">{r.wins}</td>
                    <td className="px-3 py-2 text-right">{r.avgRank === Infinity ? "—" : r.avgRank.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Temp */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/40">
            <div className="px-3 py-2 text-sm font-semibold border-b border-slate-800">Temperature accuracy (MAE)</div>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-right">Mean Absolute Error (°C)</th>
                  <th className="px-3 py-2 text-right">Samples</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {tempStats.slice(0, 10).map((r) => (
                  <tr key={`top:temp:${r.teamId}`}>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right">
                      {r.maeTemp === Infinity ? "—" : r.maeTemp.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">{r.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Hum */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/40">
            <div className="px-3 py-2 text-sm font-semibold border-b border-slate-800">Humidity accuracy (MAE)</div>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-right">Mean Absolute Error (%RH)</th>
                  <th className="px-3 py-2 text-right">Records</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {humStats.slice(0, 10).map((r) => (
                  <tr key={`top:hum:${r.teamId}`}>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right">
                      {r.maeHum === Infinity ? "—" : r.maeHum.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">{r.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* First finisher by round + time */}
        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
          <div className="px-3 py-2 text-sm font-semibold border-b border-slate-800">
            First finisher by round (with time)
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Round</th>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-left">Finished at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rounds.map((rid) => {
                const M = roundMetrics[rid];
                if (!M) return null;
                const finished = teams
                  .map((t) => ({ t, ft: M.byTeam?.[t.id]?.finishTimeMs ?? null }))
                  .filter((x) => x.ft != null)
                  .sort((a, b) => a.ft - b.ft);
                const first = finished[0];
                return (
                  <tr key={`first:${rid}`}>
                    <td className="px-3 py-2">{rid}</td>
                    <td className="px-3 py-2">{first ? first.t.name || first.t.id : "—"}</td>
                    <td className="px-3 py-2">{first ? fmtTime(first.ft) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
