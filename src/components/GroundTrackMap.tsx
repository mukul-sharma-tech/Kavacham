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

// Per-satellite animation state
interface SatAnim {
  prevLat: number; prevLon: number; prevAlt: number;
  curLat: number; curLon: number; curAlt: number;
  fireTimer: number;       // frames remaining for fire effect
  orbitShiftTimer: number; // frames remaining for orbit shift arrow
  orbitShiftUp: boolean;
  trail: Array<[number, number]>; // last N positions
}

const satAnims = new Map<string, SatAnim>();
const fireParticles: Array<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }> = [];

export default function GroundTrackMap({ snapshot, selectedSat, onSelectSat }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const frameCount = useRef(0);
  const snapshotRef = useRef<SnapshotData | null>(null);
  const prevSnapshotRef = useRef<SnapshotData | null>(null);
  const selectedRef = useRef<string | null>(null);
  const lastSnapshotTime = useRef(Date.now());

  useEffect(() => {
    if (snapshot) {
      prevSnapshotRef.current = snapshotRef.current;
      snapshotRef.current = snapshot;
      lastSnapshotTime.current = Date.now();

      // Update satellite animation states
      for (const sat of snapshot.satellites) {
        const prev = satAnims.get(sat.id);
        const prevSnap = prevSnapshotRef.current?.satellites.find(s => s.id === sat.id);

        if (!prev) {
          satAnims.set(sat.id, {
            prevLat: sat.lat, prevLon: sat.lon, prevAlt: sat.alt,
            curLat: sat.lat, curLon: sat.lon, curAlt: sat.alt,
            fireTimer: 0, orbitShiftTimer: 0, orbitShiftUp: true,
            trail: [[sat.lat, sat.lon]],
          });
        } else {
          const altChanged = prevSnap && Math.abs(prevSnap.alt - sat.alt) > 1.2;
          const isEvading = sat.status === "EVADING";

          // Trigger fire effect when evading starts or altitude changes
          if (isEvading || altChanged) {
            prev.fireTimer = 90; // 90 frames = ~1.5 seconds of fire
            // Spawn burst particles
            const cx = mX(sat.lon, 1100), cy = mY(sat.lat, 580);
            for (let p = 0; p < 20; p++) {
              const angle = Math.random() * Math.PI * 2;
              const speed = 1.5 + Math.random() * 3;
              fireParticles.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0, maxLife: 30 + Math.random() * 40,
                size: 3 + Math.random() * 5,
              });
            }
          }

          if (altChanged && prevSnap) {
            prev.orbitShiftTimer = 120; // show arrow for 2 seconds
            prev.orbitShiftUp = sat.alt > prevSnap.alt;
          }

          // Update trail
          prev.trail.push([sat.lat, sat.lon]);
          if (prev.trail.length > 30) prev.trail.shift();

          prev.prevLat = prev.curLat; prev.prevLon = prev.curLon; prev.prevAlt = prev.curAlt;
          prev.curLat = sat.lat; prev.curLon = sat.lon; prev.curAlt = sat.alt;
        }
      }
    }
  }, [snapshot]);

  useEffect(() => { selectedRef.current = selectedSat; }, [selectedSat]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      frameCount.current++;
      const snap = snapshotRef.current;
      const selSat = selectedRef.current;
      const W = canvas!.width, H = canvas!.height;

      // Interpolation factor between last two snapshots (0-1)
      const elapsed = Date.now() - lastSnapshotTime.current;
      const t = Math.min(1, elapsed / 500); // 500ms poll interval

      ctx!.fillStyle = "#0d1117";
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
        ctx!.fillStyle = "rgba(0,0,20,0.38)"; ctx!.fill();
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
        ctx!.strokeStyle = lat === 0 ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.04)";
        ctx!.lineWidth = lat === 0 ? 1 : 0.5;
        ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(W, y); ctx!.stroke();
      }
      for (let lon = -180; lon <= 180; lon += 30) {
        const x = mX(lon, W);
        ctx!.strokeStyle = lon === 0 ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.04)";
        ctx!.lineWidth = lon === 0 ? 1 : 0.5;
        ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, H); ctx!.stroke();
      }
      ctx!.font = "10px sans-serif"; ctx!.fillStyle = "rgba(255,255,255,0.15)";
      for (let lat = -60; lat <= 60; lat += 30) { if (lat !== 0) ctx!.fillText(lat + "deg", 4, mY(lat, H) - 3); }
      for (let lon = -150; lon <= 150; lon += 60) { ctx!.fillText(lon + "deg", mX(lon, W) + 3, H - 6); }

      if (!snap) {
        ctx!.fillStyle = "rgba(255,255,255,0.3)"; ctx!.font = "bold 14px sans-serif";
        ctx!.textAlign = "center"; ctx!.fillText("Select satellite count and click Load to begin", W / 2, H / 2);
        ctx!.textAlign = "left"; return;
      }

      // Debris — RED pulsing dots
      for (const [, lat, lon] of snap.debris_cloud) {
        const x = mX(lon as number, W), y = mY(lat as number, H);
        if (y < 0 || y > H) continue;
        const pulse = 0.55 + 0.35 * Math.sin(frameCount.current * 0.04 + x * 0.008);
        ctx!.fillStyle = "rgba(239,68,68," + pulse + ")";
        ctx!.beginPath(); ctx!.arc(x, y, 3, 0, Math.PI * 2); ctx!.fill();
      }

      // Ground stations
      for (const gs of GS) {
        const x = mX(gs.lon, W), y = mY(gs.lat, H);
        const grad = ctx!.createRadialGradient(x, y, 0, x, y, 30);
        grad.addColorStop(0, "rgba(59,130,246,0.15)"); grad.addColorStop(1, "transparent");
        ctx!.fillStyle = grad; ctx!.beginPath(); ctx!.arc(x, y, 30, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = "#3b82f6"; ctx!.beginPath(); ctx!.arc(x, y, 3.5, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = "rgba(255,255,255,0.4)"; ctx!.font = "9px sans-serif"; ctx!.fillText(gs.name, x + 5, y + 3);
      }

      // Warning rings
      for (const w of snap.active_warnings.slice(0, 30)) {
        const sat = snap.satellites.find(s => s.id === w.sat); if (!sat) continue;
        const sx = mX(sat.lon, W), sy = mY(sat.lat, H);
        const pulse = 0.5 + 0.5 * Math.sin(frameCount.current * 0.12);
        ctx!.strokeStyle = w.miss_km < 0.1 ? "rgba(239,68,68," + (0.6 + pulse * 0.4) + ")" : "rgba(245,158,11," + (0.4 + pulse * 0.3) + ")";
        ctx!.lineWidth = w.miss_km < 0.1 ? 2.5 : 1.5; ctx!.setLineDash(w.miss_km < 0.1 ? [] : [4, 4]);
        ctx!.beginPath(); ctx!.arc(sx, sy, 22, 0, Math.PI * 2); ctx!.stroke(); ctx!.setLineDash([]);
      }

      // Update and draw fire particles (global)
      const alive = [];
      for (const p of fireParticles) {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.94; p.vy *= 0.94;
        p.life++;
        const lt = p.life / p.maxLife;
        const alpha = (1 - lt) * 0.9;
        const g = Math.floor(200 * (1 - lt));
        ctx!.fillStyle = "rgba(255," + g + ",0," + alpha + ")";
        ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size * (1 - lt * 0.5), 0, Math.PI * 2); ctx!.fill();
        if (p.life < p.maxLife) alive.push(p);
      }
      fireParticles.length = 0; fireParticles.push(...alive);

      // Satellites — with smooth interpolation + trail + fire
      for (const sat of snap.satellites) {
        const anim = satAnims.get(sat.id);
        const isEv = sat.status === "EVADING", isRec = sat.status === "RECOVERING";
        const color = isEv ? "#ef4444" : isRec ? "#f59e0b" : "#22c55e";
        const isSel = sat.id === selSat;

        // Interpolated position
        let lat = sat.lat, lon = sat.lon;
        if (anim) {
          lat = anim.prevLat + (anim.curLat - anim.prevLat) * t;
          lon = anim.prevLon + (anim.curLon - anim.prevLon) * t;
        }
        const x = mX(lon, W), y = mY(lat, H);
        if (y < 0 || y > H) continue;

        // Draw orbit trail
        if (anim && anim.trail.length > 1) {
          ctx!.strokeStyle = color + "50";
          ctx!.lineWidth = 1.5;
          ctx!.beginPath();
          ctx!.moveTo(mX(anim.trail[0][1], W), mY(anim.trail[0][0], H));
          for (let i = 1; i < anim.trail.length; i++) {
            ctx!.lineTo(mX(anim.trail[i][1], W), mY(anim.trail[i][0], H));
          }
          ctx!.stroke();
        }

        // Predicted track
        if (sat.predicted_track?.length) {
          ctx!.strokeStyle = color + (isEv ? "80" : "30");
          ctx!.lineWidth = isEv ? 2 : 1;
          ctx!.setLineDash([4, 5]);
          ctx!.beginPath(); ctx!.moveTo(x, y);
          for (const [plat, plon] of sat.predicted_track) ctx!.lineTo(mX(plon, W), mY(plat, H));
          ctx!.stroke(); ctx!.setLineDash([]);
        }

        // Orbit shift arrow — BIG and visible
        if (anim && anim.orbitShiftTimer > 0) {
          anim.orbitShiftTimer--;
          const alpha = Math.min(1, anim.orbitShiftTimer / 30);
          const up = anim.orbitShiftUp;
          const arrowColor = up ? "#22c55e" : "#f59e0b";
          const dy = up ? -35 : 35;

          // Arrow shaft
          ctx!.strokeStyle = arrowColor.replace(")", "," + alpha + ")").replace("rgb", "rgba").replace("#22c55e", "rgba(34,197,94," + alpha + ")").replace("#f59e0b", "rgba(245,158,11," + alpha + ")");
          ctx!.lineWidth = 3;
          ctx!.beginPath(); ctx!.moveTo(x, y + (up ? 8 : -8)); ctx!.lineTo(x, y + dy); ctx!.stroke();

          // Arrowhead
          ctx!.fillStyle = up ? "rgba(34,197,94," + alpha + ")" : "rgba(245,158,11," + alpha + ")";
          ctx!.beginPath();
          ctx!.moveTo(x, y + dy + (up ? -8 : 8));
          ctx!.lineTo(x - 8, y + dy + (up ? 6 : -6));
          ctx!.lineTo(x + 8, y + dy + (up ? 6 : -6));
          ctx!.closePath(); ctx!.fill();

          // Label
          ctx!.font = "bold 11px sans-serif";
          ctx!.fillStyle = up ? "rgba(34,197,94," + alpha + ")" : "rgba(245,158,11," + alpha + ")";
          ctx!.fillText(up ? "ORBIT RAISED" : "ORBIT LOWERED", x + 10, y + dy / 2);
        }

        // Continuous fire effect while evading
        if (anim && anim.fireTimer > 0) {
          anim.fireTimer--;
          // Spawn new particles each frame
          if (frameCount.current % 2 === 0) {
            for (let p = 0; p < 4; p++) {
              const angle = Math.random() * Math.PI * 2;
              const speed = 0.8 + Math.random() * 1.5;
              fireParticles.push({
                x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                life: 0, maxLife: 20 + Math.random() * 25, size: 2 + Math.random() * 4,
              });
            }
          }
          // Pulsing ring
          const fr = 20 + 8 * Math.sin(frameCount.current * 0.2);
          const fa = 0.4 + 0.4 * Math.sin(frameCount.current * 0.15);
          ctx!.strokeStyle = "rgba(255,80,0," + fa + ")";
          ctx!.lineWidth = 3;
          ctx!.beginPath(); ctx!.arc(x, y, fr, 0, Math.PI * 2); ctx!.stroke();
        }

        // Glow
        const size = isSel ? 11 : isEv ? 10 : 8;
        const glowR = size * 3;
        const glow = ctx!.createRadialGradient(x, y, 0, x, y, glowR);
        glow.addColorStop(0, color + "70"); glow.addColorStop(1, "transparent");
        ctx!.fillStyle = glow; ctx!.beginPath(); ctx!.arc(x, y, glowR, 0, Math.PI * 2); ctx!.fill();

        // Core dot
        ctx!.fillStyle = color; ctx!.shadowColor = color; ctx!.shadowBlur = isSel ? 24 : 16;
        ctx!.beginPath(); ctx!.arc(x, y, size, 0, Math.PI * 2); ctx!.fill(); ctx!.shadowBlur = 0;

        // Selection ring + tooltip
        if (isSel) {
          ctx!.strokeStyle = color; ctx!.lineWidth = 2.5;
          ctx!.beginPath(); ctx!.arc(x, y, size + 8, 0, Math.PI * 2); ctx!.stroke();
          const tx = Math.min(x + 18, W - 162), ty = Math.max(y - 14, 4);
          ctx!.fillStyle = "rgba(10,12,20,0.96)"; ctx!.beginPath(); ctx!.roundRect(tx, ty, 155, 58, 7); ctx!.fill();
          ctx!.strokeStyle = "rgba(99,102,241,0.7)"; ctx!.lineWidth = 1; ctx!.stroke();
          ctx!.fillStyle = "#e8eaf0"; ctx!.font = "bold 12px sans-serif"; ctx!.fillText(sat.id, tx + 9, ty + 18);
          ctx!.fillStyle = "rgba(255,255,255,0.55)"; ctx!.font = "10px sans-serif";
          ctx!.fillText("Alt: " + sat.alt.toFixed(0) + " km  Fuel: " + sat.fuel_kg.toFixed(3) + " kg", tx + 9, ty + 33);
          ctx!.fillStyle = color; ctx!.font = "bold 10px sans-serif"; ctx!.fillText(sat.status, tx + 9, ty + 48);
        }

        // ID label
        if (snap.satellites.length <= 15 && !isSel) {
          ctx!.fillStyle = "rgba(255,255,255,0.6)"; ctx!.font = "9px sans-serif";
          ctx!.fillText(sat.id.slice(-6), x + size + 3, y + 3);
        }
      }

      // Legend
      const lx = W - 175, ly = H - 120;
      ctx!.fillStyle = "rgba(10,12,20,0.92)"; ctx!.beginPath(); ctx!.roundRect(lx, ly, 167, 112, 8); ctx!.fill();
      ctx!.strokeStyle = "rgba(255,255,255,0.07)"; ctx!.lineWidth = 1; ctx!.stroke();
      ctx!.fillStyle = "rgba(255,255,255,0.4)"; ctx!.font = "bold 9px sans-serif"; ctx!.fillText("LEGEND", lx + 10, ly + 14);
      [
        { c: "#22c55e", l: "Satellite - Nominal", big: true },
        { c: "#f59e0b", l: "Satellite - Recovering", big: true },
        { c: "#ef4444", l: "Satellite - EVADING", big: true },
        { c: "#ef4444", l: "Debris (red dots)", big: false },
        { c: "#3b82f6", l: "Ground Station", big: false },
      ].forEach((item, i) => {
        const iy = ly + 26 + i * 17;
        ctx!.fillStyle = item.c; ctx!.beginPath(); ctx!.arc(lx + 12, iy, item.big ? 6 : 3, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = "rgba(255,255,255,0.65)"; ctx!.font = "10px sans-serif"; ctx!.fillText(item.l, lx + 22, iy + 4);
      });
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current, snap = snapshotRef.current;
    if (!canvas || !snap) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    for (const sat of snap.satellites) {
      if (Math.hypot(mx - mX(sat.lon, canvas.width), my - mY(sat.lat, canvas.height)) < 18) {
        onSelectSat(sat.id); return;
      }
    }
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div style={{ position: "absolute", top: "10px", left: "12px", zIndex: 10, fontSize: "11px", color: "rgba(255,255,255,0.3)", display: "flex", alignItems: "center", gap: "14px" }}>
        <span>Ground Track</span>
        <span style={{ color: "rgba(34,197,94,0.8)" }}>Green = Satellites</span>
        <span style={{ color: "rgba(239,68,68,0.8)" }}>Red = Debris</span>
        <span style={{ color: "rgba(255,200,80,0.6)" }}>Yellow = Terminator</span>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>Click to select</span>
      </div>
      <canvas ref={canvasRef} width={1100} height={580}
        style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
        onClick={handleClick} />
    </div>
  );
}