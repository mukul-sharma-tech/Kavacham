"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import type { SnapshotData } from "@/app/page";

interface Props {
  snapshot: SnapshotData | null;
  selectedSat: string | null;
  onSelectSat: (id: string) => void;
}

const RE_DISPLAY = 1.0;
const ALT_EXAGGERATION = 8.0; // exaggerate altitude differences for visibility

function latLonAltToVec3(lat: number, lon: number, altKm: number): THREE.Vector3 {
  // Exaggerate altitude so orbit shifts are clearly visible
  const r = RE_DISPLAY + (altKm / 6378.137) * RE_DISPLAY * ALT_EXAGGERATION;
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

// Thruster fire particle system
interface FireParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export default function Globe3D({ snapshot, selectedSat, onSelectSat }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const earthRef = useRef<THREE.Mesh | null>(null);
  const satGroupRef = useRef<THREE.Group | null>(null);
  const debrisGroupRef = useRef<THREE.Group | null>(null);
  const trailGroupRef = useRef<THREE.Group | null>(null);
  const fireGroupRef = useRef<THREE.Group | null>(null);
  const frameRef = useRef<number>(0);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const cameraAngle = useRef({ theta: 0, phi: Math.PI / 4 });
  const cameraRadius = useRef(3.2);
  const fireParticles = useRef<FireParticle[]>([]);
  const prevBurnCount = useRef(0);
  const prevEvadingSats = useRef<Set<string>>(new Set());
  const snapshotRef = useRef<SnapshotData | null>(null);
  const orbitRingGroupRef = useRef<THREE.Group | null>(null);
  const prevSatAlts = useRef<Map<string, number>>(new Map());
  const burnFlashRef = useRef<Map<string, number>>(new Map()); // satId -> flash timer

  // Keep snapshot ref in sync for animation loop
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020b18);
    sceneRef.current = scene;

    // Stars
    const starVerts: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      const r = 8 + Math.random() * 4;
      starVerts.push(r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t));
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starVerts, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.012, transparent: true, opacity: 0.8 })));

    // Camera
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.01, 100);
    camera.position.set(0, 1.5, 2.8);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    scene.add(new THREE.AmbientLight(0x334466, 1.0));
    const sun = new THREE.DirectionalLight(0xfff5e0, 3.0);
    sun.position.set(5, 3, 5);
    scene.add(sun);

    // Earth
    const earthGeo = new THREE.SphereGeometry(RE_DISPLAY, 64, 64);
    const earthMat = new THREE.MeshPhongMaterial({
      color: 0x1a4a8a, emissive: 0x0a1a3a, specular: 0x224488, shininess: 20,
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earth);
    earthRef.current = earth;

    // Atmosphere
    const atmGeo = new THREE.SphereGeometry(RE_DISPLAY * 1.025, 32, 32);
    scene.add(new THREE.Mesh(atmGeo, new THREE.MeshPhongMaterial({
      color: 0x4488ff, transparent: true, opacity: 0.07, side: THREE.FrontSide,
    })));

    // Grid
    const gridMat = new THREE.LineBasicMaterial({ color: 0x1a3a6a, transparent: true, opacity: 0.25 });
    for (let lat = -75; lat <= 75; lat += 15) {
      const pts: THREE.Vector3[] = [];
      for (let lon = 0; lon <= 360; lon += 4) pts.push(latLonAltToVec3(lat, lon - 180, 8));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    for (let lon = -180; lon <= 180; lon += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lat = -85; lat <= 85; lat += 4) pts.push(latLonAltToVec3(lat, lon, 8));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }

    // Groups
    const satGroup = new THREE.Group();
    const debrisGroup = new THREE.Group();
    const trailGroup = new THREE.Group();
    const fireGroup = new THREE.Group();
    const orbitRingGroup = new THREE.Group();
    scene.add(satGroup, debrisGroup, trailGroup, fireGroup, orbitRingGroup);
    satGroupRef.current = satGroup;
    debrisGroupRef.current = debrisGroup;
    trailGroupRef.current = trailGroup;
    fireGroupRef.current = fireGroup;
    orbitRingGroupRef.current = orbitRingGroup;

    // Resize
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    // Mouse
    const onMouseDown = (e: MouseEvent) => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; };
    const onMouseUp = () => { isDragging.current = false; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      cameraAngle.current.theta -= (e.clientX - lastMouse.current.x) * 0.005;
      cameraAngle.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraAngle.current.phi + (e.clientY - lastMouse.current.y) * 0.005));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onWheel = (e: WheelEvent) => {
      cameraRadius.current = Math.max(1.4, Math.min(8, cameraRadius.current + e.deltaY * 0.002));
    };
    mount.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("wheel", onWheel);

    // Animation loop — handles fire particles
    let earthRot = 0;
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      earthRot += 0.0004;
      if (earthRef.current) earthRef.current.rotation.y = earthRot;

      // Spawn fire particles for evading satellites
      const snap = snapshotRef.current;
      if (snap && fireGroupRef.current) {
        const evading = snap.satellites.filter((s) => s.status === "EVADING");
        for (const sat of evading) {
          const pos = latLonAltToVec3(sat.lat, sat.lon, sat.alt);
          // Spawn 3 particles per frame per evading satellite
          for (let p = 0; p < 3; p++) {
            const pGeo = new THREE.SphereGeometry(0.003, 4, 4);
            const pMat = new THREE.MeshBasicMaterial({
              color: Math.random() > 0.5 ? 0xff6600 : 0xffcc00,
              transparent: true, opacity: 1,
            });
            const pMesh = new THREE.Mesh(pGeo, pMat);
            pMesh.position.copy(pos);
            fireGroupRef.current!.add(pMesh);

            // Velocity: outward from Earth + random spread
            const outward = pos.clone().normalize();
            const vel = outward.multiplyScalar(0.002 + Math.random() * 0.003);
            vel.x += (Math.random() - 0.5) * 0.004;
            vel.y += (Math.random() - 0.5) * 0.004;
            vel.z += (Math.random() - 0.5) * 0.004;

            fireParticles.current.push({ mesh: pMesh, velocity: vel, life: 0, maxLife: 20 + Math.random() * 20 });
          }
        }

        // Update existing particles
        const alive: FireParticle[] = [];
        for (const p of fireParticles.current) {
          p.life++;
          p.mesh.position.add(p.velocity);
          p.velocity.multiplyScalar(0.92); // drag
          const t = p.life / p.maxLife;
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
          // Fade from yellow → orange → red
          const r = 1, g = Math.max(0, 0.8 - t), b = 0;
          (p.mesh.material as THREE.MeshBasicMaterial).color.setRGB(r, g, b);

          if (p.life < p.maxLife) {
            alive.push(p);
          } else {
            fireGroupRef.current!.remove(p.mesh);
            p.mesh.geometry.dispose();
            (p.mesh.material as THREE.MeshBasicMaterial).dispose();
          }
        }
        fireParticles.current = alive;
      }

      // Camera
      const { theta, phi } = cameraAngle.current;
      const r = cameraRadius.current;
      camera.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      mount.removeEventListener("mousedown", onMouseDown);
      mount.removeEventListener("wheel", onWheel);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  // Update scene objects when snapshot changes
  useEffect(() => {
    const satGroup = satGroupRef.current;
    const debrisGroup = debrisGroupRef.current;
    const trailGroup = trailGroupRef.current;
    const orbitRingGroup = orbitRingGroupRef.current;
    if (!satGroup || !debrisGroup || !trailGroup || !snapshot) return;

    satGroup.clear();
    debrisGroup.clear();
    trailGroup.clear();
    if (orbitRingGroup) orbitRingGroup.clear();

    // ── DEBRIS — bright red/orange, larger size ──────────────────────────
    const debrisVerts: number[] = [];
    const debrisColors: number[] = [];
    for (const [, lat, lon, alt] of snapshot.debris_cloud) {
      const v = latLonAltToVec3(lat, lon, alt);
      debrisVerts.push(v.x, v.y, v.z);
      // Color: mix red and orange based on altitude
      const t = Math.min(1, Math.max(0, (alt - 300) / 600));
      debrisColors.push(1, 0.3 + t * 0.3, 0); // RGB: red-orange
    }
    if (debrisVerts.length > 0) {
      const dGeo = new THREE.BufferGeometry();
      dGeo.setAttribute("position", new THREE.Float32BufferAttribute(debrisVerts, 3));
      dGeo.setAttribute("color", new THREE.Float32BufferAttribute(debrisColors, 3));
      debrisGroup.add(new THREE.Points(dGeo, new THREE.PointsMaterial({
        size: 0.014,           // 2.3× bigger than before
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        sizeAttenuation: true,
      })));
    }

    // ── SATELLITES ────────────────────────────────────────────────────────
    for (const sat of snapshot.satellites) {
      const pos = latLonAltToVec3(sat.lat, sat.lon, sat.alt);
      const isSel = sat.id === selectedSat;
      const fuelPct = sat.fuel_kg / 50;

      // Color by fuel + status
      let color: number;
      if (sat.status === "EVADING")        color = 0xff4400;
      else if (fuelPct < 0.1)              color = 0xef4444;
      else if (fuelPct < 0.3)              color = 0xf59e0b;
      else if (sat.status === "RECOVERING") color = 0xf59e0b;
      else if (sat.status === "EOL")        color = 0xa78bfa;
      else                                  color = 0x10b981;

      // Satellite sphere — bigger and brighter
      const size = isSel ? 0.016 : sat.status === "EVADING" ? 0.014 : 0.011;
      const geo = new THREE.SphereGeometry(size, 10, 10);
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.userData = { satId: sat.id };
      satGroup.add(mesh);

      // Outer glow sphere
      const glowGeo = new THREE.SphereGeometry(size * 2.2, 8, 8);
      const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.FrontSide });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.copy(pos);
      satGroup.add(glow);

      // Pulsing ring for EVADING satellites
      if (sat.status === "EVADING") {
        const ringGeo = new THREE.RingGeometry(0.022, 0.030, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4400, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(pos);
        ring.lookAt(0, 0, 0);
        satGroup.add(ring);
      }

      // Selection ring
      if (isSel) {
        const ringGeo = new THREE.RingGeometry(0.024, 0.030, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(pos);
        ring.lookAt(0, 0, 0);
        satGroup.add(ring);
      }

      // Predicted track
      if (sat.predicted_track?.length) {
        const pts = [pos, ...sat.predicted_track.map(([plat, plon]) => latLonAltToVec3(plat, plon, sat.alt))];
        trailGroup.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: isSel ? 0.7 : 0.15 })
        ));
      }

      // Warning wireframe sphere for critical conjunctions
      if (snapshot.active_warnings.some((w) => w.sat === sat.id && w.miss_km < 0.1)) {
        const wGeo = new THREE.SphereGeometry(0.028, 8, 8);
        const wMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.25, wireframe: true });
        const w = new THREE.Mesh(wGeo, wMat);
        w.position.copy(pos);
        satGroup.add(w);
      }

      // ── Orbit ring — shows current orbital altitude as a circle ──────────
      if (orbitRingGroup) {
        const prevAlt = prevSatAlts.current.get(sat.id);
        const altChanged = prevAlt !== undefined && Math.abs(prevAlt - sat.alt) > 0.5; // > 500m change
        const isEvading = sat.status === "EVADING" || sat.status === "RECOVERING";

        // Draw orbit ring at current altitude
        const orbitR = RE_DISPLAY + (sat.alt / 6378.137) * RE_DISPLAY * ALT_EXAGGERATION;
        const orbitPts: THREE.Vector3[] = [];
        for (let i = 0; i <= 128; i++) {
          const a = (i / 128) * Math.PI * 2;
          orbitPts.push(new THREE.Vector3(orbitR * Math.cos(a), 0, orbitR * Math.sin(a)));
        }
        const ringColor = isEvading ? 0xff4400 : isSel ? color : 0x1a3a6a;
        const ringOpacity = isEvading ? 0.7 : isSel ? 0.5 : 0.12;
        const orbitLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(orbitPts),
          new THREE.LineBasicMaterial({ color: ringColor, transparent: true, opacity: ringOpacity })
        );
        // Tilt ring to match satellite's approximate orbital plane (simplified: use lat as inclination hint)
        orbitLine.rotation.x = (sat.lat * 0.3) * Math.PI / 180;
        orbitLine.rotation.z = (sat.lon * 0.1) * Math.PI / 180;
        orbitRingGroup.add(orbitLine);

        // If altitude just changed (burn fired), draw the OLD orbit ring as a ghost
        if (altChanged && prevAlt !== undefined) {
          const oldR = RE_DISPLAY + (prevAlt / 6378.137) * RE_DISPLAY * ALT_EXAGGERATION;
          const oldPts: THREE.Vector3[] = [];
          for (let i = 0; i <= 128; i++) {
            const a = (i / 128) * Math.PI * 2;
            oldPts.push(new THREE.Vector3(oldR * Math.cos(a), 0, oldR * Math.sin(a)));
          }
          const ghostLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(oldPts),
            new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.25 })
          );
          ghostLine.rotation.x = (sat.lat * 0.3) * Math.PI / 180;
          ghostLine.rotation.z = (sat.lon * 0.1) * Math.PI / 180;
          orbitRingGroup.add(ghostLine);

          // Arrow showing direction of orbit change
          const arrowDir = sat.alt > prevAlt ? 1 : -1; // up or down
          const arrowR = (orbitR + oldR) / 2;
          const arrowGeo = new THREE.ConeGeometry(0.012, 0.04, 6);
          const arrowMat = new THREE.MeshBasicMaterial({ color: arrowDir > 0 ? 0x10b981 : 0xf59e0b });
          const arrow = new THREE.Mesh(arrowGeo, arrowMat);
          arrow.position.set(arrowR, 0, 0);
          arrow.rotation.z = arrowDir > 0 ? -Math.PI / 2 : Math.PI / 2;
          orbitRingGroup.add(arrow);
        }

        prevSatAlts.current.set(sat.id, sat.alt);
      }
    }
  }, [snapshot, selectedSat]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const mount = mountRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const satGroup = satGroupRef.current;
    if (!mount || !renderer || !camera || !satGroup || !snapshot) return;
    const rect = mount.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(satGroup.children, true);
    for (const hit of hits) {
      const id = hit.object.userData.satId;
      if (id) { onSelectSat(id); return; }
    }
  }, [snapshot, onSelectSat]);

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%", cursor: "grab", position: "relative" }} onClick={handleClick}>

      {/* Top bar */}
      <div style={{ position: "absolute", top: "10px", left: "12px", zIndex: 10, fontSize: "11px", color: "rgba(255,255,255,0.35)", display: "flex", gap: "16px", alignItems: "center", pointerEvents: "none" }}>
        <span style={{ fontWeight: 600 }}>🌍 3D Realtime Globe</span>
        <span style={{ color: "rgba(16,185,129,0.8)" }}>● {snapshot?.satellites.length ?? 0} sats</span>
        <span style={{ color: "rgba(255,100,50,0.8)" }}>● {snapshot?.debris_cloud.length ?? 0} debris</span>
        {(snapshot?.satellites.filter(s => s.status === "EVADING").length ?? 0) > 0 && (
          <span style={{ color: "#ff4400", fontWeight: 700, animation: "livePulse 0.5s infinite" }}>
            🔥 {snapshot!.satellites.filter(s => s.status === "EVADING").length} BURN{snapshot!.satellites.filter(s => s.status === "EVADING").length > 1 ? "S" : ""} ACTIVE
          </span>
        )}
        <span style={{ color: "rgba(255,255,255,0.18)" }}>Drag · Scroll · Click</span>
      </div>

      {/* Fuel HUD */}
      {snapshot && snapshot.satellites.length > 0 && (
        <div style={{ position: "absolute", bottom: "12px", left: "12px", zIndex: 10, background: "rgba(10,12,20,0.92)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 14px", minWidth: "210px", maxHeight: "280px", overflowY: "auto", pointerEvents: "none" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
            ⛽ Fleet Fuel
          </div>
          {snapshot.satellites.slice(0, 18).map((sat) => {
            const pct = Math.max(0, Math.min(100, (sat.fuel_kg / 50) * 100));
            const c = pct > 30 ? "#10b981" : pct > 10 ? "#f59e0b" : "#ef4444";
            const isEvading = sat.status === "EVADING";
            return (
              <div key={sat.id} style={{ marginBottom: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                  <span style={{ fontSize: "9px", color: isEvading ? "#ff6600" : selectedSat === sat.id ? "#818cf8" : "rgba(255,255,255,0.6)", fontWeight: isEvading ? 700 : 400 }}>
                    {isEvading ? "🔥 " : ""}{sat.id.slice(-8)}
                  </span>
                  <span style={{ fontSize: "9px", color: c, fontWeight: 700 }}>{sat.fuel_kg.toFixed(2)} kg</span>
                </div>
                <div style={{ height: "4px", background: "rgba(255,255,255,0.07)", borderRadius: "2px", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: c, borderRadius: "2px", transition: "width 0.4s ease", boxShadow: isEvading ? `0 0 6px ${c}` : "none" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent burns HUD */}
      {snapshot && (snapshot.maneuver_log?.length ?? 0) > 0 && (
        <div style={{ position: "absolute", bottom: "12px", right: "12px", zIndex: 10, background: "rgba(10,12,20,0.92)", border: "1px solid rgba(255,100,0,0.3)", borderRadius: "10px", padding: "10px 14px", minWidth: "190px", pointerEvents: "none" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: "rgba(255,150,50,0.9)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
            🔥 Recent Burns
          </div>
          {(snapshot.maneuver_log ?? []).slice(-6).reverse().map((m, i) => (
            <div key={i} style={{ marginBottom: "5px", display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
              <span style={{ color: "rgba(255,255,255,0.7)" }}>{m.satelliteId.slice(-8)}</span>
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>Δv {m.dvMs.toFixed(2)} m/s</span>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div style={{ position: "absolute", top: "10px", right: "12px", zIndex: 10, background: "rgba(10,12,20,0.88)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "8px 12px", pointerEvents: "none" }}>
        <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Legend</div>
        {[
          { c: "#10b981", l: "Satellite — Nominal" },
          { c: "#f59e0b", l: "Satellite — Low fuel" },
          { c: "#ff4400", l: "Satellite — EVADING 🔥" },
          { c: "#a78bfa", l: "Satellite — EOL" },
          { c: "#ff6600", l: "Debris (red-orange)" },
        ].map((item) => (
          <div key={item.l} style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: item.c, flexShrink: 0 }} />
            <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.55)" }}>{item.l}</span>
          </div>
        ))}
      </div>

      <style>{`@keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
