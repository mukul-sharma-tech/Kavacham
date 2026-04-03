"use client";
import { useEffect, useRef } from "react";
import type { SnapshotData } from "@/app/page";
import { COOLDOWN_S } from "@/lib/physics/constants";

const WINDOW_MS = 2 * 3600 * 1000;
const COOLDOWN_MS = COOLDOWN_S * 1000;

/** Gantt-style: conjunctions + scheduled burns + 600s cooldown bands (spec §6.2). */
export default function ManeuverTimeline({ snapshot }: { snapshot: SnapshotData | null }) {
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

    if (!snapshot) return;

    const nowMs = new Date(snapshot.timestamp).getTime();
    const endMs = nowMs + WINDOW_MS;
    const lx = 108;
    const rx = W - 12;
    const tw = rx - lx;
    const axisY = H - 18;
    const headerH = 22;

    // Time axis
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx, axisY);
    ctx.lineTo(rx, axisY);
    ctx.stroke();

    const ticks = 8;
    ctx.font = "9px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i <= ticks; i++) {
      const x = lx + (i / ticks) * tw;
      const t = nowMs + (i / ticks) * WINDOW_MS;
      const d = new Date(t);
      ctx.fillText(
        `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`,
        x - 12,
        H - 4
      );
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.beginPath();
      ctx.moveTo(x, headerH);
      ctx.lineTo(x, axisY);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(99,102,241,0.65)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(lx, headerH);
    ctx.lineTo(lx, axisY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#818cf8";
    ctx.font = "bold 9px -apple-system, sans-serif";
    ctx.fillText("NOW", lx + 2, 14);

    const warn = snapshot.active_warnings ?? [];
    const sched = snapshot.scheduled_burns ?? [];
    const sats = new Set<string>();
    warn.forEach((w) => {
      const t = new Date(w.tca).getTime();
      if (t >= nowMs && t <= endMs) sats.add(w.sat);
    });
    sched.forEach((b) => {
      const t = new Date(b.burn_time).getTime();
      if (t >= nowMs && t <= endMs) sats.add(b.satellite_id);
    });
    snapshot.satellites.forEach((s) => {
      if (s.last_burn_iso) {
        const lb = new Date(s.last_burn_iso).getTime();
        if (lb + COOLDOWN_MS >= nowMs && lb <= endMs) sats.add(s.id);
      }
    });

    const rowIds = [...sats].slice(0, 10);
    if (rowIds.length === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No conjunctions or scheduled burns in the next 2 hours", W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }

    const rowH = Math.max(16, Math.min(22, (axisY - headerH - 4) / Math.max(rowIds.length, 1)));

    rowIds.forEach((satId, row) => {
      const ry = headerH + row * rowH;
      ctx.fillStyle = row % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent";
      ctx.fillRect(lx, ry, tw, rowH - 1);

      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(satId.length > 14 ? satId.slice(-14) : satId, lx - 6, ry + rowH / 2 + 3);
      ctx.textAlign = "left";

      const sat = snapshot.satellites.find((s) => s.id === satId);
      if (sat?.last_burn_iso) {
        const burnEnd = new Date(sat.last_burn_iso).getTime();
        const coolStart = burnEnd;
        const coolEnd = burnEnd + COOLDOWN_MS;
        if (coolEnd > nowMs && coolStart < endMs) {
          const x1 = lx + (Math.max(coolStart, nowMs) - nowMs) / WINDOW_MS * tw;
          const x2 = lx + (Math.min(coolEnd, endMs) - nowMs) / WINDOW_MS * tw;
          ctx.fillStyle = "rgba(245,158,11,0.18)";
          ctx.fillRect(x1, ry + 2, Math.max(2, x2 - x1), rowH - 4);
          ctx.fillStyle = "rgba(245,158,11,0.5)";
          ctx.font = "8px -apple-system, sans-serif";
          if (x2 - x1 > 40) ctx.fillText("cooldown", x1 + 3, ry + rowH / 2 + 2);
        }
      }

      sched
        .filter((b) => b.satellite_id === satId)
        .forEach((b) => {
          const t = new Date(b.burn_time).getTime();
          if (t < nowMs || t > endMs) return;
          const x = lx + ((t - nowMs) / WINDOW_MS) * tw;
          const col =
            b.kind === "EVASION"
              ? "#ef4444"
              : b.kind === "RECOVERY"
                ? "#22c55e"
                : b.kind === "STATION_KEEPING"
                  ? "#818cf8"
                  : "#f59e0b";
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, ry + 2);
          ctx.lineTo(x, ry + rowH - 3);
          ctx.stroke();
          ctx.fillStyle = col;
          ctx.font = "8px -apple-system, sans-serif";
          ctx.fillText(b.kind.slice(0, 3), Math.min(x + 3, rx - 28), ry + 11);
        });

      warn
        .filter((w) => w.sat === satId)
        .forEach((w) => {
          const t = new Date(w.tca).getTime();
          if (t < nowMs || t > endMs) return;
          const x = lx + ((t - nowMs) / WINDOW_MS) * tw;
          const color = w.miss_km < 0.1 ? "#ef4444" : w.miss_km < 1 ? "#f97316" : "#f59e0b";
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(x, ry + rowH - 3);
          ctx.lineTo(x - 5, ry + 5);
          ctx.lineTo(x + 5, ry + 5);
          ctx.closePath();
          ctx.fill();
        });
    });

    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = "8px -apple-system, sans-serif";
    ctx.fillText("△ TCA  ·  │ burn  ·  orange = thruster cooldown (600s)", lx, H - 2);
  }, [snapshot]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "6px 14px 0", fontSize: "11px", fontWeight: "600", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Maneuver Gantt · 2h · cooldown {COOLDOWN_S}s
      </div>
      <canvas ref={canvasRef} width={1400} height={132} style={{ width: "100%", flex: 1, display: "block", minHeight: "110px" }} />
    </div>
  );
}
