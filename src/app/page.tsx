"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import OrbitalMap from "@/components/OrbitalMap";
import BurnAlert from "@/components/BurnAlert";

export interface SnapshotData {
  timestamp: string;
  satellites: Array<{
    id: string; lat: number; lon: number; alt: number;
    fuel_kg: number; status: string; slot_drift_km: number; in_box: boolean;
    predicted_track: Array<[number, number]>;
  }>;
  debris_cloud: Array<[string, number, number, number]>;
  active_warnings: Array<{ sat: string; deb: string; tca: string; miss_km: number; rel_v_kms: number }>;
  stats: {
    total_satellites: number; total_debris: number;
    active_cdm_count: number; total_collisions: number;
    total_outage_s: number; maneuver_log_count: number;
  };
  maneuver_log: Array<{ burnId: string; satelliteId: string; executedAt: string; dvMs: number }>;
}

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [selectedSat, setSelectedSat] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── API helpers ──────────────────────────────────────────────────────────
  async function post(url: string, body: object) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  const fetchSnapshot = useCallback(async () => {
    const res = await fetch("/api/visualization/snapshot");
    if (res.ok) setSnapshot(await res.json());
  }, []);

  useEffect(() => {
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, 800);
    return () => clearInterval(id);
  }, [fetchSnapshot]);

  // ── Load initial scenario ────────────────────────────────────────────────
  async function loadScenario() {
    const now = new Date().toISOString();

    // 5 satellites in clearly different orbital planes
    const sats = [
      { id: "SAT-001", type: "SATELLITE", r: { x: 6778, y: 0, z: 0 },     v: { x: 0, y: 7.784, z: 0 } },
      { id: "SAT-002", type: "SATELLITE", r: { x: 4794, y: 0, z: 4794 },  v: { x: 0, y: 7.784, z: 0 } },
      { id: "SAT-003", type: "SATELLITE", r: { x: 0, y: 6778, z: 0 },     v: { x: -5.505, y: 0, z: 5.505 } },
      { id: "SAT-004", type: "SATELLITE", r: { x: 0, y: 0, z: 6778 },     v: { x: 7.784, y: 0, z: 0 } },
      { id: "SAT-005", type: "SATELLITE", r: { x: -4794, y: 4794, z: 0 }, v: { x: -5.505, y: -5.505, z: 0 } },
    ];

    // Background debris — random orbits
    const bgDebris = [
      { id: "DEB-001", type: "DEBRIS", r: { x: 6900, y: 200, z: 0 },    v: { x: -0.5, y: 7.6, z: 0.1 } },
      { id: "DEB-002", type: "DEBRIS", r: { x: 6500, y: 0, z: 1000 },   v: { x: 1.2, y: 7.0, z: -0.3 } },
      { id: "DEB-003", type: "DEBRIS", r: { x: 0, y: 7000, z: -500 },   v: { x: -1.0, y: -7.5, z: 0.2 } },
      { id: "DEB-004", type: "DEBRIS", r: { x: 200, y: -6600, z: 800 }, v: { x: 0.8, y: 7.2, z: 0.5 } },
      { id: "DEB-005", type: "DEBRIS", r: { x: -6800, y: 300, z: 100 }, v: { x: 0.3, y: -7.7, z: -0.1 } },
    ];

    // THREAT debris — on converging orbits, will reach < 100m miss distance
    // Same orbit as SAT-001, slightly faster, placed 2 minutes ahead
    // Relative velocity ~0.015 km/s → closes 0.9 km/min → reaches SAT in ~2.2 min
    const sat1 = sats[0];
    const threatDebris = [
      {
        id: "DEB-THREAT-1", type: "DEBRIS",
        // 2 minutes ahead in orbit
        r: {
          x: sat1.r.x + sat1.v.x * 120,
          y: sat1.r.y + sat1.v.y * 120,
          z: sat1.r.z + sat1.v.z * 120,
        },
        // 0.3% faster — closes gap in ~6-7 minutes of sim time
        v: { x: sat1.v.x * 1.003, y: sat1.v.y * 1.003, z: sat1.v.z * 1.003 },
      },
      {
        id: "DEB-THREAT-2", type: "DEBRIS",
        // 3 minutes ahead of SAT-002
        r: {
          x: sats[1].r.x + sats[1].v.x * 180,
          y: sats[1].r.y + sats[1].v.y * 180,
          z: sats[1].r.z + sats[1].v.z * 180,
        },
        v: { x: sats[1].v.x * 1.002, y: sats[1].v.y * 1.002, z: sats[1].v.z * 1.002 },
      },
    ];

    await post("/api/telemetry", { timestamp: now, objects: [...sats, ...bgDebris, ...threatDebris] });
    addLog("✅ Loaded 5 satellites + 7 debris (2 on collision course)");
    addLog("💡 Click ▶ Run Simulation — COLA will auto-detect and dodge threats");
    fetchSnapshot();
  }

  // ── Push debris close to a satellite (triggers COLA) ─────────────────────
  async function pushDebrisClose(satId: string) {
    const sat = snapshot?.satellites.find((s) => s.id === satId);
    if (!sat) { addLog("⚠ Select a satellite first"); return; }

    // Convert lat/lon back to approximate ECI (simplified)
    const latR = sat.lat * Math.PI / 180;
    const lonR = sat.lon * Math.PI / 180;
    const r = 6378.137 + sat.alt;
    const satR = {
      x: r * Math.cos(latR) * Math.cos(lonR),
      y: r * Math.cos(latR) * Math.sin(lonR),
      z: r * Math.sin(latR),
    };
    // Debris 60m ahead in orbit direction
    const now = new Date().toISOString();
    await post("/api/telemetry", {
      timestamp: now,
      objects: [{
        id: "DEB-THREAT",
        type: "DEBRIS",
        r: { x: satR.x + 0.06, y: satR.y + 0.01, z: satR.z + 0.01 },
        v: { x: -7.5, y: 0.5, z: 0.2 }, // head-on approach
      }],
    });
    addLog(`🎯 Debris pushed close to ${satId} — COLA should trigger`);
    fetchSnapshot();
  }

  // ── Manual evasion burn — applies immediately ────────────────────────────
  async function fireEvasionBurn(satId: string) {
    const result = await post("/api/maneuver/schedule", {
      instant: true,
      satelliteId: satId,
      dvMs: 5.0,
      direction: "prograde",
    });
    if (result.status === "BURN_APPLIED") {
      addLog(`🔥 Burn fired on ${satId} — Δv 5 m/s, fuel: ${result.fuelAfter?.toFixed(3)} kg (−${result.fuelConsumed?.toFixed(3)} kg)`);
      await step(60);
    } else {
      addLog(`❌ Burn failed: ${result.error ?? JSON.stringify(result)}`);
    }
  }

  // ── Step simulation ───────────────────────────────────────────────────────
  async function step(seconds: number) {
    const result = await post("/api/simulate/step", { step_seconds: seconds });
    const burns = result.maneuvers_executed ?? 0;
    const scheduled = result.burns_scheduled ?? 0;
    const warnings = result.active_warnings ?? 0;
    const collisions = result.collisions_detected ?? 0;

    let msg = `⏱ +${seconds}s`;
    if (warnings > 0) msg += ` · ⚠ ${warnings} CDM warning${warnings !== 1 ? "s" : ""}`;
    if (scheduled > 0) msg += ` · 📋 ${scheduled} burn${scheduled !== 1 ? "s" : ""} scheduled`;
    if (burns > 0) msg += ` · 🔥 ${burns} burn${burns !== 1 ? "s" : ""} executed`;
    if (collisions > 0) msg += ` · 💥 ${collisions} collision${collisions !== 1 ? "s" : ""}!`;

    addLog(msg);
    await fetchSnapshot();
  }

  // ── Auto-run toggle ───────────────────────────────────────────────────────
  function toggleRun() {
    if (running) {
      if (autoRef.current) clearInterval(autoRef.current);
      autoRef.current = null;
      setRunning(false);
      addLog("⏹ Simulation paused");
    } else {
      // Step every 1.2 seconds — fast enough to see action, slow enough to read logs
      autoRef.current = setInterval(() => step(120), 1200);
      setRunning(true);
      addLog("▶ Simulation running — COLA monitoring all satellites autonomously");
    }
  }

  function addLog(msg: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${msg}`, ...prev].slice(0, 12));
  }

  const sel = snapshot?.satellites.find((s) => s.id === selectedSat);
  const fuelPct = sel ? (sel.fuel_kg / 50) * 100 : 0;
  const fuelColor = fuelPct > 30 ? "#10b981" : fuelPct > 10 ? "#f59e0b" : "#ef4444";
  const statusColor = sel?.status === "NOMINAL" ? "#10b981" : sel?.status === "EVADING" ? "#ef4444" : "#f59e0b";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f1117", color: "#e8eaf0", fontFamily: "system-ui, sans-serif", overflow: "hidden" }}>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "10px 20px", background: "#1a1d27", borderBottom: "1px solid #2a2d3e" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "20px" }}>🛰</span>
          <span style={{ fontWeight: 700, fontSize: "16px", color: "#818cf8" }}>AETHER ACM</span>
          <span style={{ fontSize: "11px", color: "#6b7280" }}>Autonomous Constellation Manager</span>
        </div>

        <div style={{ display: "flex", gap: "16px", marginLeft: "16px" }}>
          <Chip label="Satellites" value={snapshot?.stats.total_satellites ?? 0} color="#10b981" />
          <Chip label="Debris" value={snapshot?.stats.total_debris ?? 0} color="#ef4444" />
          <Chip label="CDM Warnings" value={snapshot?.stats.active_cdm_count ?? 0} color={snapshot?.stats.active_cdm_count ? "#f59e0b" : "#6b7280"} />
          <Chip label="Burns Fired" value={snapshot?.stats.maneuver_log_count ?? 0} color="#818cf8" />
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <Btn onClick={loadScenario} color="#6366f1">🛰 Load Scenario</Btn>
          <Btn onClick={toggleRun} color={running ? "#ef4444" : "#10b981"}>
            {running ? "⏹ Pause" : "▶ Run Simulation"}
          </Btn>
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: "0" }}>

        {/* Map */}
        <div style={{ flex: 1, position: "relative" }}>
          <OrbitalMap snapshot={snapshot} selectedSat={selectedSat} onSelectSat={setSelectedSat} />
        </div>

        {/* Right panel */}
        <div style={{ width: "300px", background: "#1a1d27", borderLeft: "1px solid #2a2d3e", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Selected satellite info */}
          <div style={{ padding: "16px", borderBottom: "1px solid #2a2d3e" }}>
            <div style={{ fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>
              Selected Satellite
            </div>
            {sel ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                  <span style={{ fontWeight: 700, fontSize: "15px" }}>{sel.id}</span>
                  <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "12px", background: statusColor + "22", color: statusColor, fontWeight: 600 }}>
                    {sel.status}
                  </span>
                </div>
                {/* Fuel bar */}
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#9ca3af", marginBottom: "4px" }}>
                    <span>Fuel</span>
                    <span style={{ color: fuelColor, fontWeight: 600 }}>{sel.fuel_kg.toFixed(3)} kg</span>
                  </div>
                  <div style={{ height: "8px", background: "#0f1117", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${fuelPct}%`, height: "100%", background: fuelColor, borderRadius: "4px", transition: "width 0.4s" }} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "12px" }}>
                  <InfoRow label="Altitude" value={`${sel.alt.toFixed(0)} km`} />
                  <InfoRow label="Latitude" value={`${sel.lat.toFixed(1)}°`} />
                  <InfoRow label="Slot Drift" value={`${sel.slot_drift_km.toFixed(1)} km`} color={sel.in_box ? "#10b981" : "#f59e0b"} />
                  <InfoRow label="In Box" value={sel.in_box ? "✓ Yes" : "✗ No"} color={sel.in_box ? "#10b981" : "#f59e0b"} />
                </div>
              </div>
            ) : (
              <div style={{ color: "#6b7280", fontSize: "13px" }}>Click a satellite on the map</div>
            )}
          </div>

          {/* Manual controls */}
          <div style={{ padding: "16px", borderBottom: "1px solid #2a2d3e" }}>
            <div style={{ fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>
              Manual Control
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <Btn onClick={() => selectedSat ? pushDebrisClose(selectedSat) : addLog("⚠ Select a satellite first")} color="#ef4444" full>
                🎯 Push Debris Close to Satellite
              </Btn>
              <Btn onClick={() => selectedSat ? fireEvasionBurn(selectedSat) : addLog("⚠ Select a satellite first")} color="#f59e0b" full>
                🔥 Fire Evasion Burn
              </Btn>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                <Btn onClick={() => step(60)} color="#6366f1">+1 min</Btn>
                <Btn onClick={() => step(600)} color="#6366f1">+10 min</Btn>
                <Btn onClick={() => step(3600)} color="#6366f1">+1 hour</Btn>
                <Btn onClick={() => step(86400)} color="#6366f1">+24 hrs</Btn>
              </div>
            </div>
          </div>

          {/* All satellites list */}
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 16px 6px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Fleet ({snapshot?.satellites.length ?? 0})
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {(snapshot?.satellites ?? []).map((sat) => {
                const fp = (sat.fuel_kg / 50) * 100;
                const fc = fp > 30 ? "#10b981" : fp > 10 ? "#f59e0b" : "#ef4444";
                const sc = sat.status === "NOMINAL" ? "#10b981" : sat.status === "EVADING" ? "#ef4444" : "#f59e0b";
                return (
                  <div key={sat.id} onClick={() => setSelectedSat(sat.id)} style={{
                    padding: "10px 16px", cursor: "pointer",
                    borderBottom: "1px solid #2a2d3e",
                    background: selectedSat === sat.id ? "rgba(99,102,241,0.1)" : "transparent",
                    borderLeft: `3px solid ${selectedSat === sat.id ? "#6366f1" : "transparent"}`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px" }}>{sat.id}</span>
                      <span style={{ fontSize: "10px", color: sc, fontWeight: 600 }}>{sat.status}</span>
                    </div>
                    <div style={{ height: "4px", background: "#0f1117", borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ width: `${fp}%`, height: "100%", background: fc, transition: "width 0.4s" }} />
                    </div>
                    <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "3px" }}>
                      {sat.fuel_kg.toFixed(2)} kg · {sat.alt.toFixed(0)} km
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Activity log */}
          <div style={{ borderTop: "1px solid #2a2d3e", padding: "10px 14px", maxHeight: "160px", overflowY: "auto" }}>
            <div style={{ fontSize: "10px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>Activity Log</div>
            {log.map((l, i) => (
              <div key={i} style={{ fontSize: "10px", color: i === 0 ? "#e8eaf0" : "#6b7280", marginBottom: "3px", lineHeight: 1.4 }}>{l}</div>
            ))}
            {log.length === 0 && <div style={{ fontSize: "10px", color: "#6b7280" }}>Click "Load Scenario" to begin</div>}
          </div>
        </div>
      </div>

      {/* Burn alerts */}
      <BurnAlert maneuverLog={snapshot?.maneuver_log ?? []} />

      <style>{`@keyframes livePulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "10px", color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "#0f1117", borderRadius: "6px", padding: "5px 8px" }}>
      <div style={{ fontSize: "9px", color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: "12px", fontWeight: 600, color: color ?? "#e8eaf0" }}>{value}</div>
    </div>
  );
}

function Btn({ onClick, color, children, full }: { onClick: () => void; color: string; children: React.ReactNode; full?: boolean }) {
  return (
    <button onClick={onClick} style={{
      width: full ? "100%" : "auto",
      padding: "8px 12px", borderRadius: "7px", border: `1px solid ${color}44`,
      background: color + "18", color, fontSize: "12px", fontWeight: 600,
      cursor: "pointer", transition: "all 0.15s", textAlign: "center",
    }}
      onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = color + "30"; }}
      onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = color + "18"; }}
    >
      {children}
    </button>
  );
}
