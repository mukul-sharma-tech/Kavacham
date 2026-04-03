"use client";

interface Sat {
  id: string; lat: number; lon: number; alt: number;
  fuel_kg: number; status: string; slot_drift_km: number; in_box: boolean;
}

const FUEL_MAX = 50;

export default function TelemetryPanel({ satellites, selectedSat, onSelectSat }: {
  satellites: Sat[]; selectedSat: string | null; onSelectSat: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Fleet Telemetry</span>
        <span style={{ color: "var(--text-muted)", fontWeight: "400" }}>{satellites.length} active</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {satellites.length === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>🛰</div>
            <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>No satellites loaded</div>
            <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "4px" }}>Use the control panel to load data</div>
          </div>
        )}

        {satellites.map((sat) => {
          const fuelPct = Math.max(0, Math.min(100, (sat.fuel_kg / FUEL_MAX) * 100));
          const fuelColor = fuelPct > 30 ? "#10b981" : fuelPct > 10 ? "#f59e0b" : "#ef4444";
          const isSel = selectedSat === sat.id;
          const statusTag = sat.status === "NOMINAL" ? "tag tag-green"
            : sat.status === "EVADING" ? "tag tag-red"
            : sat.status === "RECOVERING" ? "tag tag-yellow"
            : "tag tag-purple";

          return (
            <div
              key={sat.id}
              onClick={() => onSelectSat(sat.id)}
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
                background: isSel ? "rgba(99,102,241,0.07)" : "transparent",
                borderLeft: `3px solid ${isSel ? "#6366f1" : "transparent"}`,
                transition: "all 0.12s",
              }}
            >
              {/* Top row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontWeight: "600", fontSize: "13px", color: isSel ? "#818cf8" : "var(--text)" }}>
                  {sat.id}
                </span>
                <span className={statusTag}>{sat.status}</span>
              </div>

              {/* Fuel bar */}
              <div style={{ marginBottom: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Fuel</span>
                  <span style={{ fontSize: "11px", color: fuelColor, fontWeight: "600" }}>{sat.fuel_kg.toFixed(3)} kg</span>
                </div>
                <div style={{ height: "4px", background: "var(--bg)", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{
                    width: `${fuelPct}%`, height: "100%",
                    background: fuelColor, borderRadius: "4px",
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--text-muted)" }}>
                <span>Alt <b style={{ color: "var(--text-dim)" }}>{sat.alt.toFixed(0)} km</b></span>
                <span>Drift <b style={{ color: sat.in_box ? "#10b981" : "#f59e0b" }}>{sat.slot_drift_km.toFixed(1)} km</b></span>
                <span>Lat <b style={{ color: "var(--text-dim)" }}>{sat.lat.toFixed(1)}°</b></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
