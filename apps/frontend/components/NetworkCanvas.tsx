"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ProviderRegistryEntry, NetworkStatus } from "@resilynx/contracts";
import type { NodeState } from "@/hooks/useWebSocket";

/* ---- constants ---- */
const STATUS_COLOR: Record<NetworkStatus, number> = {
  stable: 0x22c55e,
  degraded: 0xf59e0b,
  healing: 0xef4444,
  restored: 0x22c55e,
};

const NEXLA_COLOR = 0x00ffff;
const DB_COLOR = 0x6366f1;
const EDGE_FLOW = 0x00ffff;
const EDGE_DEGRADED = 0xf59e0b;
const EDGE_HEALING = 0xef4444;

interface Props {
  providers: ProviderRegistryEntry[];
  networkStatus: Map<string, NodeState>;
}

/* ---- helpers ---- */
function makeSprite(text: string, color: string, scaleX: number, scaleY: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.font = "bold 48px 'Fira Code', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleX, scaleY, 1);
  return sprite;
}

export function NetworkCanvas({ providers, networkStatus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(networkStatus);
  statusRef.current = networkStatus;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a0f);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a0f, 0.00015);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    camera.position.set(0, 2.5, 14);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 5;
    controls.maxDistance = 25;
    controls.maxPolarAngle = Math.PI * 0.7;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;
    controls.target.set(0, 0, 0);

    /* ---- lighting ---- */
    scene.add(new THREE.AmbientLight(0x334466, 2));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(6, 10, 6);
    scene.add(key);

    /* ---- grid floor (perspective) ---- */
    const gridSize = 20;
    const gridDivs = 30;
    const gridGeo = new THREE.BufferGeometry();
    const gridVerts: number[] = [];
    for (let i = -gridDivs; i <= gridDivs; i++) {
      const p = (i / gridDivs) * (gridSize / 2);
      gridVerts.push(p, -1.5, -gridSize / 2, p, -1.5, gridSize / 2);
      gridVerts.push(-gridSize / 2, -1.5, p, gridSize / 2, -1.5, p);
    }
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridVerts, 3));
    const gridMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.08 });
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    scene.add(grid);

    /* ---- background particle field ---- */
    const bgCount = 400;
    const bgGeo = new THREE.BufferGeometry();
    const bgPositions = new Float32Array(bgCount * 3);
    for (let i = 0; i < bgCount; i++) {
      bgPositions[i * 3] = (Math.random() - 0.5) * 16;
      bgPositions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      bgPositions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    bgGeo.setAttribute("position", new THREE.BufferAttribute(bgPositions, 3));
    const bgMat = new THREE.PointsMaterial({ color: 0x334466, size: 0.02, transparent: true, opacity: 0.5 });
    const bgParticles = new THREE.Points(bgGeo, bgMat);
    scene.add(bgParticles);

    /* ---- node layout positions ---- */
    // Left column: 4 providers
    const providerPositions = new Map<string, THREE.Vector3>();
    const providerOrder = providers.map((p) => p.id);
    const leftX = -5;
    providerOrder.forEach((id, i) => {
      const y = 3 - (i * 2); // top to bottom: 3, 1, -1, -3
      providerPositions.set(id, new THREE.Vector3(leftX, y, 0));
    });

    // Center: Nexla Engine
    const nexlaPos = new THREE.Vector3(0, 0, 0);

    // Right: Database
    const dbPos = new THREE.Vector3(5, 0, 0);

    /* ---- node meshes ---- */
    const nodeMeshes = new Map<string, THREE.Mesh>();
    const nodeLabels: THREE.Sprite[] = [];

    const sphereGeo = new THREE.SphereGeometry(0.3, 32, 32);
    const nexlaGeo = new THREE.IcosahedronGeometry(0.5, 2); // larger, faceted for engine

    function createNode(id: string, pos: THREE.Vector3, color: number, geo: THREE.BufferGeometry, scale = 1) {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.3 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.scale.setScalar(scale);
      mesh.userData = { nodeId: id };
      scene.add(mesh);
      nodeMeshes.set(id, mesh);

      // Glow ring
      const ringGeo = new THREE.RingGeometry(0.45, 0.5, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.3 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(pos);
      ring.position.y -= 0.01;
      scene.add(ring);
      mesh.userData.glowRing = ring;

      return mesh;
    }

    // Provider nodes
    providers.forEach((p) => {
      const pos = providerPositions.get(p.id)!;
      const color = p.enabled ? STATUS_COLOR.stable : STATUS_COLOR.degraded;
      createNode(p.id, pos, color, sphereGeo);
    });

    // Nexla Engine (larger)
    const nexlaMesh = createNode("nexla-engine", nexlaPos, NEXLA_COLOR, nexlaGeo, 1.3);
    nexlaMesh.userData.isEngine = true;

    // Database
    const dbGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.6, 24);
    dbGeo.rotateX(Math.PI / 2);
    const dbMesh = createNode("database", dbPos, DB_COLOR, dbGeo);

    /* ---- labels ---- */
    function addLabel(text: string, pos: THREE.Vector3, offsetY: number) {
      const sprite = makeSprite(text, "#94a3b8", 2.2, 0.55);
      sprite.position.copy(pos).add(new THREE.Vector3(0, offsetY, 0));
      sprite.renderOrder = 999;
      scene.add(sprite);
      return sprite;
    }

    // Provider labels
    providers.forEach((p) => {
      const pos = providerPositions.get(p.id)!;
      addLabel(p.displayName.length > 18 ? p.displayName.slice(0, 17) + "\u2026" : p.displayName, pos, 0.7);
      // Value label placeholder
      const valSprite = makeSprite("", "#64748b", 1.8, 0.4);
      valSprite.position.copy(pos).add(new THREE.Vector3(0, 0.3, 0));
      nodeMeshes.get(p.id)!.userData.valueLabel = valSprite;
      scene.add(valSprite);
    });
    addLabel("Nexla Engine", nexlaPos, 0.9);
    addLabel("Database", dbPos, 0.75);

    /* ---- edges (arrows) ---- */
    interface Edge {
      from: THREE.Vector3;
      to: THREE.Vector3;
      line: THREE.Line;
    }
    const edges: Edge[] = [];

    function createEdge(from: THREE.Vector3, to: THREE.Vector3): THREE.Line {
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);

      // Cylinder as tube
      const cylGeo = new THREE.CylinderGeometry(0.03, 0.03, len, 8);
      const cylMat = new THREE.MeshBasicMaterial({ color: EDGE_FLOW, transparent: true, opacity: 0.5 });
      const cyl = new THREE.Mesh(cylGeo, cylMat);
      cyl.position.copy(mid);
      cyl.lookAt(to);

      // Arrow head (small cone)
      const headGeo = new THREE.ConeGeometry(0.08, 0.2, 8);
      const headMat = new THREE.MeshBasicMaterial({ color: EDGE_FLOW, transparent: true, opacity: 0.7 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.copy(to);
      head.lookAt(from);

      const group = new THREE.Group();
      group.add(cyl);
      group.add(head);
      scene.add(group);

      // Return a dummy line for reference (we store group instead)
      const dummyGeo = new THREE.BufferGeometry().setFromPoints([from, to]);
      const dummyLine = new THREE.Line(dummyGeo, new THREE.LineBasicMaterial());
      dummyLine.userData.edgeGroup = group;
      return dummyLine;
    }

    // Provider → Nexla Engine edges
    providerOrder.forEach((id) => {
      const from = providerPositions.get(id)!;
      const edge = createEdge(from, nexlaPos);
      edges.push({ from, to: nexlaPos, line: edge });
      edge.userData.providerId = id;
    });

    // Nexla Engine → Database
    const dbEdge = createEdge(nexlaPos, dbPos);
    edges.push({ from: nexlaPos, to: dbPos, line: dbEdge });
    dbEdge.userData.isDbEdge = true;

    /* ---- data flow particles ---- */
    const MAX_PARTICLES = 200;
    const particleGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({ color: EDGE_FLOW, transparent: true, opacity: 0.9 });
    const particlePool: THREE.Mesh[] = [];
    const particleData: { edgeIndex: number; t: number; speed: number }[] = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const m = new THREE.Mesh(particleGeo, particleMat.clone());
      m.visible = false;
      scene.add(m);
      particlePool.push(m);
      particleData.push({ edgeIndex: 0, t: 0, speed: 0.003 + Math.random() * 0.005 });
    }
    let particleCursor = 0;
    let lastSpawn = 0;

    /* ---- resize ---- */
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    /* ---- animation ---- */
    let animFrame = 0;
    const clock = new THREE.Clock();
    let nextRestoredAngle = providers.length;

    const animate = () => {
      animFrame = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const currentStatus = statusRef.current;

      controls.autoRotate = true;

      /* Update provider nodes */
      nodeMeshes.forEach((mesh, nodeId) => {
        if (nodeId === "nexla-engine" || nodeId === "database") return;

        const state = currentStatus.get(nodeId);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const color = state ? STATUS_COLOR[state.status] : STATUS_COLOR.stable;

        mat.color.setHex(color);

        // Pulse
        if (state?.status === "healing") {
          const pulse = 1 + Math.sin(t * 8) * 0.35;
          mesh.scale.setScalar(pulse);
          mat.emissive.setHex(color);
          mat.emissiveIntensity = 0.3 + Math.sin(t * 8) * 0.3;
        } else if (state?.status === "degraded") {
          const pulse = 1 + Math.sin(t * 4) * 0.15;
          mesh.scale.setScalar(pulse);
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        } else {
          mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }

        // Glow ring update
        const ring = mesh.userData.glowRing as THREE.Mesh | undefined;
        if (ring) {
          (ring.material as THREE.MeshBasicMaterial).color.setHex(color);
          (ring.material as THREE.MeshBasicMaterial).opacity =
            state?.status === "healing" ? 0.3 + Math.sin(t * 8) * 0.2 : 0.25;
        }

        // Edge colors
        const edgeEdges = edges.filter((e) => (e.line as THREE.Line).userData.providerId === nodeId);
        edgeEdges.forEach((e) => {
          const group = (e.line as THREE.Line).userData.edgeGroup as THREE.Group;
          if (!group) return;
          let edgeColor = EDGE_FLOW;
          if (state?.status === "degraded") edgeColor = EDGE_DEGRADED;
          else if (state?.status === "healing") edgeColor = EDGE_HEALING;

          group.children.forEach((child) => {
            if (child instanceof THREE.Mesh) {
              (child.material as THREE.MeshBasicMaterial).color.setHex(edgeColor);
              (child.material as THREE.MeshBasicMaterial).opacity =
                state?.status === "healing" ? 0.5 + Math.sin(t * 8) * 0.3 : 0.5;
            }
          });
        });
      });

      // Nexla Engine pulse
      if (nexlaMesh) {
        const enginePulse = 1.3 + Math.sin(t * 2.5) * 0.08;
        nexlaMesh.scale.setScalar(enginePulse);
        (nexlaMesh.material as THREE.MeshStandardMaterial).emissive.setHex(NEXLA_COLOR);
        (nexlaMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + Math.sin(t * 2.5) * 0.08;
      }

      // Spawn particles from healthy providers
      if (t - lastSpawn > 0.2) {
        lastSpawn = t;
        providerOrder.forEach((id) => {
          const state = currentStatus.get(id);
          const isHealthy = !state || state.status === "stable" || state.status === "restored";
          if (!isHealthy) return;

          const p = particleData[particleCursor];
          // Find edge for this provider
          const edgeIndex = edges.findIndex((e) => (e.line as THREE.Line).userData.providerId === id);
          if (edgeIndex === -1) return;

          p.edgeIndex = edgeIndex;
          p.t = 0;
          p.speed = 0.003 + Math.random() * 0.006;

          const m = particlePool[particleCursor];
          const edge = edges[edgeIndex];
          m.position.lerpVectors(edge.from, edge.to, 0);
          m.visible = true;
          particleCursor = (particleCursor + 1) % MAX_PARTICLES;
        });
      }

      // Also spawn Nexla→DB particles
      if (t - lastSpawn > 0.2) {
        // Only spawn db particles when at least some providers are healthy
        const hasHealthy = providerOrder.some((id) => {
          const s = currentStatus.get(id);
          return !s || s.status === "stable" || s.status === "restored";
        });
        if (hasHealthy) {
          const dbEdgeIdx = edges.findIndex((e) => (e.line as THREE.Line).userData.isDbEdge);
          if (dbEdgeIdx !== -1 && Math.random() < 0.6) {
            const p = particleData[particleCursor];
            p.edgeIndex = dbEdgeIdx;
            p.t = 0;
            p.speed = 0.004 + Math.random() * 0.005;
            particlePool[particleCursor].visible = true;
            particleCursor = (particleCursor + 1) % MAX_PARTICLES;
          }
        }
      }

      // Update particles
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particleData[i];
        if (p.t >= 1) {
          particlePool[i].visible = false;
          continue;
        }
        p.t += p.speed;
        if (p.t >= 1) {
          particlePool[i].visible = false;
          continue;
        }
        const edge = edges[p.edgeIndex];
        particlePool[i].position.lerpVectors(edge.from, edge.to, p.t);
        // Fade as it travels
        (particlePool[i].material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - p.t);
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener("resize", resize);
      controls.dispose();
      renderer.dispose();

      nodeMeshes.forEach((m) => {
        const ring = m.userData.glowRing as THREE.Mesh | undefined;
        if (ring) {
          ring.geometry.dispose();
          (ring.material as THREE.Material).dispose();
        }
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      particlePool.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      edges.forEach((e) => {
        const group = (e.line as THREE.Line).userData.edgeGroup as THREE.Group | undefined;
        if (group) {
          group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              (child.material as THREE.Material).dispose();
            }
          });
        }
        e.line.geometry.dispose();
        (e.line.material as THREE.Material).dispose();
      });

      // Dispose sprites/labels
      scene.traverse((obj) => {
        if (obj instanceof THREE.Sprite) {
          obj.material.dispose();
          (obj.material as THREE.SpriteMaterial).map?.dispose();
        }
      });

      bgParticles.geometry.dispose();
      bgParticles.material.dispose();
      gridGeo.dispose();
      gridMat.dispose();
      sphereGeo.dispose();
      nexlaGeo.dispose();
      dbGeo.dispose();
      particleGeo.dispose();
      particleMat.dispose();
    };
  }, [providers]);

  return (
    <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
  );
}
