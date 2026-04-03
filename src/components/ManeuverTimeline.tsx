"use client";
import { useEffect, useRef } from "react";
import type { SnapshotData } from "@/app/page";

export default function ManeuverTimeline({ snapshot }: { snapshot: SnapshotData | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    if (!snapshot) return;

    const nowMs = new Date(snapshot.timestamp).getTime();
    const windowMs = 3600 * 1000;
    const lx = 100, rx = W - 16;
    const tw = rx - lx;
    const axisY = H - 20;

    // Axis
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx, axisY); ctx.lineTo(rx, axisY); ctx.stroke();

    // Ticks + labels
    ctx.font = "10px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    for (let i = 0; i <= 6; i++) {
      const x = lx + (i / 6) * tw;
      const t = new Date(nowMs + (i / 6) * windowMs);
      ctx.fillText(`${t.getUTCHours().toString().padStart(2, "0")}:${t.getUTCMinutes().toString().padStart(2, "0")}`, x - 10, H - 5);
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, axisY); ctx.stroke();
    }

    // NOW
    ctx.strokeStyle = "rgba(99,102,241,0.6)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(lx, 6); ctx.lineTo(lx, axisY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#818cf8";
    ctx.font = "bold 9px -apple-system, sans-serif";
    ctx.fillText("NOW", lx + 3, 14);

    const warnings = snapshot.active_warnings;
    const sats = [...new Set(warnings.map((w) => w.sat))].slice(0, 5);
    const rowH = Math.max(13, Math.min(18, (axisY - 20) / Math.max(sats.length, 1)));

    sats.forEach((satId, row) => {
      const ry = 18 + row * rowH;

      // Row bg
      ctx.fillStyle = row % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent";
      ctx.fillRect(lx, ry, tw, rowH - 1);

      // Label
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(satId.slice(-12), lx - 6, ry + rowH / 2 + 3);
      ctx.textAlign = "left";

      warnings.filter((w) => w.sat === satId).forEach((w) => {
        const offset = new Date(w.tca).getTime() - nowMs;
        if (offset < 0 || offset > windowMs) return;
        const x = lx + (offset / windowMs) * tw;
        const color = w.miss_km < 0.1 ? "#ef4444" : w.miss_km < 1 ? "#f97316" : "#f59e0b";

        ctx.fillStyle = color + "30";
        ctx.fillRect(x - 4, ry + 1, 8, rowH - 3);
        ctx.fillStyle = color;
        ctx.fillRect(x - 1.5, ry + 1, 3, rowH - 3);

        const label = w.miss_km < 1 ? `${(w.miss_km * 1000).toFixed(0)}m` : `${w.miss_km.toFixed(1)}km`;
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "9px -apple-system, sans-serif";
        ctx.fillText(label, x + 5, ry + rowH / 2 + 3);
      });
    });

    if (sats.length === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No active conjunctions in the next 60 minutes", W / 2, H / 2 - 4);
      ctx.textAlign = "left";
    }
  }, [snapshot]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "8px 14px 0", fontSize: "11px", fontWeight: "600", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Conjunction Timeline  ·  Next 60 min
      </div>
      <canvas ref={canvasRef} width={1400} height={90} style={{ width: "100%", flex: 1, display: "block" }} />
    </div>
  );
}
