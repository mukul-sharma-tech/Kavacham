"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import GroundTrackMap from "@/components/GroundTrackMap";
import Globe3D from "@/components/Globe3D";
import BullseyePlot from "@/components/BullseyePlot";
import TelemetryPanel from "@/components/TelemetryPanel";
import ManeuverTimeline from "@/components/ManeuverTimeline";
import StatsBar from "@/components/StatsBar";
import ControlPanel from "@/components/ControlPanel";
import FuelHeatmap from "@/components/FuelHeatmap";
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

const POLL_MS = 500; // poll twice per second for smoother animation

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [selectedSat, setSelectedSat] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [rightTab, setRightTab] = useState<"telemetry" | "fuel">("telemetry");
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [realtimeOn, setRealtimeOn] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState("");
  const [satFilter, setSatFilter] = useState<string | null>(null);
  const [rtSatCount, setRtSatCount] = useState(20);
  const [rtDebrisCount, setRtDebrisCount] = useState(100);
  const frameRef = useRef(0);
  const lastFpsTime = useRef(Date.now());

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch("/api/visualization/snapshot");
      if (res.ok) {
        const data: SnapshotData = await res.json();
        setSnapshot(data);
        frameRef.current++;
        const now = Date.now();
        const elapsed = (now - lastFpsTime.current) / 1000;
        if (elapsed >= 1) {
          setFps(Math.round(frameRef.current / elapsed));
          frameRef.current = 0;
          lastFpsTime.current = now;
        }
      }
    } catch { /* retry */ }
  }, []);

  useEffect(() => {
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, POLL_MS);
    return () => clearInterval(id);
  }, [fetchSnapshot]);

  async function toggleRealtime() {
    if (realtimeOn) {
      setRealtimeStatus("Stopping...");
      await fetch("/api/realtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
      setRealtimeOn(false);
      setRealtimeStatus("");
    } else {
      setRealtimeStatus("Starting...");
      const res = await fetch("/api/realtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", satCount: rtSatCount, debrisCount: rtDebrisCount }) });
      const data = await res.json();
      setRealtimeOn(true);
      setViewMode("3d"); // auto-switch to 3D globe
      setRealtimeStatus(`${data.satellites} sats · ${data.debris} debris`);
    }
  }

  const selectedWarnings = snapshot?.active_warnings.filter((w) => w.sat === selectedSat) ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", gap: "8px", padding: "8px", background: "var(--bg)" }}>

      {/* Top bar */}
      <div style={{ display: "flex", gap: "8px", alignItems: "stretch" }}>
        <div style={{ flex: 1 }}>
          <StatsBar snapshot={snapshot} fps={fps} />
        </div>

        {/* Mode controls */}
        <div className="card" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 16px" }}>
          {/* View toggle */}
          <div style={{ display: "flex", background: "var(--bg)", borderRadius: "8px", padding: "3px", gap: "2px" }}>
            {(["2d", "3d"] as const).map((m) => (
              <button key={m} onClick={() => setViewMode(m)} style={{
                padding: "5px 14px", borderRadius: "6px", border: "none", cursor: "pointer",
                fontSize: "12px", fontWeight: "600",
                background: viewMode === m ? "var(--accent)" : "transparent",
                color: viewMode === m ? "white" : "var(--text-muted)",
                transition: "all 0.15s",
              }}>
                {m === "2d" ? "🗺 2D Map" : "🌍 3D Globe"}
              </button>
            ))}
          </div>

          {/* Realtime toggle */}
          {!realtimeOn && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <select value={rtSatCount} onChange={(e) => setRtSatCount(Number(e.target.value))}
                style={{ padding: "5px 8px", borderRadius: "6px", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontSize: "11px" }}>
                {[5, 10, 20, 30, 50].map((n) => <option key={n} value={n}>{n} sats</option>)}
              </select>
              <select value={rtDebrisCount} onChange={(e) => setRtDebrisCount(Number(e.target.value))}
                style={{ padding: "5px 8px", borderRadius: "6px", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontSize: "11px" }}>
                {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n} debris</option>)}
              </select>
            </div>
          )}
          <button
            onClick={toggleRealtime}
            style={{
              padding: "7px 18px", borderRadius: "8px", border: "none", cursor: "pointer",
              fontSize: "12px", fontWeight: "700",
              background: realtimeOn
                ? "linear-gradient(135deg, #10b981, #059669)"
                : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "white",
              boxShadow: realtimeOn ? "0 0 16px rgba(16,185,129,0.4)" : "0 0 16px rgba(99,102,241,0.3)",
              transition: "all 0.2s",
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <span style={{
              width: "7px", height: "7px", borderRadius: "50%",
              background: realtimeOn ? "white" : "rgba(255,255,255,0.7)",
              animation: realtimeOn ? "livePulse 1s infinite" : "none",
              display: "inline-block",
            }} />
            {realtimeOn ? "⏹ Stop Realtime" : "▶ Start Realtime"}
          </button>

          {realtimeStatus && (
            <span style={{ fontSize: "11px", color: realtimeOn ? "#10b981" : "var(--text-muted)" }}>
              {realtimeStatus}
            </span>
          )}
        </div>
      </div>

      {/* Main */}
      <div style={{ display: "flex", flex: 1, gap: "8px", minHeight: 0 }}>

        {/* Left: controls — hide in realtime 3D mode */}
        {!realtimeOn && <ControlPanel onDataLoaded={fetchSnapshot} />}

        {/* Realtime info panel */}
        {realtimeOn && (
          <div className="card" style={{ width: "200px", minWidth: "200px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Autonomous Mode
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <InfoRow label="Engine" value="RUNNING" color="#10b981" pulse />
              <InfoRow label="COLA" value="AUTO" color="#818cf8" />
              <InfoRow label="KD-Tree" value="ACTIVE" color="#3b82f6" />
              <InfoRow label="Sim Speed" value="30× real" color="var(--text-dim)" />
              <InfoRow label="Tick Rate" value="1s" color="var(--text-dim)" />
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px" }}>Live Stats</div>
              <InfoRow label="Satellites" value={snapshot?.stats.total_satellites ?? 0} />
              <InfoRow label="Debris" value={snapshot?.stats.total_debris ?? 0} />
              <InfoRow label="Warnings" value={snapshot?.stats.active_cdm_count ?? 0} color={snapshot?.stats.active_cdm_count ? "#f59e0b" : "#10b981"} />
              <InfoRow label="Collisions" value={snapshot?.stats.total_collisions ?? 0} color={snapshot?.stats.total_collisions ? "#ef4444" : "#10b981"} />
              <InfoRow label="Burns fired" value={snapshot?.stats.maneuver_log_count ?? 0} color="#818cf8" />
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" }}>What's happening</div>
              <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: "1.6" }}>
                • RK4 + J2 propagating all objects<br />
                • KD-Tree scanning conjunctions<br />
                • CW equations computing Δv<br />
                • Auto-scheduling evasion burns<br />
                • Tracking fuel via Tsiolkovsky<br />
                • LOS checking ground stations
              </div>
            </div>
          </div>
        )}

        {/* Center: map or globe */}
        <div className="card" style={{ flex: 1, minWidth: 0 }}>
          {viewMode === "3d"
            ? <Globe3D snapshot={snapshot} selectedSat={selectedSat} onSelectSat={setSelectedSat} />
            : <GroundTrackMap snapshot={snapshot} selectedSat={selectedSat} onSelectSat={setSelectedSat} />
          }
        </div>

        {/* Right: tabbed panel */}
        <div className="card" style={{ width: "290px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            {(["telemetry", "fuel"] as const).map((tab) => (
              <button key={tab} onClick={() => setRightTab(tab)} style={{
                flex: 1, padding: "10px 8px",
                fontSize: "11px", fontWeight: "600", textTransform: "capitalize",
                color: rightTab === tab ? "var(--accent-light)" : "var(--text-muted)",
                background: "transparent", border: "none", cursor: "pointer",
                borderBottom: rightTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                transition: "all 0.15s",
              }}>
                {tab === "telemetry" ? "🛰 Fleet" : "⛽ Fuel"}
              </button>
            ))}
          </div>

          <div style={{ height: "220px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <BullseyePlot warnings={selectedWarnings} selectedSat={selectedSat} />
          </div>

          <div style={{ flex: 1, overflow: "hidden" }}>
            {rightTab === "telemetry"
              ? <TelemetryPanel satellites={snapshot?.satellites ?? []} selectedSat={selectedSat} onSelectSat={setSelectedSat} />
              : <FuelHeatmap snapshot={snapshot} />
            }
          </div>
        </div>
      </div>

      {/* Bottom: timeline */}

      {/* Burn alert overlay */}
      <BurnAlert maneuverLog={snapshot?.maneuver_log ?? []} />
    </div>
  );
}

function InfoRow({ label, value, color, pulse }: { label: string; value: string | number; color?: string; pulse?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{label}</span>
      <span style={{
        fontSize: "11px", fontWeight: "600",
        color: color ?? "var(--text)",
        animation: pulse ? "livePulse 1.5s infinite" : "none",
      }}>{value}</span>
    </div>
  );
}
