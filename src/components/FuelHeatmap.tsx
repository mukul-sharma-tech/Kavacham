"use client";
import type { SnapshotData } from "@/app/page";

const FUEL_MAX = 50;

export default function FuelHeatmap({ snapshot }: { snapshot: SnapshotData | null }) {
  const sats = snapshot?.satellites ?? [];
  const log = snapshot?.maneuver_log ?? [];

  // Total dv consumed per satellite from log
  const dvBySat: Record<string, number> = {};
  for (const entry of log) {
    dvBySat[entry.satelliteId] = (dvBySat[entry.satelliteId] ?? 0) + entry.dvMs;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="card-header">Fleet Health</div>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>

        {sats.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", paddingTop: "16px" }}>
            No data
          </div>
        )}

        {sats.map((sat) => {
          const fuelPct = Math.max(0, Math.min(100, (sat.fuel_kg / FUEL_MAX) * 100));
          const fuelColor = fuelPct > 50 ? "#10b981" : fuelPct > 20 ? "#f59e0b" : "#ef4444";
          const dv = dvBySat[sat.id] ?? 0;

          return (
            <div key={sat.id} style={{
              background: "var(--bg)",
              borderRadius: "8px",
              padding: "8px 10px",
              border: "1px solid var(--border)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--text)" }}>{sat.id}</span>
                  {fuelPct.toFixed(2)}%
              </div>

              {/* Fuel bar */}
              <div style={{ height: "6px", background: "var(--surface2)", borderRadius: "4px", overflow: "hidden", marginBottom: "5px" }}>
                <div style={{
                  width: `${fuelPct}%`, height: "100%",
                  background: `linear-gradient(90deg, ${fuelColor}, ${fuelColor}aa)`,
                  borderRadius: "4px", transition: "width 0.4s ease",
                }} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted)" }}>
                <span>{sat.fuel_kg.toFixed(3)} kg remaining</span>
                {dv > 0 && <span style={{ color: "#818cf8" }}>Δv {dv.toFixed(3)} m/s used</span>}
              </div>
            </div>
          );
        })}

        {/* Fleet summary */}
        {sats.length > 0 && (
          <div style={{
            marginTop: "4px", padding: "8px 10px",
            background: "rgba(99,102,241,0.07)",
            borderRadius: "8px", border: "1px solid rgba(99,102,241,0.2)",
          }}>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px" }}>Fleet Average</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text)" }}>
                {(sats.reduce((a, s) => a + s.fuel_kg, 0) / sats.length).toFixed(1)} kg avg
              </span>
              <span style={{ color: "#818cf8" }}>
                {Object.values(dvBySat).reduce((a, v) => a + v, 0).toFixed(2)} m/s total Δv
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
