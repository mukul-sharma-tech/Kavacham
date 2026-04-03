"use client";
import { useEffect, useState, useRef } from "react";

interface BurnEvent {
  id: string;
  satelliteId: string;
  dvMs: number;
  type: "EVASION" | "RECOVERY" | "GRAVEYARD" | "MANUAL";
  time: number;
}

interface Props {
  maneuverLog: Array<{ burnId: string; satelliteId: string; executedAt: string; dvMs: number }>;
}

export default function BurnAlert({ maneuverLog }: Props) {
  const [alerts, setAlerts] = useState<BurnEvent[]>([]);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (!maneuverLog || maneuverLog.length === 0) return;
    if (maneuverLog.length <= prevCountRef.current) return;

    // New burns since last check
    const newBurns = maneuverLog.slice(prevCountRef.current);
    prevCountRef.current = maneuverLog.length;

    const newAlerts: BurnEvent[] = newBurns.map((m) => ({
      id: `${m.burnId}-${Date.now()}-${Math.random()}`,
      satelliteId: m.satelliteId,
      dvMs: m.dvMs,
      type: m.burnId.includes("EVASION") ? "EVASION"
        : m.burnId.includes("RECOVERY") ? "RECOVERY"
        : m.burnId.includes("GRAVEYARD") ? "GRAVEYARD"
        : "MANUAL",
      time: Date.now(),
    }));

    setAlerts((prev) => [...newAlerts, ...prev].slice(0, 6));

    // Auto-dismiss after 5 seconds
    newAlerts.forEach((alert) => {
      setTimeout(() => {
        setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
      }, 5000);
    });
  }, [maneuverLog]);

  if (alerts.length === 0) return null;

  return (
    <div style={{
      position: "fixed",
      top: "80px",
      right: "16px",
      zIndex: 1000,
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      pointerEvents: "none",
    }}>
      {alerts.map((alert) => {
        const isEvasion = alert.type === "EVASION";
        const isGraveyard = alert.type === "GRAVEYARD";
        const bgColor = isGraveyard ? "rgba(139,92,246,0.95)"
          : isEvasion ? "rgba(220,38,38,0.95)"
          : "rgba(37,99,235,0.95)";
        const borderColor = isGraveyard ? "#a78bfa"
          : isEvasion ? "#ff4444"
          : "#60a5fa";
        const icon = isGraveyard ? "☠️" : isEvasion ? "🔥" : "↩️";
        const label = isGraveyard ? "GRAVEYARD BURN"
          : isEvasion ? "EVASION BURN"
          : alert.type === "RECOVERY" ? "RECOVERY BURN"
          : "MANUAL BURN";

        return (
          <div
            key={alert.id}
            style={{
              background: bgColor,
              border: `1px solid ${borderColor}`,
              borderRadius: "10px",
              padding: "10px 16px",
              minWidth: "240px",
              boxShadow: `0 0 20px ${borderColor}66`,
              animation: "burnSlideIn 0.3s ease-out",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontSize: "16px" }}>{icon}</span>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "white", letterSpacing: "0.08em" }}>
                {label}
              </span>
              <div style={{
                marginLeft: "auto",
                width: "8px", height: "8px", borderRadius: "50%",
                background: "white",
                animation: "livePulse 0.6s infinite",
              }} />
            </div>

            {/* Details */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>
                {alert.satelliteId}
              </span>
              <span style={{ fontSize: "13px", color: "white", fontWeight: 700 }}>
                Δv {alert.dvMs.toFixed(3)} m/s
              </span>
            </div>

            {/* Fuel cost estimate */}
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", marginTop: "3px" }}>
              Fuel consumed ≈ {(550 * (1 - Math.exp(-alert.dvMs / (300 * 9.80665)))).toFixed(3)} kg
            </div>

            {/* Progress bar (countdown to dismiss) */}
            <div style={{ height: "2px", background: "rgba(255,255,255,0.2)", borderRadius: "2px", marginTop: "8px", overflow: "hidden" }}>
              <div style={{
                height: "100%", background: "white", borderRadius: "2px",
                animation: "burnCountdown 5s linear forwards",
              }} />
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes burnSlideIn {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes burnCountdown {
          from { width: 100%; }
          to   { width: 0%; }
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}
