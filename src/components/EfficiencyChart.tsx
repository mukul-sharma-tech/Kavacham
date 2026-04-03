"use client";
import { useEffect, useRef } from "react";
import type { SnapshotData } from "@/app/page";

/** Fuel / Δv vs evasion-style avoidance count (spec §6.2). */
export default function EfficiencyChart({ snapshot }: { snapshot: SnapshotData | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    const st = snapshot?.stats;
    if (!st) {
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Load scenario for efficiency metrics", W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }

    const dv = st.total_dv_ms ?? 0;
    const fuel = st.fuel_consumed_kg ?? 0;
    const avoided = st.collisions_avoided ?? 0;

    const maxBar = Math.max(dv, fuel * 15, avoided * 20, 10);
    const bw = (W - 56) / 3;
    const base = H - 26;
    const bhMax = H - 40;

    const drawBar = (i: number, label: string, value: number, display: string, color: string) => {
      const x = 16 + i * (bw + 10);
      const h = Math.min(bhMax, (value / maxBar) * bhMax);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x, base - bhMax, bw, bhMax);
      ctx.fillStyle = color;
      ctx.fillRect(x, base - h, bw, h);
      ctx.fillStyle = "#e8eaf0";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(display, x + bw / 2, base - bhMax - 4);
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.font = "9px system-ui";
      ctx.fillText(label, x + bw / 2, H - 8);
      ctx.textAlign = "left";
    };

    drawBar(0, "Total Δv (m/s)", dv, dv.toFixed(2), "#818cf8");
    drawBar(1, "Propellant spent (kg)", fuel * 15, fuel.toFixed(3), "#10b981");
    drawBar(2, "Avoidance burns", avoided * 20, String(avoided), "#f59e0b");

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "9px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("Resource cost vs avoidance actions (fleet)", 8, 12);
  }, [snapshot]);

  return (
    <div style={{ width: "100%", height: "100%", minHeight: "120px" }}>
      <canvas ref={canvasRef} width={520} height={118} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
