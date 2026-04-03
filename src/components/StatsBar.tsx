"use client";
import type { SnapshotData } from "@/app/page";

export default function StatsBar({ snapshot, fps }: { snapshot: SnapshotData | null; fps: number }) {
  const s = snapshot?.stats;

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "12px",
      padding: "0 20px",
      display: "flex",
      alignItems: "center",
      gap: "0",
      height: "56px",
    }}>
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingRight: "24px", borderRight: "1px solid var(--border)" }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "8px",
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "16px",
        }}>🛰</div>
        <div>
          <div style={{ fontWeight: "700", fontSize: "14px", color: "var(--text)" }}>Aether ACM</div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Constellation Manager</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", alignItems: "center", flex: 1, padding: "0 24px", gap: "8px" }}>
        <Stat label="Satellites" value={s?.total_satellites ?? 0} />
        <Sep />
        <Stat label="Debris" value={s?.total_debris ?? 0} />
        <Sep />
        <Stat label="CDM Warnings" value={s?.active_cdm_count ?? 0} color={s?.active_cdm_count ? "#f59e0b" : "#10b981"} />
        <Sep />
        <Stat label="Collisions" value={s?.total_collisions ?? 0} color={s?.total_collisions ? "#ef4444" : "#10b981"} />
        <Sep />
        <Stat label="Maneuvers" value={s?.maneuver_log_count ?? 0} color="#818cf8" />
      </div>

      {/* Right */}
      <div style={{ display: "flex", alignItems: "center", gap: "20px", paddingLeft: "24px", borderLeft: "1px solid var(--border)" }}>
        <div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "1px" }}>Sim Time</div>
          <div style={{ fontSize: "12px", color: "var(--text-dim)", fontWeight: "500" }}>
            {snapshot ? new Date(snapshot.timestamp).toUTCString().slice(0, 25) : "—"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{
            width: "7px", height: "7px", borderRadius: "50%",
            background: "#10b981",
            boxShadow: "0 0 0 2px rgba(16,185,129,0.3)",
            animation: "livePulse 2s infinite",
          }} />
          <span style={{ fontSize: "12px", color: "#10b981", fontWeight: "600" }}>Live</span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>{fps} fps</span>
        </div>
      </div>

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ padding: "0 16px", textAlign: "center" }}>
      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: "700", color: color ?? "var(--text)", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function Sep() {
  return <div style={{ width: "1px", height: "32px", background: "var(--border)" }} />;
}
