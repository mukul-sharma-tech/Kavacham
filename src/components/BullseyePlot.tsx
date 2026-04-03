"use client";
import { useEffect, useRef } from "react";

interface Warning { sat: string; deb: string; tca: string; miss_km: number; rel_v_kms: number; }

export default function BullseyePlot({ warnings, selectedSat }: { warnings: Warning[]; selectedSat: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2 + 10;
    const maxR = Math.min(cx, cy) - 20;

    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    // Rings
    const rings = [
      { km: 0.1, color: "rgba(239,68,68,0.3)", label: "100m" },
      { km: 1, color: "rgba(245,158,11,0.2)", label: "1 km" },
      { km: 5, color: "rgba(99,102,241,0.15)", label: "5 km" },
      { km: 50, color: "rgba(255,255,255,0.06)", label: "50 km" },
    ];
    for (const ring of rings) {
      const r = (ring.km / 50) * maxR;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.km === 0.1 ? 1.5 : 1;
      ctx.setLineDash(ring.km === 0.1 ? [] : [3, 5]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "9px -apple-system, sans-serif";
      ctx.fillText(ring.label, cx + r + 3, cy - 3);
    }

    // Crosshairs
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, 20); ctx.lineTo(cx, H - 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, cy); ctx.lineTo(W - 20, cy); ctx.stroke();

    // Center
    ctx.fillStyle = "#6366f1";
    ctx.shadowColor = "#6366f1";
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    if (!selectedSat) {
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Select a satellite", cx, cy + maxR + 16);
      ctx.textAlign = "left";
      return;
    }

    const rel = warnings.filter((w) => w.sat === selectedSat);
    rel.forEach((w, i) => {
      const angle = (i / Math.max(rel.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const r = Math.min(w.miss_km / 50, 0.97) * maxR;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      const color = w.miss_km < 0.1 ? "#ef4444" : w.miss_km < 1 ? "#f97316" : w.miss_km < 5 ? "#f59e0b" : "#6366f1";

      ctx.strokeStyle = color + "30";
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();

      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "9px -apple-system, sans-serif";
      ctx.fillText(w.deb.slice(-5), x + 6, y + 3);
    });

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "bold 11px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(selectedSat, cx, 18);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.fillText(`${rel.length} conjunction${rel.length !== 1 ? "s" : ""}`, cx, 30);
    ctx.textAlign = "left";
  }, [warnings, selectedSat]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div style={{ padding: "10px 14px 0", fontSize: "11px", fontWeight: "600", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Conjunction Plot
      </div>
      <canvas ref={canvasRef} width={270} height={230} style={{ width: "100%", height: "calc(100% - 30px)", display: "block" }} />
    </div>
  );
}
