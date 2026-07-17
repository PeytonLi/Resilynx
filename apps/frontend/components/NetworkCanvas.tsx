"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { NetworkStatus, ProviderRegistryEntry } from "@resilynx/contracts";
import type { NodeState } from "@/hooks/useWebSocket";

const STATUS_COLOR: Record<NetworkStatus, number> = {
  stable: 0x39d6bd,
  degraded: 0xffba5c,
  healing: 0xff637d,
  restored: 0x39d6bd,
};

interface Props {
  providers: ProviderRegistryEntry[];
  networkStatus: Map<string, NodeState>;
}

interface NodeVisual {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  defaultColor: number;
}

interface EdgeVisual {
  curve: THREE.QuadraticBezierCurve3;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  providerId?: string;
}

interface Packet {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  edge: number;
  progress: number;
  speed: number;
}

function compactLabel(label: string) {
  return label.length > 17 ? `${label.slice(0, 16)}…` : label;
}

function makeLabel(text: string, color: string, width = 2.3): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 150;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Sprite();

  context.font = "600 44px 'Fira Code', 'Cascadia Code', 'Consolas', monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(3, 12, 25, 0.7)";
  context.roundRect(26, 22, 972, 106, 53);
  context.fill();
  context.strokeStyle = "rgba(168, 224, 255, 0.16)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = color;
  context.fillText(text.toUpperCase(), 512, 76);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(width, width * 0.22, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  scene.traverse((object) => {
    const drawable = object as THREE.Mesh | THREE.Sprite | THREE.Line;
    if ("geometry" in drawable && drawable.geometry instanceof THREE.BufferGeometry) geometries.add(drawable.geometry);
    if ("material" in drawable) {
      const material = drawable.material;
      (Array.isArray(material) ? material : [material]).forEach((item) => materials.add(item));
    }
  });

  materials.forEach((material) => {
    Object.values(material).forEach((value) => {
      if (value instanceof THREE.Texture) textures.add(value);
    });
    material.dispose();
  });
  textures.forEach((texture) => texture.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

export function NetworkCanvas({ providers, networkStatus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(networkStatus);
  statusRef.current = networkStatus;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x050914, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x071221, 0.032);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 70);
    camera.position.set(0.8, 1.6, 15.2);
    camera.lookAt(0.2, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.minDistance = 8;
    controls.maxDistance = 23;
    controls.maxPolarAngle = Math.PI * 0.68;
    controls.target.set(0.2, 0, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.24;

    scene.add(new THREE.HemisphereLight(0xa9e7ff, 0x06101f, 1.9));
    const keyLight = new THREE.PointLight(0x65eaff, 22, 26, 2);
    keyLight.position.set(-1, 4, 6);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x8d7bff, 15, 22, 2);
    rimLight.position.set(5, 0, -3);
    scene.add(rimLight);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(440 * 3);
    for (let index = 0; index < 440; index++) {
      starPositions[index * 3] = (Math.random() - 0.5) * 27;
      starPositions[index * 3 + 1] = (Math.random() - 0.5) * 15;
      starPositions[index * 3 + 2] = -5 - Math.random() * 13;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x4a789c, size: 0.027, transparent: true, opacity: 0.48 })));

    const grid = new THREE.GridHelper(21, 28, 0x17435d, 0x102c43);
    grid.position.set(0, -4.25, -1.4);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.27;
    scene.add(grid);

    const nodes = new Map<string, NodeVisual>();
    const nodeLabels: THREE.Sprite[] = [];
    const sourceGeometry = new THREE.SphereGeometry(0.31, 28, 28);

    const addNode = (id: string, position: THREE.Vector3, color: number, geometry: THREE.BufferGeometry, scale = 1) => {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.22, metalness: 0.62, emissive: color, emissiveIntensity: 0.13 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.scale.setScalar(scale);
      scene.add(mesh);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.47 * scale, 0.52 * scale, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.27, side: THREE.DoubleSide }),
      );
      ring.position.copy(position);
      ring.position.y -= 0.055;
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);
      nodes.set(id, { mesh, ring, defaultColor: color });
      return mesh;
    };

    const corePosition = new THREE.Vector3(0.1, 0, 0.8);
    const ledgerPosition = new THREE.Vector3(5.8, 0, -0.2);
    const healerPosition = new THREE.Vector3(2.2, 3.2, 0.3);
    const providerPositions = new Map<string, THREE.Vector3>();

    providers.forEach((provider, index) => {
      const arc = Math.PI * (0.55 + index * 0.3);
      const position = new THREE.Vector3(-5.8, 3.2 - index * 2.1, Math.sin(index * 0.8) * 0.5);
      providerPositions.set(provider.id, position);
      addNode(provider.id, position, STATUS_COLOR.stable, sourceGeometry);
      const label = makeLabel(compactLabel(provider.displayName), "#acd8e8", 2.45);
      label.position.copy(position).add(new THREE.Vector3(0, 0.62, 0));
      scene.add(label);
      nodeLabels.push(label);
    });

    const coreGeometry = new THREE.IcosahedronGeometry(0.64, 2);
    const coreMesh = addNode("nexla-engine", corePosition, 0x5de8ff, coreGeometry, 1.1);
    const coreLabel = makeLabel("Nexla core", "#d2fbff", 2.38);
    coreLabel.position.copy(corePosition).add(new THREE.Vector3(0, 1.12, 0));
    scene.add(coreLabel);
    nodeLabels.push(coreLabel);

    const coreHalo = new THREE.Mesh(
      new THREE.TorusGeometry(1.03, 0.018, 10, 80),
      new THREE.MeshBasicMaterial({ color: 0x5de8ff, transparent: true, opacity: 0.38 }),
    );
    coreHalo.position.copy(corePosition);
    coreHalo.rotation.x = Math.PI * 0.35;
    scene.add(coreHalo);

    const ledgerGeometry = new THREE.CylinderGeometry(0.44, 0.44, 0.72, 28);
    ledgerGeometry.rotateX(Math.PI / 2);
    addNode("database", ledgerPosition, 0x6b92ff, ledgerGeometry, 1.08);
    const ledgerLabel = makeLabel("Verified ledger", "#b8c9ff", 2.54);
    ledgerLabel.position.copy(ledgerPosition).add(new THREE.Vector3(0, 0.76, 0));
    scene.add(ledgerLabel);
    nodeLabels.push(ledgerLabel);

    const healerGeometry = new THREE.OctahedronGeometry(0.38, 1);
    const healerMesh = addNode("healer", healerPosition, 0xaa96ff, healerGeometry);
    const healerLabel = makeLabel("Recovery watch", "#d2caff", 2.44);
    healerLabel.position.copy(healerPosition).add(new THREE.Vector3(0, 0.66, 0));
    scene.add(healerLabel);
    nodeLabels.push(healerLabel);

    const edges: EdgeVisual[] = [];
    const addEdge = (from: THREE.Vector3, to: THREE.Vector3, color: number, providerId?: string) => {
      const midpoint = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
      midpoint.z -= 0.55;
      midpoint.y += providerId ? 0 : 0.32;
      const curve = new THREE.QuadraticBezierCurve3(from, midpoint, to);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: providerId ? 0.34 : 0.44 });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      edges.push({ curve, line, providerId });
    };

    providers.forEach((provider) => addEdge(providerPositions.get(provider.id)!, corePosition, 0x3ea8c8, provider.id));
    addEdge(corePosition, ledgerPosition, 0x5de8ff);
    addEdge(corePosition, healerPosition, 0xaa96ff);

    const packets: Packet[] = [];
    const packetGeometry = new THREE.SphereGeometry(0.055, 10, 10);
    for (let index = 0; index < 130; index++) {
      const material = new THREE.MeshBasicMaterial({ color: 0x9bf4ff, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(packetGeometry, material);
      mesh.visible = false;
      scene.add(mesh);
      packets.push({ mesh, edge: 0, progress: 1, speed: 0.008 });
    }

    let packetCursor = 0;
    let lastSpawn = 0;
    const clock = new THREE.Clock();
    let animationFrame = 0;
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      controls.autoRotate = !reducedMotion;
    };
    motionMedia.addEventListener("change", updateMotionPreference);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const statusMap = statusRef.current;

      nodes.forEach((visual, nodeId) => {
        const status = statusMap.get(nodeId)?.status;
        const color = status ? STATUS_COLOR[status] : visual.defaultColor;
        visual.mesh.material.color.lerp(new THREE.Color(color), 0.12);
        visual.ring.material.color.lerp(new THREE.Color(color), 0.12);
        visual.ring.material.opacity = status === "healing" ? 0.5 : status === "degraded" ? 0.4 : 0.27;
        visual.mesh.material.emissive.setHex(color);
        visual.mesh.material.emissiveIntensity = status === "healing" && !reducedMotion ? 0.55 + Math.sin(elapsed * 7) * 0.24 : 0.14;
        const scale = status === "healing" && !reducedMotion ? 1 + Math.sin(elapsed * 7) * 0.16 : 1;
        visual.mesh.scale.setScalar(nodeId === "nexla-engine" ? scale * 1.1 : scale);
      });

      if (!reducedMotion) {
        coreMesh.rotation.y += 0.008;
        coreMesh.rotation.x += 0.002;
        healerMesh.rotation.y -= 0.015;
        coreHalo.rotation.z += 0.004;

        if (elapsed - lastSpawn > 0.22) {
          lastSpawn = elapsed;
          providers.forEach((provider, index) => {
            const status = statusMap.get(provider.id)?.status;
            if (status === "degraded" || status === "healing") return;
            if (index % 2 === Math.floor(elapsed * 4) % 2) return;
            const edgeIndex = edges.findIndex((edge) => edge.providerId === provider.id);
            if (edgeIndex === -1) return;
            const packet = packets[packetCursor];
            packet.edge = edgeIndex;
            packet.progress = 0;
            packet.speed = 0.007 + Math.random() * 0.006;
            packet.mesh.visible = true;
            packetCursor = (packetCursor + 1) % packets.length;
          });

          const downstreamPacket = packets[packetCursor];
          downstreamPacket.edge = edges.length - 2;
          downstreamPacket.progress = 0;
          downstreamPacket.speed = 0.009;
          downstreamPacket.mesh.visible = true;
          packetCursor = (packetCursor + 1) % packets.length;
        }

        packets.forEach((packet) => {
          if (packet.progress >= 1) {
            packet.mesh.visible = false;
            return;
          }
          packet.progress += packet.speed;
          if (packet.progress >= 1) {
            packet.mesh.visible = false;
            return;
          }
          packet.mesh.position.copy(edges[packet.edge].curve.getPoint(packet.progress));
          packet.mesh.material.opacity = 0.96 * (1 - packet.progress * 0.35);
        });
      } else {
        packets.forEach((packet) => { packet.mesh.visible = false; });
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      motionMedia.removeEventListener("change", updateMotionPreference);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.setAnimationLoop(null);
      disposeScene(scene);
      renderer.dispose();
      nodeLabels.length = 0;
    };
  }, [providers]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} aria-label="Animated Resilynx provider topology" className="block h-full w-full cursor-grab active:cursor-grabbing" />
      <div aria-hidden="true" className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-[rgba(174,219,255,0.12)] bg-[rgba(4,14,29,0.55)] px-2.5 py-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-[#8ca8bc] backdrop-blur-md" style={{ fontFamily: "'Fira Code', monospace" }}>
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#5de8ff] shadow-[0_0_10px_#5de8ff]" />
        Signal map
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute bottom-4 right-4 z-10 rounded-lg border border-[rgba(174,219,255,0.12)] bg-[rgba(4,14,29,0.55)] px-2.5 py-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-[#8ca8bc] backdrop-blur-md" style={{ fontFamily: "'Fira Code', monospace" }}>
        Observe → protect → persist
      </div>
    </div>
  );
}
