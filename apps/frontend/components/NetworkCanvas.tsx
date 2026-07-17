"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ProviderRegistryEntry, NetworkStatus } from "@resilynx/contracts";
import type { NodeState } from "@/hooks/useWebSocket";

const STATUS_COLOR: Record<NetworkStatus, number> = {
  stable: 0x22c55e,
  degraded: 0xf59e0b,
  healing: 0xef4444,
  restored: 0x22c55e,
};

interface Props {
  providers: ProviderRegistryEntry[];
  networkStatus: Map<string, NodeState>;
}

export function NetworkCanvas({ providers, networkStatus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(networkStatus);
  statusRef.current = networkStatus;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    /* ---- scene setup ---- */
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a0f);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(6, 4, 8);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 20;

    /* ---- lighting ---- */
    scene.add(new THREE.AmbientLight(0x404060, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(8, 12, 4);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0x334155, 0.6);
    fill.position.set(-4, 2, -4);
    scene.add(fill);

    /* ---- ground grid ---- */
    const grid = new THREE.GridHelper(12, 24, 0x1e293b, 0x1e293b);
    scene.add(grid);

    /* ---- node meshes ---- */
    const nodeMeshes = new Map<string, THREE.Mesh>();
    const radius = 3.5;

    const createSphere = (
      id: string,
      x: number,
      z: number,
      color: number,
      startScale = 1,
    ) => {
      const geo = new THREE.SphereGeometry(0.25, 32, 32);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.25,
        metalness: 0.15,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0, z);
      mesh.scale.setScalar(startScale);
      mesh.userData = { nodeId: id };
      scene.add(mesh);
      nodeMeshes.set(id, mesh);
      return mesh;
    };

    providers.forEach((p, i) => {
      const angle = (i / providers.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      createSphere(p.id, x, z, p.enabled ? STATUS_COLOR.stable : STATUS_COLOR.degraded);
    });

    /* ---- connecting lines ---- */
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x1e293b,
      transparent: true,
      opacity: 0.4,
    });
    const lineGeo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const providerIds = providers.map((p) => p.id);
    for (let i = 0; i < providerIds.length; i++) {
      for (let j = i + 1; j < providerIds.length; j++) {
        const a = nodeMeshes.get(providerIds[i])!;
        const b = nodeMeshes.get(providerIds[j])!;
        positions.push(a.position.x, a.position.y, a.position.z);
        positions.push(b.position.x, b.position.y, b.position.z);
      }
    }
    lineGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lines);

    /* ---- labels (sprite text) ---- */
    const labelSprites: THREE.Sprite[] = [];
    const createLabel = (text: string, position: THREE.Vector3) => {
      const canvas2d = document.createElement("canvas");
      canvas2d.width = 256;
      canvas2d.height = 64;
      const ctx = canvas2d.getContext("2d")!;
      ctx.fillStyle = "#94a3b8";
      ctx.font = "20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(text, 128, 32);
      const tex = new THREE.CanvasTexture(canvas2d);
      tex.minFilter = THREE.LinearFilter;
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(position).add(new THREE.Vector3(0, 0.55, 0));
      sprite.scale.set(2.5, 0.625, 1);
      scene.add(sprite);
      return sprite;
    };
    providers.forEach((p) => {
      const mesh = nodeMeshes.get(p.id);
      if (!mesh) return;
      const sprite = createLabel(p.displayName, mesh.position);
      labelSprites.push(sprite);
    });

    /* ---- dynamic edges & labels for restored nodes ---- */
    const dynamicEdges: THREE.Line[] = [];
    const dynamicLabels: THREE.Sprite[] = [];
    const createDashedEdge = (from: THREE.Vector3, to: THREE.Vector3) => {
      const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
      const mat = new THREE.LineDashedMaterial({
        color: STATUS_COLOR.restored,
        dashSize: 0.3,
        gapSize: 0.15,
        linewidth: 1,
        transparent: true,
        opacity: 0.7,
      });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      scene.add(line);
      return line;
    };
    const findNearestNode = (pos: THREE.Vector3, excludeId: string): THREE.Mesh | null => {
      let bestDist = Infinity;
      let bestMesh: THREE.Mesh | null = null;
      nodeMeshes.forEach((m, id) => {
        if (id === excludeId) return;
        const d = m.position.distanceToSquared(pos);
        if (d < bestDist) { bestDist = d; bestMesh = m; }
      });
      return bestMesh;
    };

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

    /* ---- animation loop ---- */
    let animFrame = 0;
    const clock = new THREE.Clock();
    let nextFreeAngle = providers.length;

    const animate = () => {
      animFrame = requestAnimationFrame(animate);

      const t = clock.getElapsedTime();
      const currentStatus = statusRef.current;

      /* spawn new restored nodes */
      currentStatus.forEach((state, nodeId) => {
        if (
          !nodeMeshes.has(nodeId) &&
          state.status === "restored"
        ) {
          const angle = (nextFreeAngle * 1.3) * Math.PI * 2 * 0.618;
          nextFreeAngle += 1;
          const x = Math.cos(angle) * radius * 1.3;
          const z = Math.sin(angle) * radius * 1.3;
          const mesh = createSphere(nodeId, x, z, STATUS_COLOR.restored, 0.01);
          mesh.userData.scaleIn = true;
          mesh.userData.startTime = t;

          /* label */
          const labelText = nodeId.length > 8 ? nodeId.slice(0, 8) + "\u2026" : nodeId;
          const sprite = createLabel(labelText, mesh.position.clone());
          dynamicLabels.push(sprite);
          mesh.userData.labelSprite = sprite;

          /* target on the circle */
          const targetAngle = (nextFreeAngle - 1) * Math.PI * 2 * 0.618;
          const tx = Math.cos(targetAngle) * radius;
          const tz = Math.sin(targetAngle) * radius;
          mesh.userData.targetPos = new THREE.Vector3(tx, 0, tz);

          /* dashed edge to nearest existing node */
          const nearest = findNearestNode(mesh.position, nodeId);
          if (nearest) {
            const edge = createDashedEdge(mesh.position.clone(), nearest.position.clone());
            dynamicEdges.push(edge);
            mesh.userData.dynamicEdge = edge;
          }
        }
      });

      /* update existing nodes */
      nodeMeshes.forEach((mesh, nodeId) => {
        const state = currentStatus.get(nodeId);
        const mat = mesh.material as THREE.MeshStandardMaterial;

        if (state) {
          const color = STATUS_COLOR[state.status];
          mat.color.setHex(color);

          if (state.status === "healing") {
            const pulse = 1 + Math.sin(t * 5) * 0.25;
            mesh.scale.setScalar(pulse);
            mat.emissive.setHex(color);
            mat.emissiveIntensity = 0.25 + Math.sin(t * 5) * 0.2;
          } else {
            if (!mesh.userData.scaleIn) {
              mesh.scale.lerp(
                new THREE.Vector3(1, 1, 1),
                0.1,
              );
            }
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }

        /* scale-in + position animation for restored nodes */
        if (mesh.userData.scaleIn) {
          const elapsed = t - (mesh.userData.startTime as number);
          const target = 1;
          const eased = Math.min(
            target,
            0.01 + (target - 0.01) * (1 - Math.exp(-elapsed * 3)),
          );
          mesh.scale.setScalar(eased);

          /* animate position toward circle target */
          const targetPos = mesh.userData.targetPos as THREE.Vector3 | undefined;
          if (targetPos) {
            mesh.position.lerp(targetPos, 0.08);
            /* sync label */
            const sprite = mesh.userData.labelSprite as THREE.Sprite | undefined;
            if (sprite) {
              sprite.position.copy(mesh.position).add(new THREE.Vector3(0, 0.55, 0));
            }
            /* sync edge */
            const edge = mesh.userData.dynamicEdge as THREE.Line | undefined;
            if (edge) {
              const posAttr = edge.geometry.getAttribute("position") as THREE.BufferAttribute;
              posAttr.setXYZ(0, mesh.position.x, mesh.position.y, mesh.position.z);
              posAttr.needsUpdate = true;
              edge.computeLineDistances();
            }
          }

          if (eased >= 0.99) {
            mesh.userData.scaleIn = false;
          }
        }
      });

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
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      labelSprites.forEach((s) => {
        s.material.dispose();
        (s.material as THREE.SpriteMaterial).map?.dispose();
      });
      dynamicLabels.forEach((s) => {
        s.material.dispose();
        (s.material as THREE.SpriteMaterial).map?.dispose();
      });
      dynamicEdges.forEach((e) => {
        e.geometry.dispose();
        (e.material as THREE.Material).dispose();
      });
      lineGeo.dispose();
      lineMat.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
    };
  }, [providers]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
