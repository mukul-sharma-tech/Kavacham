"use client";
import { useState } from "react";
import { generateConstellation, generateDebris } from "@/lib/physics/orbits";

const SAT_COUNT_OPTIONS = [1, 2, 3, 5, 10, 20, 30, 50];
const DEBRIS_COUNT_OPTIONS = [5, 10, 20, 50, 100, 200];

type St = "idle" | "loading" | "ok" | "error";

export default function ControlPanel({ onDataLoaded }: { onDataLoaded?: () => void }) {
  const [st, setSt] = useState<Record<string, St>>({});
  const [log, setLog] = useState<string>("");
  const [auto, setAuto] = useState(false);
  const [autoId, setAutoId] = useState<ReturnType<typeof setInterval> | null>(null);

  // Constellation config
  const [satCount, setSatCount] = useState(5);
  const [debrisCount, setDebrisCount] = useState(20);

  // Manual burn
  const [burnSat, setBurnSat] = useState("SAT-001");
  const [burnDv, setBurnDv] = useState("5");
  const [burnDir, setBurnDir] = useState<"prograde" | "retrograde" | "radial">("prograde");

  async function call(key: string, url: string, body?: object) {
    setSt((s) => ({ ...s, [key]: "loading" }));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      setSt((s) => ({ ...s, [key]: "ok" }));
      setLog(JSON.stringify(data, null, 2));
      onDataLoaded?.();
      setTimeout(() => setSt((s) => ({ ...s, [key]: "idle" })), 1500);
    } catch (e) {
      setSt((s) => ({ ...s, [key]: "error" }));
      setLog(String(e));
    }
  }

  function loadConstellation() {
    const sats = generateConstellation(satCount);
    const debris = generateDebris(debrisCount, sats);
    // Telemetry API expects flat { id, type, r, v } — not nested state
    const objects = [...sats, ...debris].map((o) => ({
      id: o.id,
      type: o.type,
      r: o.state.r,
      v: o.state.v,
    }));
    setBurnSat(sats[0]?.id ?? "SAT-001");
    call("demo", "/api/telemetry", { objects, timestamp: new Date().toISOString() });
  }

  function toggleAuto() {
    if (auto) {
      if (autoId) clearInterval(autoId);
      setAutoId(null);
      setAuto(false);
    } else {
      const id = setInterval(() => call("auto", "/api/simulate/step", { step_seconds: 60 }), 2000);
      setAutoId(id);
      setAuto(true);
    }
  }

  async function scheduleBurn() {
    const dvMs = parseFloat(burnDv);
    if (isNaN(dvMs) || dvMs <= 0 || dvMs > 15) {
      setLog("Error: Δv must be 0–15 m/s");
      return;
    }
    const dvKmS = dvMs / 1000;
    const dirs = {
      prograde:   { x: 0, y: dvKmS, z: 0 },
      retrograde: { x: 0, y: -dvKmS, z: 0 },
      radial:     { x: dvKmS, y: 0, z: 0 },
    };
    let simNowMs = Date.now();
    try {
      const snap = await fetch("/api/visualization/snapshot");
      const data = await snap.json();
      simNowMs = new Date(data.timestamp).getTime();
    } catch { /* fallback */ }

    await call("burn", "/api/maneuver/schedule", {
      satelliteId: burnSat,
      maneuver_sequence: [{
        burn_id: `MANUAL_${burnSat}_${Date.now()}`,
        burnTime: new Date(simNowMs + 15000).toISOString(),
        deltaV_vector: dirs[burnDir],
      }],
    });
  }

  async function burnAndStep() {
    await scheduleBurn();
    await call("burnstep", "/api/simulate/step", { step_seconds: 60 });
  }

  function cls(key: string, base = "btn") {
    const s = st[key];
    if (s === "loading") return `${base} btn-loading`;
    if (s === "ok") return `${base} btn-success`;
    if (s === "error") return `${base} btn-error`;
    return base;
  }

  const sel: React.CSSProperties = {
    width: "100%", padding: "6px 10px",
    background: "var(--bg)", border: "1px solid var(--border)",
    borderRadius: "6px", color: "var(--text)", fontSize: "12px", outline: "none",
  };

  return (
    <div className="card" style={{ width: "220px", minWidth: "220px", display: "flex", flexDirection: "column", overflowY: "auto" }}>

      {/* ── Constellation Config ── */}
      <Sec title="Constellation">
        {/* Satellite count */}
        <div style={{ marginBottom: "8px" }}>
          <label style={lbl}>Satellites</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {SAT_COUNT_OPTIONS.map((n) => (
              <button key={n} onClick={() => setSatCount(n)} style={{
                padding: "3px 8px", borderRadius: "5px", fontSize: "11px", cursor: "pointer",
                border: `1px solid ${satCount === n ? "var(--accent)" : "var(--border)"}`,
                background: satCount === n ? "rgba(99,102,241,0.2)" : "var(--bg)",
                color: satCount === n ? "var(--accent-light)" : "var(--text-muted)",
                fontWeight: satCount === n ? 700 : 400,
              }}>{n}</button>
            ))}
          </div>
        </div>

        {/* Debris count */}
        <div style={{ marginBottom: "10px" }}>
          <label style={lbl}>Debris objects</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {DEBRIS_COUNT_OPTIONS.map((n) => (
              <button key={n} onClick={() => setDebrisCount(n)} style={{
                padding: "3px 8px", borderRadius: "5px", fontSize: "11px", cursor: "pointer",
                border: `1px solid ${debrisCount === n ? "#ef4444" : "var(--border)"}`,
                background: debrisCount === n ? "rgba(239,68,68,0.15)" : "var(--bg)",
                color: debrisCount === n ? "#ef4444" : "var(--text-muted)",
                fontWeight: debrisCount === n ? 700 : 400,
              }}>{n}</button>
            ))}
          </div>
        </div>

        <button className={cls("demo", "btn btn-primary")} onClick={loadConstellation}>
          🛰 Load {satCount} Sats + {debrisCount} Debris
        </button>
        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "5px" }}>
          Spread across {Math.min(12, Math.ceil(satCount / 3))} orbital planes
        </div>
      </Sec>

      {/* ── Simulation ── */}
      <Sec title="Simulation">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px", marginBottom: "6px" }}>
          {[{ k: "s60", l: "+1 min", s: 60 }, { k: "s600", l: "+10 min", s: 600 },
            { k: "s3600", l: "+1 hr", s: 3600 }, { k: "s86400", l: "+24 hrs", s: 86400 }]
            .map(({ k, l, s }) => (
              <button key={k} className={cls(k)} style={{ textAlign: "center", padding: "7px 4px", fontSize: "12px" }}
                onClick={() => call(k, "/api/simulate/step", { step_seconds: s })}>{l}</button>
            ))}
        </div>
        <button className={auto ? "btn btn-active" : "btn"} style={{ textAlign: "center", fontSize: "12px" }} onClick={toggleAuto}>
          {auto ? "⏹ Stop Auto-Step" : "▶ Auto-Step (60s)"}
        </button>
      </Sec>

      {/* ── Manual Burn ── */}
      <Sec title="Manual Burn">
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          <div>
            <label style={lbl}>Satellite</label>
            <input value={burnSat} onChange={(e) => setBurnSat(e.target.value)} style={sel} placeholder="SAT-001" />
          </div>
          <div>
            <label style={lbl}>Δv (m/s, max 15)</label>
            <input type="number" min="0.1" max="15" step="0.5" value={burnDv}
              onChange={(e) => setBurnDv(e.target.value)} style={sel} />
          </div>
          <div>
            <label style={lbl}>Direction</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px" }}>
              {(["prograde", "retrograde", "radial"] as const).map((d) => (
                <button key={d} onClick={() => setBurnDir(d)} style={{
                  padding: "5px 2px", fontSize: "10px", textAlign: "center", borderRadius: "6px",
                  border: `1px solid ${burnDir === d ? "var(--accent)" : "var(--border)"}`,
                  background: burnDir === d ? "rgba(99,102,241,0.15)" : "var(--bg)",
                  color: burnDir === d ? "var(--accent-light)" : "var(--text-muted)",
                  cursor: "pointer",
                }}>
                  {d === "prograde" ? "▶ Pro" : d === "retrograde" ? "◀ Retro" : "↑ Radial"}
                </button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", background: "var(--bg)", borderRadius: "6px", padding: "6px 8px", border: "1px solid var(--border)" }}>
            Fuel ≈ <b style={{ color: "var(--text)" }}>{(550 * (1 - Math.exp(-(parseFloat(burnDv) || 0) / (300 * 9.80665)))).toFixed(3)} kg</b>
          </div>
          <button className={cls("burn")} onClick={scheduleBurn}>Schedule Burn</button>
          <button className={cls("burnstep", "btn btn-primary")} onClick={burnAndStep}>🔥 Burn + Step 60s</button>
        </div>
      </Sec>

      {/* ── Autonomy ── */}
      <Sec title="Autonomy">
        <button className={cls("cola")} onClick={() => call("cola", "/api/cola/auto")}>
          🛡 Trigger Auto-Evasion
        </button>
        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "5px" }}>
          Auto-schedules burns for critical conjunctions
        </div>
      </Sec>

      {/* ── Response ── */}
      <Sec title="Response" noBorder>
        <pre style={{
          fontSize: "10px", color: "var(--text-dim)", background: "var(--bg)",
          borderRadius: "6px", padding: "8px", border: "1px solid var(--border)",
          overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
          maxHeight: "120px", minHeight: "36px",
          fontFamily: "'SF Mono', 'Fira Code', monospace",
        }}>{log || "No response yet"}</pre>
      </Sec>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", display: "block" };

function Sec({ title, children, noBorder }: { title: string; children: React.ReactNode; noBorder?: boolean }) {
  return (
    <div style={{ padding: "12px 14px", borderBottom: noBorder ? "none" : "1px solid var(--border)" }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "9px" }}>
        {title}
      </div>
      {children}
    </div>
  );
}
