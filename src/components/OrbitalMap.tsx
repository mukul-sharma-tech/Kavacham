"use client";
import { useEffect, useRef } from "react";
import type { SnapshotData } from "@/app/page";
import { getTerminatorPoints } from "@/lib/physics/terminator";

interface Props {
  snapshot: SnapshotData | null;
  selectedSat: string | null;
  onSelectSat: (id: string) => void;
}

function mX(lon: number, w: number) { return ((lon + 180) / 360) * w; }
function mY(lat: number, h: number) {
  const r = (lat * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + r / 2));
  return h / 2 - (y * h) / (2 * Math.PI);
}

const GS = [
  { name: "ISTRAC", lat: 13.03, lon: 77.52 },
  { name: "Svalbard", lat: 78.23, lon: 15.41 },
  { name: "Goldstone", lat: 35.43, lon: -116.89 },
  { name: "Punta Arenas", lat: -53.15, lon: -70.92 },
  { name: "IIT Delhi", lat: 28.55, lon: 77.19 },
  { name: "McMurdo", lat: -77.85, lon: 166.67 },
];

const prevAlts = new Map<string, number>();
const fireFrames = new Map<string, number>();

export default function OrbitalMap({ snapshot, selectedSat, onSelectSat }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const frameCount = useRef(0);
  const snapRef = useRef<SnapshotData | null>(null);
  const selRef = useRef<string | null>(null);

  useEffect(() => { snapRef.current = snapshot; }, [snapshot]);
  useEffect(() => { selRef.current = selectedSat; }, [selectedSat]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      frameCount.current++;
      const snap = snapRef.current;
      const sel = selRef.current;
      const W = canvas!.width, H = canvas!.height;

      // Background
      ctx!.fillStyle = "#0f1117";
      ctx!.fillRect(0, 0, W, H);

      // Terminator
      const tsMs = snap ? new Date(snap.timestamp).getTime() : Date.now();
      const termPts = getTerminatorPoints(tsMs, 360);
      if (termPts.length > 0) {
        ctx!.save();
        ctx!.beginPath();
        let started = false;
        for (const pt of termPts) {
          const x = mX(pt.lon, W), y = mY(Math.max(-85, Math.min(85, pt.lat)), H);
          if (!started) { ctx!.moveTo(x, y); started = true; } else ctx!.lineTo(x, y);
        }
        ctx!.lineTo(W, H); ctx!.lineTo(0, H); ctx!.closePath();
        ctx!.fillStyle = "rgba(0,0,30,0.4)"; ctx!.fill();
        ctx!.beginPath(); started = false;
        for (const pt of termPts) {
          const x = mX(pt.lon, W), y = mY(Math.max(-85, Math.min(85, pt.lat)), H);
          if (!started) { ctx!.moveTo(x, y); started = true; } else ctx!.lineTo(x, y);
        }
        ctx!.strokeStyle = "rgba(255,200,80,0.5)"; ctx!.lineWidth = 1.5;
        ctx!.setLineDash([6, 4]); ctx!.stroke(); ctx!.setLineDash([]); ctx!.restore();
      }

      // Grid
      for (let lat = -75; lat <= 75; lat += 15) {
        const y = mY(lat, H); if (y < 0 || y > H) continue;
        ctx!.strokeStyle = lat === 0 ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.04)";
        ctx!.lineWidth = lat === 0 ? 1 : 0.5;
        ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(W, y); ctx!.stroke();
      }
      for (let lon = -180; lon <= 180; lon += 30) {
        const x = mX(lon, W);
        ctx!.strokeStyle = lon === 0 ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.04)";
        ctx!.lineWidth = lon === 0 ? 1 : 0.5;
        ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, H); ctx!.stroke();
      }
      ctx!.font = "10px system-ui"; ctx!.fillStyle = "rgba(255,255,255,0.15)";
      for (let lat = -60; lat <= 60; lat += 30) { if (!lat) continue; ctx!.fillText(lat + "°", 4, mY(lat, H) - 3); }
      for (let lon = -150; lon <= 150; lon += 60) { ctx!.fillText(lon + "°", mX(lon, W) + 3, H - 6); }

      if (!snap) {
        ctx!.fillStyle = "rgba(255,255,255,0.25)"; ctx!.font = "bold 14px system-ui";
        ctx!.textAlign = "center"; ctx!.fillText("Click  \"Load Scenario\"  to begin", W / 2, H / 2);
        ctx!.textAlign = "left"; return;
      }

      // Ground stations
      for (const gs of GS) {
        const x = mX(gs.lon, W), y = mY(gs.lat, H);
        const g = ctx!.createRadialGradient(x, y, 0, x, y, 28);
        g.addColorStop(0, "rgba(59,130,246,0.15)"); g.addColorStop(1, "transparent");
        ctx!.fillStyle = g; ctx!.beginPath(); ctx!.arc(x, y, 28, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = "#3b82f6"; ctx!.beginPath(); ctx!.arc(x, y, 3, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = "rgba(255,255,255,0.35)"; ctx!.font = "9px system-ui"; ctx!.fillText(gs.name, x + 5, y + 3);
      }

      // Debris — red pulsing dots
      for (const [, lat, lon] of snap.debris_cloud) {
        const x = mX(lon as number, W), y = mY(lat as number, H);
        if (y < 0 || y > H) continue;
        const pulse = 0.5 + 0.4 * Math.sin(frameCount.current * 0.05 + x * 0.01);
        ctx!.fillStyle = `rgba(239,68,68,${pulse})`;
        ctx!.beginPath(); ctx!.arc(x, y, 3, 0, Math.PI * 2); ctx!.fill();
      }

      // Predicted tracks
      for (const sat of snap.satellites) {
        if (!sat.predicted_track?.length) continue;
        const isEv = sat.status === "EVADING";
        const col = isEv ? "#ef4444" : sat.status === "RECOVERING" ? "#f59e0b" : "#22c55e";
        ctx!.strokeStyle = col + (isEv ? "70" : "30"); ctx!.lineWidth = isEv ? 1.5 : 1;
        ctx!.setLineDash([4, 5]); ctx!.beginPath();
        ctx!.moveTo(mX(sat.lon, W), mY(sat.lat, H));
        for (const [plat, plon] of sat.predicted_track) ctx!.lineTo(mX(plon, W), mY(plat, H));
        ctx!.stroke(); ctx!.setLineDash([]);
      }

      // Warning rings
      for (const w of snap.active_warnings.slice(0, 20)) {
        const sat = snap.satellites.find((s) => s.id === w.sat); if (!sat) continue;
        const sx = mX(sat.lon, W), sy = mY(sat.lat, H);
        const pulse = 0.5 + 0.5 * Math.sin(frameCount.current * 0.15);
        ctx!.strokeStyle = w.miss_km < 0.1 ? `rgba(239,68,68,${0.6 + pulse * 0.4})` : `rgba(245,158,11,${0.4 + pulse * 0.3})`;
        ctx!.lineWidth = w.miss_km < 0.1 ? 2.5 : 1.5;
        ctx!.setLineDash(w.miss_km < 0.1 ? [] : [4, 4]);
        ctx!.beginPath(); ctx!.arc(sx, sy, 22, 0, Math.PI * 2); ctx!.stroke(); ctx!.setLineDash([]);
        if (w.miss_km < 0.1) {
          ctx!.fillStyle = `rgba(239,68,68,${0.15 + pulse * 0.1})`;
          ctx!.beginPath(); ctx!.arc(sx, sy, 22, 0, Math.PI * 2); ctx!.fill();
        }
      }

      // Satellites — big green dots with fire animation
      for (const sat of snap.satellites) {
        const x = mX(sat.lon, W), y = mY(sat.lat, H);
        if (y < 0 || y > H) continue;
        const isSel = sat.id === sel;
        const isEv = sat.status === "EVADING", isRec = sat.status === "RECOVERING";
        const color = isEv ? "#ef4444" : isRec ? "#f59e0b" : "#22c55e";
        const size = isSel ? 11 : isEv ? 10 : 8;

        // Orbit shift arrow
        const prevAlt = prevAlts.get(sat.id);
        if (prevAlt !== undefined && Math.abs(prevAlt - sat.alt) > 0.3) {
          const up = sat.alt > prevAlt, dy = up ? -22 : 22;
          ctx!.strokeStyle = up ? "#22c55e" : "#f59e0b"; ctx!.lineWidth = 2.5;
          ctx!.beginPath(); ctx!.moveTo(x, y); ctx!.lineTo(x, y + dy); ctx!.stroke();
          ctx!.fillStyle = up ? "#22c55e" : "#f59e0b"; ctx!.beginPath();
          ctx!.moveTo(x, y + dy + (up ? -6 : 6)); ctx!.lineTo(x - 5, y + dy + (up ? 4 : -4)); ctx!.lineTo(x + 5, y + dy + (up ? 4 : -4));
          ctx!.closePath(); ctx!.fill();
          ctx!.font = "bold 10px system-ui"; ctx!.fillStyle = up ? "#22c55e" : "#f59e0b";
          ctx!.fillText(up ? "↑ ORBIT RAISED" : "↓ ORBIT LOWERED", x + 8, y + dy / 2 + 4);
        }
        prevAlts.set(sat.id, sat.alt);

        // Fire particles
        if (isEv) {
          const ff = (fireFrames.get(sat.id) ?? 0) + 1; fireFrames.set(sat.id, ff);
          for (let p = 0; p < 10; p++) {
            const angle = (p / 10) * Math.PI * 2 + ff * 0.2;
            const dist = 12 + Math.sin(ff * 0.15 + p * 1.2) * 7;
            const px = x + Math.cos(angle) * dist, py = y + Math.sin(angle) * dist;
            const alpha = 0.6 + 0.4 * Math.abs(Math.sin(ff * 0.1 + p));
            ctx!.fillStyle = `rgba(255,${Math.floor(60 + p * 18)},0,${alpha})`;
            ctx!.beginPath(); ctx!.arc(px, py, 3, 0, Math.PI * 2); ctx!.fill();
          }
          const fr = 18 + 6 * Math.sin(ff * 0.15);
          ctx!.strokeStyle = `rgba(255,80,0,${0.6 + 0.3 * Math.sin(ff * 0.12)})`; ctx!.lineWidth = 2.5;
          ctx!.beginPath(); ctx!.arc(x, y, fr, 0, Math.PI * 2); ctx!.stroke();
        } else { fireFrames.delete(sat.id); }

        // Glow
        const gr = ctx!.createRadialGradient(x, y, 0, x, y, size * 3);
        gr.addColorStop(0, color + "55"); gr.addColorStop(1, "transparent");
        ctx!.fillStyle = gr; ctx!.beginPath(); ctx!.arc(x, y, size * 3, 0, Math.PI * 2); ctx!.fill();

        // Core
        ctx!.fillStyle = color; ctx!.shadowColor = color; ctx!.shadowBlur = isSel ? 24 : 14;
        ctx!.beginPath(); ctx!.arc(x, y, size, 0, Math.PI * 2); ctx!.fill(); ctx!.shadowBlur = 0;

        // Selection
        if (isSel) {
          ctx!.strokeStyle = color; ctx!.lineWidth = 2;
          ctx!.beginPath(); ctx!.arc(x, y, size + 7, 0, Math.PI * 2); ctx!.stroke();
          const tx = Math.min(x + 14, W - 160), ty = Math.max(y - 14, 4);
          ctx!.fillStyle = "rgba(10,12,20,0.95)"; ctx!.beginPath(); ctx!.roundRect(tx, ty, 155, 56, 7); ctx!.fill();
          ctx!.strokeStyle = "rgba(99,102,241,0.5)"; ctx!.lineWidth = 1; ctx!.stroke();
          ctx!.fillStyle = "#e8eaf0"; ctx!.font = "bold 12px system-ui"; ctx!.fillText(sat.id, tx + 9, ty + 17);
          ctx!.fillStyle = "rgba(255,255,255,0.5)"; ctx!.font = "10px system-ui";
          ctx!.fillText(`Alt: ${sat.alt.toFixed(0)} km  ·  Fuel: ${sat.fuel_kg.toFixed(2)} kg`, tx + 9, ty + 32);
          ctx!.fillStyle = color; ctx!.font = "bold 10px system-ui"; ctx!.fillText(sat.status, tx + 9, ty + 47);
        }

        // Label for all sats
        if (!isSel) {
          ctx!.fillStyle = "rgba(255,255,255,0.5)"; ctx!.font = "9px system-ui";
          ctx!.fillText(sat.id, x + size + 3, y + 3);
        }
      }

      // Legend
      const lx = W - 178, ly = H - 130;
      ctx!.fillStyle = "rgba(10,12,20,0.92)"; ctx!.beginPath(); ctx!.roundRect(lx, ly, 170, 122, 8); ctx!.fill();
      ctx!.strokeStyle = "rgba(255,255,255,0.07)"; ctx!.lineWidth = 1; ctx!.stroke();
      ctx!.fillStyle = "rgba(255,255,255,0.4)"; ctx!.font = "bold 9px system-ui"; ctx!.fillText("LEGEND", lx + 10, ly + 14);
      [
        { c: "#22c55e", l: "Satellite — Nominal", r: 6 },
        { c: "#f59e0b", l: "Satellite — Recovering", r: 6 },
        { c: "#ef4444", l: "Satellite — EVADING 🔥", r: 6 },
        { c: "#ef4444", l: "Debris", r: 3 },
        { c: "#3b82f6", l: "Ground Station", r: 3 },
      ].forEach((item, i) => {
        const iy = ly + 26 + i * 18;
        ctx!.fillStyle = item.c; ctx!.beginPath(); ctx!.arc(lx + 12, iy, item.r, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = "rgba(255,255,255,0.65)"; ctx!.font = "10px system-ui"; ctx!.fillText(item.l, lx + 22, iy + 4);
      });
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current, snap = snapRef.current;
    if (!canvas || !snap) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    for (const sat of snap.satellites) {
      if (Math.hypot(mx - mX(sat.lon, canvas.width), my - mY(sat.lat, canvas.height)) < 16) {
        onSelectSat(sat.id); return;
      }
    }
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div style={{ position: "absolute", top: "10px", left: "12px", zIndex: 10, fontSize: "11px", color: "rgba(255,255,255,0.3)", display: "flex", gap: "14px" }}>
        <span>Ground Track · Mercator</span>
        <span style={{ color: "rgba(34,197,94,0.8)" }}>● Satellites</span>
        <span style={{ color: "rgba(239,68,68,0.8)" }}>● Debris</span>
        <span style={{ color: "rgba(255,200,80,0.6)" }}>◐ Day/Night</span>
      </div>
      <canvas ref={canvasRef} width={1100} height={620}
        style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
        onClick={handleClick} />
    </div>
  );
}
