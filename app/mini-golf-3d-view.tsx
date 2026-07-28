"use client";

import {
  MutableRefObject,
  useEffect,
  useRef,
} from "react";
import * as THREE from "three";
import {
  getMiniGolfMovingObstaclePose,
  getMiniGolfTerrainElevation,
  type MiniGolfCourse,
  type MiniGolfMovingObstacle,
  type MiniGolfPoint,
  type MiniGolfRect,
} from "./mini-golf-courses";

const WORLD_WIDTH = 32;
const WORLD_DEPTH = 18;
const GROUND_HEIGHT = 0.22;

const PLAYER_COLORS = [
  "#ff4d6d",
  "#4dabf7",
  "#ffd43b",
  "#69db7c",
  "#da77f2",
  "#ffa94d",
  "#38d9a9",
  "#748ffc",
  "#f06595",
  "#66d9e8",
  "#a9e34b",
  "#ff8787",
  "#9775fa",
  "#20c997",
  "#fcc419",
  "#74c0fc",
];

export type MiniGolf3DBallMotion = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
  rotation: number;
  sinking: boolean;
  sinkStartedAt: number;
};

export type MiniGolf3DPlayer = {
  id: string;
  username: string;
  seat_index: number;
  current_hole: number;
  ball_x: number | null;
  ball_y: number | null;
  hole_completed: boolean;
  player_status: "playing" | "finished" | "dnf";
};

type DynamicSceneState = {
  players: MiniGolf3DPlayer[];
  currentPlayer: MiniGolf3DPlayer | null;
  viewedHole: number;
  ballRef: MutableRefObject<MiniGolf3DBallMotion>;
  isAiming: boolean;
  aimOrigin: MiniGolfPoint | null;
  aimPoint: MiniGolfPoint | null;
  interactive: boolean;
  maxDragDistance: number;
  onAimStart: (point: MiniGolfPoint) => void;
  onAimMove: (point: MiniGolfPoint) => void;
  onAimEnd: (point: MiniGolfPoint) => void;
  onAimCancel: () => void;
};

type BallObject = {
  root: THREE.Group;
  sphere: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshPhysicalMaterial
  >;
  label: THREE.Sprite;
  ring: THREE.Mesh<
    THREE.TorusGeometry,
    THREE.MeshBasicMaterial
  >;
};

type ScenicOccluder = {
  root: THREE.Group;
  center: THREE.Vector3;
  radius: number;
};

type MovingObstacleObject = {
  obstacle: MiniGolfMovingObstacle;
  root: THREE.Group;
  movingPart: THREE.Mesh;
};

type CameraController = {
  resetBehindBall: () => void;
  rotate: (direction: -1 | 1) => void;
  zoom: (direction: -1 | 1) => void;
};

type CameraGesture =
  | {
      mode: "aim";
      pointerId: number;
    }
  | {
      mode: "orbit";
      pointerId: number;
      lastX: number;
      lastY: number;
    }
  | null;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function seededNoise(index: number, seed: number) {
  const value =
    Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function courseToWorld(
  point: MiniGolfPoint,
  course: MiniGolfCourse,
) {
  return new THREE.Vector3(
    (point.x - 0.5) * WORLD_WIDTH,
    GROUND_HEIGHT + getMiniGolfTerrainElevation(point, course),
    (point.y - 0.5) * WORLD_DEPTH,
  );
}

function worldToCourse(point: THREE.Vector3): MiniGolfPoint {
  return {
    x: clamp(point.x / WORLD_WIDTH + 0.5, 0, 1),
    y: clamp(point.z / WORLD_DEPTH + 0.5, 0, 1),
  };
}

function pointInRect(
  x: number,
  y: number,
  rect: MiniGolfRect,
) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

function themePalette(theme: MiniGolfCourse["theme"]) {
  switch (theme) {
    case "coast":
      return {
        sky: "#75d7ff",
        fog: "#bcecff",
        ground: "#147d4b",
        grass: "#2fcf72",
        grassLight: "#7cf0a3",
        grassDark: "#0e6d3d",
        border: "#f1d49a",
        borderDark: "#8a4f20",
        ambient: "#dffaff",
      };
    case "desert":
      return {
        sky: "#ffc868",
        fog: "#ffe8b0",
        ground: "#8d6724",
        grass: "#85c934",
        grassLight: "#c6ed64",
        grassDark: "#4f8a20",
        border: "#e7b65b",
        borderDark: "#7a3f17",
        ambient: "#fff1c7",
      };
    case "night":
      return {
        sky: "#10163b",
        fog: "#242a68",
        ground: "#063f35",
        grass: "#079969",
        grassLight: "#3bd9a0",
        grassDark: "#035d4b",
        border: "#5fe4ed",
        borderDark: "#232b78",
        ambient: "#91efff",
      };
    default:
      return {
        sky: "#86cfff",
        fog: "#d4f3ff",
        ground: "#155f38",
        grass: "#31bd62",
        grassLight: "#7ce889",
        grassDark: "#126b36",
        border: "#c99450",
        borderDark: "#663511",
        ambient: "#e5ffe9",
      };
  }
}

function makeTurfTexture(
  renderer: THREE.WebGLRenderer,
  course: MiniGolfCourse,
) {
  const palette = themePalette(course.theme);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 576;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const gradient = context.createLinearGradient(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  gradient.addColorStop(0, palette.grassLight);
  gradient.addColorStop(0.5, palette.grass);
  gradient.addColorStop(1, palette.grassDark);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let stripe = 0; stripe < 18; stripe += 1) {
    context.fillStyle =
      stripe % 2 === 0
        ? "rgba(255,255,255,0.055)"
        : "rgba(0,25,10,0.06)";
    context.fillRect(
      stripe * (canvas.width / 18),
      0,
      canvas.width / 18,
      canvas.height,
    );
  }

  for (let index = 0; index < 4200; index += 1) {
    const x =
      seededNoise(index, course.id * 11.7) * canvas.width;
    const y =
      seededNoise(index, course.id * 17.3) * canvas.height;
    const length =
      1 + seededNoise(index, course.id * 23.9) * 4;
    context.strokeStyle =
      index % 4 === 0
        ? "rgba(230,255,220,0.2)"
        : index % 3 === 0
          ? "rgba(0,65,25,0.25)"
          : "rgba(140,235,145,0.16)";
    context.lineWidth = index % 7 === 0 ? 1.4 : 0.8;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(
      x +
        (seededNoise(index, course.id * 31.1) - 0.5) * 2,
      y - length,
    );
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function makeSandTexture(
  renderer: THREE.WebGLRenderer,
  course: MiniGolfCourse,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, "#fff1bd");
  gradient.addColorStop(0.45, "#e9bd68");
  gradient.addColorStop(1, "#b66a25");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  for (let index = 0; index < 1800; index += 1) {
    const x = seededNoise(index, course.id * 37.2) * 512;
    const y = seededNoise(index, course.id * 42.8) * 512;
    const radius =
      0.4 + seededNoise(index, course.id * 51.4) * 1.7;
    context.fillStyle =
      index % 4 === 0
        ? "rgba(255,255,235,0.7)"
        : "rgba(117,62,20,0.28)";
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = "rgba(132,72,22,0.23)";
  context.lineWidth = 3;
  for (let y = 12; y < 512; y += 18) {
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(150, y - 9, 360, y + 9, 512, y);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function makeGolfBumpTexture(renderer: THREE.WebGLRenderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#d8d8d8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < 24; row += 1) {
    for (let column = 0; column < 48; column += 1) {
      const x = column * 11 + (row % 2) * 5.5;
      const y = row * 11;
      const dimple = context.createRadialGradient(
        x - 1.6,
        y - 1.8,
        0,
        x,
        y,
        4.7,
      );
      dimple.addColorStop(0, "#f7f7f7");
      dimple.addColorStop(0.28, "#e5e5e5");
      dimple.addColorStop(0.63, "#858585");
      dimple.addColorStop(0.82, "#b5b5b5");
      dimple.addColorStop(1, "#dedede");
      context.fillStyle = dimple;
      context.beginPath();
      context.arc(x, y, 4.8, 0, Math.PI * 2);
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.1, 1.1);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function makeTurfBumpTexture(
  renderer: THREE.WebGLRenderer,
  course: MiniGolfCourse,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 288;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#858585";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < 7200; index += 1) {
    const x = seededNoise(index, course.id * 147.1) * canvas.width;
    const y = seededNoise(index, course.id * 151.7) * canvas.height;
    const length =
      1.2 + seededNoise(index, course.id * 157.3) * 3.4;
    const brightness =
      95 + Math.floor(seededNoise(index, course.id * 163.9) * 95);
    context.strokeStyle = `rgb(${brightness},${brightness},${brightness})`;
    context.lineWidth = index % 5 === 0 ? 1.25 : 0.7;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(
      x + (seededNoise(index, course.id * 167.2) - 0.5) * 1.5,
      y - length,
    );
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.4, 2.4);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function makeTurfAlphaTexture(course: MiniGolfCourse) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 576;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";
  for (const water of course.water) {
    context.fillRect(
      water.x * canvas.width,
      water.y * canvas.height,
      water.width * canvas.width,
      water.height * canvas.height,
    );
  }

  context.beginPath();
  context.ellipse(
    course.hole.x * canvas.width,
    course.hole.y * canvas.height,
    0.0155 * canvas.width,
    0.026 * canvas.height,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function makeCloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);

  const puffs = [
    [70, 72, 50],
    [112, 52, 58],
    [155, 69, 51],
    [126, 82, 66],
  ] as const;
  for (const [x, y, radius] of puffs) {
    const gradient = context.createRadialGradient(
      x,
      y,
      4,
      x,
      y,
      radius,
    );
    gradient.addColorStop(0, "rgba(255,255,255,0.92)");
    gradient.addColorStop(0.55, "rgba(248,252,255,0.72)");
    gradient.addColorStop(1, "rgba(235,247,255,0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLabelSprite(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(3,7,18,0.84)";
    context.beginPath();
    context.roundRect(8, 10, 496, 102, 28);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 6;
    context.stroke();
    context.font = "bold 48px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.fillText(text, 256, 64, 450);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.75, 0.44, 1);
  sprite.position.set(0, 0.65, 0);
  sprite.renderOrder = 20;
  return sprite;
}

function addBox(
  scene: THREE.Scene,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth, 2, 2, 2),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function makeRectangularBasinBank(
  width: number,
  depth: number,
  bankWidth: number,
  drop: number,
) {
  const outer = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ] as const;
  const inner = [
    [-width / 2 + bankWidth, -depth / 2 + bankWidth],
    [width / 2 - bankWidth, -depth / 2 + bankWidth],
    [width / 2 - bankWidth, depth / 2 - bankWidth],
    [-width / 2 + bankWidth, depth / 2 - bankWidth],
  ] as const;
  const vertices: number[] = [];
  for (const [x, z] of outer) vertices.push(x, 0, z);
  for (const [x, z] of inner) vertices.push(x, -drop, z);

  const indices: number[] = [];
  for (let side = 0; side < 4; side += 1) {
    const next = (side + 1) % 4;
    indices.push(side, next, 4 + next);
    indices.push(side, 4 + next, 4 + side);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeCupDepressionGeometry(
  outerRadius: number,
  innerRadius: number,
  depth: number,
) {
  const segments = 72;
  const ringRadii = [
    outerRadius,
    outerRadius * 0.72,
    innerRadius,
  ];
  const ringHeights = [0, -depth * 0.28, -depth];
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring < ringRadii.length; ring += 1) {
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      vertices.push(
        Math.cos(angle) * ringRadii[ring],
        ringHeights[ring],
        Math.sin(angle) * ringRadii[ring],
      );
    }
  }

  for (let ring = 0; ring < ringRadii.length - 1; ring += 1) {
    const firstRingStart = ring * (segments + 1);
    const secondRingStart = (ring + 1) * (segments + 1);
    for (let segment = 0; segment < segments; segment += 1) {
      const first = firstRingStart + segment;
      const nextFirst = first + 1;
      const second = secondRingStart + segment;
      const nextSecond = second + 1;
      indices.push(first, second, nextFirst);
      indices.push(nextFirst, second, nextSecond);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createBallObject(
  scene: THREE.Scene,
  player: MiniGolf3DPlayer,
  bumpTexture: THREE.Texture | null,
  currentUserId: string | null,
) {
  const color =
    PLAYER_COLORS[player.seat_index % PLAYER_COLORS.length];
  const root = new THREE.Group();
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.4,
    metalness: 0.03,
    clearcoat: 0.88,
    clearcoatRoughness: 0.2,
    bumpMap: bumpTexture,
    bumpScale: 0.062,
  });
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 64, 48),
    material,
  );
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  root.add(sphere);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.25, 0.025, 10, 40),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: player.id === currentUserId ? 0.95 : 0.45,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.165;
  root.add(ring);

  const label = makeLabelSprite(
    player.id === currentUserId
      ? "Bạn"
      : player.username.slice(0, 12),
    color,
  );
  root.add(label);
  scene.add(root);
  return { root, sphere, label, ring } satisfies BallObject;
}

export default function MiniGolf3DView({
  course,
  viewedHole,
  players,
  currentPlayer,
  ballRef,
  isAiming,
  aimOrigin,
  aimPoint,
  interactive,
  maxDragDistance,
  onAimStart,
  onAimMove,
  onAimEnd,
  onAimCancel,
  holeCount,
  holeStrokes,
  maxHoleStrokes,
}: {
  course: MiniGolfCourse;
  viewedHole: number;
  players: MiniGolf3DPlayer[];
  currentPlayer: MiniGolf3DPlayer | null;
  ballRef: MutableRefObject<MiniGolf3DBallMotion>;
  isAiming: boolean;
  aimOrigin: MiniGolfPoint | null;
  aimPoint: MiniGolfPoint | null;
  interactive: boolean;
  maxDragDistance: number;
  onAimStart: (point: MiniGolfPoint) => void;
  onAimMove: (point: MiniGolfPoint) => void;
  onAimEnd: (point: MiniGolfPoint) => void;
  onAimCancel: () => void;
  holeCount: number;
  holeStrokes: number | null;
  maxHoleStrokes: number;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const dynamicRef = useRef<DynamicSceneState>({
    players,
    currentPlayer,
    viewedHole,
    ballRef,
    isAiming,
    aimOrigin,
    aimPoint,
    interactive,
    maxDragDistance,
    onAimStart,
    onAimMove,
    onAimEnd,
    onAimCancel,
  });

  useEffect(() => {
    dynamicRef.current = {
      players,
      currentPlayer,
      viewedHole,
      ballRef,
      isAiming,
      aimOrigin,
      aimPoint,
      interactive,
      maxDragDistance,
      onAimStart,
      onAimMove,
      onAimEnd,
      onAimCancel,
    };
  }, [
    aimOrigin,
    aimPoint,
    ballRef,
    currentPlayer,
    interactive,
    isAiming,
    maxDragDistance,
    onAimCancel,
    onAimEnd,
    onAimMove,
    onAimStart,
    players,
    viewedHole,
  ]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    mount.replaceChildren();
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      const message = document.createElement("div");
      message.className =
        "flex h-full w-full items-center justify-center bg-slate-950 p-8 text-center text-red-300";
      message.textContent =
        "Trình duyệt hoặc card đồ họa chưa hỗ trợ WebGL 3D.";
      mount.appendChild(message);
      return;
    }

    const palette = themePalette(course.theme);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(palette.sky);
    scene.fog = new THREE.FogExp2(
      palette.fog,
      course.theme === "night" ? 0.018 : 0.012,
    );

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(
      Math.max(1, mount.clientWidth),
      Math.max(1, mount.clientHeight),
      false,
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure =
      course.theme === "night" ? 1.2 : 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    mount.appendChild(renderer.domElement);

    const courseStart = courseToWorld(course.start, course);
    const courseHole = courseToWorld(course.hole, course);
    const initialCourseDirection = courseHole
      .clone()
      .sub(courseStart)
      .setY(0)
      .normalize();
    const cameraOrbit = {
      yaw: Math.atan2(
        -initialCourseDirection.x,
        -initialCourseDirection.z,
      ),
      pitch: 0.34,
      distance: 7.2,
      target: courseStart
        .clone()
        .add(new THREE.Vector3(0, 0.28, 0)),
    };
    const camera = new THREE.PerspectiveCamera(54, 1, 0.08, 120);
    const cameraLookTarget = cameraOrbit.target.clone();
    const resetCameraBehindBall = () => {
      const latest = dynamicRef.current;
      const focusPoint = latest.currentPlayer
        ? {
            x: latest.ballRef.current.x,
            y: latest.ballRef.current.y,
          }
        : course.start;
      const focus = courseToWorld(focusPoint, course);
      const toHole = courseHole.clone().sub(focus).setY(0);
      if (toHole.lengthSq() < 0.001) {
        toHole.set(0, 0, -1);
      } else {
        toHole.normalize();
      }
      cameraOrbit.yaw = Math.atan2(-toHole.x, -toHole.z);
      cameraOrbit.pitch = 0.34;
      cameraOrbit.distance = 7.2;
      cameraOrbit.target.copy(focus);
      cameraOrbit.target.y += 0.28;
      cameraLookTarget.copy(cameraOrbit.target);
    };
    cameraControllerRef.current = {
      resetBehindBall: resetCameraBehindBall,
      rotate: (direction) => {
        cameraOrbit.yaw += direction * Math.PI * 0.16;
      },
      zoom: (direction) => {
        cameraOrbit.distance = clamp(
          cameraOrbit.distance + direction * 0.75,
          3.6,
          14.5,
        );
      },
    };
    resetCameraBehindBall();
    const initialHorizontalDistance =
      Math.cos(cameraOrbit.pitch) * cameraOrbit.distance;
    camera.position.set(
      cameraOrbit.target.x +
        Math.sin(cameraOrbit.yaw) * initialHorizontalDistance,
      cameraOrbit.target.y +
        0.72 +
        Math.sin(cameraOrbit.pitch) * cameraOrbit.distance,
      cameraOrbit.target.z +
        Math.cos(cameraOrbit.yaw) * initialHorizontalDistance,
    );
    camera.lookAt(cameraLookTarget);

    const hemisphere = new THREE.HemisphereLight(
      palette.ambient,
      palette.ground,
      course.theme === "night" ? 1.4 : 1.75,
    );
    scene.add(hemisphere);

    const sunlight = new THREE.DirectionalLight(
      course.theme === "night" ? "#8bdcff" : "#fff5d8",
      course.theme === "night" ? 2.2 : 3.1,
    );
    sunlight.position.set(-7, 14, 9);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.camera.left = -19;
    sunlight.shadow.camera.right = 19;
    sunlight.shadow.camera.top = 15;
    sunlight.shadow.camera.bottom = -15;
    sunlight.shadow.camera.near = 1;
    sunlight.shadow.camera.far = 35;
    sunlight.shadow.bias = -0.00015;
    scene.add(sunlight);

    if (course.theme === "night") {
      const moonLight = new THREE.PointLight(
        "#67e8f9",
        24,
        26,
        1.8,
      );
      moonLight.position.set(7, 8, -5);
      scene.add(moonLight);
    }

    const fillLight = new THREE.DirectionalLight(
      course.theme === "night" ? "#725cff" : "#91d8ff",
      course.theme === "night" ? 0.85 : 0.62,
    );
    fillLight.position.set(8, 7, -10);
    scene.add(fillLight);

    const skyTop =
      course.theme === "night"
        ? "#07102e"
        : course.theme === "desert"
          ? "#278bd2"
          : "#1677c8";
    const skyHorizon =
      course.theme === "night"
        ? "#4b3a82"
        : course.theme === "desert"
          ? "#ffd08a"
          : "#c9efff";
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(72, 40, 22),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          topColor: { value: new THREE.Color(skyTop) },
          horizonColor: { value: new THREE.Color(skyHorizon) },
          exponent: { value: course.theme === "night" ? 0.7 : 0.9 },
        },
        vertexShader: `
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          uniform float exponent;
          varying vec3 vWorldPosition;
          void main() {
            float heightMix = pow(max(normalize(vWorldPosition).y, 0.0), exponent);
            gl_FragColor = vec4(mix(horizonColor, topColor, heightMix), 1.0);
          }
        `,
      }),
    );
    scene.add(skyDome);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(course.theme === "night" ? 1.25 : 1.8, 32, 18),
      new THREE.MeshBasicMaterial({
        color: course.theme === "night" ? "#d9f4ff" : "#fff3bb",
        fog: false,
      }),
    );
    sun.position.set(-25, course.theme === "night" ? 19 : 24, -38);
    scene.add(sun);

    const cloudTexture =
      course.theme === "night" ? null : makeCloudTexture();
    if (cloudTexture) {
      for (let cloudIndex = 0; cloudIndex < 11; cloudIndex += 1) {
        const cloud = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: cloudTexture,
            transparent: true,
            opacity:
              0.4 + seededNoise(cloudIndex, course.id * 197.5) * 0.3,
            depthWrite: false,
            fog: true,
          }),
        );
        const angle =
          seededNoise(cloudIndex, course.id * 199.9) * Math.PI * 2;
        const radius =
          25 + seededNoise(cloudIndex, course.id * 211.2) * 17;
        cloud.position.set(
          Math.sin(angle) * radius,
          8 + seededNoise(cloudIndex, course.id * 223.4) * 7,
          Math.cos(angle) * radius,
        );
        const scale =
          5.5 + seededNoise(cloudIndex, course.id * 227.8) * 6;
        cloud.scale.set(scale * 1.9, scale, 1);
        scene.add(cloud);
      }
    }

    const landscapeMaterial = new THREE.MeshStandardMaterial({
      color: palette.ground,
      roughness: 1,
    });
    const landscape = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 60),
      landscapeMaterial,
    );
    landscape.rotation.x = -Math.PI / 2;
    landscape.position.y = -0.34;
    landscape.receiveShadow = true;
    scene.add(landscape);

    const distantHillMaterial = new THREE.MeshStandardMaterial({
      color:
        course.theme === "desert"
          ? "#8f6533"
          : course.theme === "night"
            ? "#132a54"
            : "#245b3f",
      roughness: 1,
      flatShading: true,
    });
    for (let hillIndex = 0; hillIndex < 16; hillIndex += 1) {
      const angle = (hillIndex / 16) * Math.PI * 2;
      const radius =
        31 + seededNoise(hillIndex, course.id * 229.4) * 11;
      const height =
        4.4 + seededNoise(hillIndex, course.id * 233.7) * 6.2;
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(
          3.2 + height * 0.45,
          height,
          7,
        ),
        distantHillMaterial,
      );
      hill.position.set(
        Math.sin(angle) * radius,
        -0.65 + height / 2,
        Math.cos(angle) * radius,
      );
      hill.rotation.y =
        seededNoise(hillIndex, course.id * 239.1) * Math.PI;
      hill.receiveShadow = true;
      scene.add(hill);
    }

    const turfTexture = makeTurfTexture(renderer, course);
    const turfBumpTexture = makeTurfBumpTexture(renderer, course);
    const turfAlphaTexture = makeTurfAlphaTexture(course);
    const turfGeometry = new THREE.PlaneGeometry(
      WORLD_WIDTH,
      WORLD_DEPTH,
      120,
      70,
    );
    turfGeometry.rotateX(-Math.PI / 2);
    const turfPositions = turfGeometry.attributes
      .position as THREE.BufferAttribute;
    for (
      let index = 0;
      index < turfPositions.count;
      index += 1
    ) {
      const x = turfPositions.getX(index);
      const z = turfPositions.getZ(index);
      const coursePoint = {
        x: x / WORLD_WIDTH + 0.5,
        y: z / WORLD_DEPTH + 0.5,
      };
      const edge =
        Math.min(
          WORLD_WIDTH / 2 - Math.abs(x),
          WORLD_DEPTH / 2 - Math.abs(z),
        ) / 2;
      const bump =
        (seededNoise(index, course.id * 61.7) - 0.5) *
        0.035 *
        clamp(edge, 0, 1);
      turfPositions.setY(
        index,
        GROUND_HEIGHT +
          getMiniGolfTerrainElevation(coursePoint, course) +
          bump,
      );
    }
    turfGeometry.computeVertexNormals();
    const turfMaterial = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      map: turfTexture,
      alphaMap: turfAlphaTexture,
      alphaTest: 0.48,
      transparent: true,
      bumpMap: turfBumpTexture,
      bumpScale: 0.045,
      roughness: 0.88,
      metalness: 0,
      sheen: 0.28,
      sheenColor: new THREE.Color(palette.grassLight),
      sheenRoughness: 0.86,
    });
    const turf = new THREE.Mesh(turfGeometry, turfMaterial);
    turf.receiveShadow = true;
    scene.add(turf);

    const sandTexture = makeSandTexture(renderer, course);
    const sandMaterial = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: sandTexture,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    for (const sand of course.sand) {
      const width = sand.width * WORLD_WIDTH;
      const depth = sand.height * WORLD_DEPTH;
      const center = courseToWorld({
        x: sand.x + sand.width / 2,
        y: sand.y + sand.height / 2,
      }, course);
      const geometry = new THREE.PlaneGeometry(
        width,
        depth,
        16,
        10,
      );
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.attributes
        .position as THREE.BufferAttribute;
      for (
        let index = 0;
        index < positions.count;
        index += 1
      ) {
        positions.setY(
          index,
          (seededNoise(index, course.id * 71.2) - 0.5) *
            0.04,
        );
      }
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, sandMaterial);
      mesh.position.set(center.x, center.y + 0.025, center.z);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }

    const waterMeshes: Array<{
      mesh: THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.MeshPhysicalMaterial
      >;
      base: Float32Array;
      phase: number;
    }> = [];
    const basinBankMaterial = new THREE.MeshStandardMaterial({
      color:
        course.theme === "desert"
          ? "#7c4a1d"
          : course.theme === "night"
            ? "#123f4a"
            : "#315b2f",
      roughness: 0.98,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const basinFloorMaterial = new THREE.MeshStandardMaterial({
      color: course.theme === "night" ? "#021b32" : "#064e68",
      roughness: 0.62,
      metalness: 0.04,
    });
    for (let waterIndex = 0; waterIndex < course.water.length; waterIndex += 1) {
      const water = course.water[waterIndex];
      const width = water.width * WORLD_WIDTH;
      const depth = water.height * WORLD_DEPTH;
      const center = courseToWorld({
        x: water.x + water.width / 2,
        y: water.y + water.height / 2,
      }, course);
      const bankWidth = Math.max(
        0.18,
        Math.min(0.44, width * 0.16, depth * 0.2),
      );
      const basinDrop = 0.24;
      const innerWidth = Math.max(0.3, width - bankWidth * 1.7);
      const innerDepth = Math.max(0.3, depth - bankWidth * 1.7);
      const waterSurfaceY = center.y - basinDrop + 0.04;

      const bank = new THREE.Mesh(
        makeRectangularBasinBank(
          width,
          depth,
          bankWidth,
          basinDrop,
        ),
        basinBankMaterial,
      );
      bank.position.set(center.x, center.y + 0.015, center.z);
      bank.receiveShadow = true;
      scene.add(bank);

      addBox(
        scene,
        innerWidth,
        0.1,
        innerDepth,
        center.x,
        waterSurfaceY - 0.11,
        center.z,
        basinFloorMaterial,
      );

      const geometry = new THREE.PlaneGeometry(
        innerWidth,
        innerDepth,
        22,
        14,
      );
      const material = new THREE.MeshPhysicalMaterial({
        color: course.theme === "night" ? "#0ea5e9" : "#38bdf8",
        roughness: 0.08,
        metalness: 0.06,
        transparent: true,
        opacity: 0.84,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        transmission: 0.2,
        thickness: 0.28,
        ior: 1.333,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(center.x, waterSurfaceY, center.z);
      mesh.receiveShadow = true;
      scene.add(mesh);
      waterMeshes.push({
        mesh,
        base: new Float32Array(
          (geometry.attributes.position as THREE.BufferAttribute)
            .array,
        ),
        phase: waterIndex * 1.7 + course.id,
      });
    }

    const wallMaterial = new THREE.MeshPhysicalMaterial({
      color: course.theme === "night" ? "#3d5b89" : "#65758b",
      roughness: 0.24,
      metalness: 0.78,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
    });
    const wallTopMaterial = new THREE.MeshPhysicalMaterial({
      color: course.theme === "night" ? "#7c9ee0" : "#b8c9dc",
      roughness: 0.2,
      metalness: 0.82,
      clearcoat: 0.7,
    });
    const boltGeometry = new THREE.SphereGeometry(0.055, 14, 8);
    const boltMaterial = new THREE.MeshStandardMaterial({
      color: "#e8f1fa",
      roughness: 0.18,
      metalness: 0.92,
    });

    const boundaryMaterial = new THREE.MeshPhysicalMaterial({
      color:
        course.theme === "night"
          ? "#465f91"
          : course.theme === "desert"
            ? "#a4642b"
            : "#8a542a",
      roughness: 0.48,
      metalness: course.theme === "night" ? 0.52 : 0.16,
      clearcoat: 0.58,
      clearcoatRoughness: 0.3,
    });
    for (const rail of course.boundaryRails) {
      const from = clamp(Math.min(rail.from, rail.to), 0, 1);
      const to = clamp(Math.max(rail.from, rail.to), 0, 1);
      const edgeCenter = (from + to) / 2;
      const isHorizontal =
        rail.side === "top" || rail.side === "bottom";
      const coursePoint = isHorizontal
        ? {
            x: edgeCenter,
            y: rail.side === "top" ? 0.02 : 0.98,
          }
        : {
            x: rail.side === "left" ? 0.02 : 0.98,
            y: edgeCenter,
          };
      const center = courseToWorld(coursePoint, course);
      const width = isHorizontal
        ? Math.max(0.18, (to - from) * WORLD_WIDTH)
        : 0.26;
      const depth = isHorizontal
        ? 0.26
        : Math.max(0.18, (to - from) * WORLD_DEPTH);
      const railHeight = 0.58;
      const mesh = addBox(
        scene,
        width,
        railHeight,
        depth,
        center.x,
        center.y + railHeight / 2,
        center.z,
        boundaryMaterial,
      );
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({
          color:
            course.theme === "night" ? "#a9c7ff" : "#f6d49a",
          transparent: true,
          opacity: 0.58,
        }),
      );
      mesh.add(edge);
    }

    for (const obstacle of course.obstacles) {
      const width = obstacle.width * WORLD_WIDTH;
      const depth = obstacle.height * WORLD_DEPTH;
      const center = courseToWorld({
        x: obstacle.x + obstacle.width / 2,
        y: obstacle.y + obstacle.height / 2,
      }, course);
      const height = 0.76;
      const mesh = addBox(
        scene,
        width,
        height,
        depth,
        center.x,
        center.y + height / 2,
        center.z,
        wallMaterial,
      );
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({
          color: "#d9e7f5",
          transparent: true,
          opacity: 0.72,
        }),
      );
      mesh.add(edge);

      const topPanel = addBox(
        scene,
        Math.max(0.12, width - 0.08),
        0.065,
        Math.max(0.12, depth - 0.08),
        center.x,
        center.y + height + 0.015,
        center.z,
        wallTopMaterial,
      );
      topPanel.castShadow = true;
      for (const xDirection of [-1, 1]) {
        for (const zDirection of [-1, 1]) {
          const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
          bolt.scale.y = 0.45;
          bolt.position.set(
            center.x + xDirection * Math.max(0, width / 2 - 0.12),
            center.y + height + 0.065,
            center.z + zDirection * Math.max(0, depth / 2 - 0.12),
          );
          bolt.castShadow = true;
          scene.add(bolt);
        }
      }
    }

    const rockMaterial = new THREE.MeshStandardMaterial({
      color: course.theme === "desert" ? "#8f6a45" : "#526171",
      roughness: 0.84,
      metalness: 0.04,
      flatShading: true,
    });
    for (const obstacle of course.roundObstacles) {
      const center = courseToWorld(obstacle, course);
      const radius = obstacle.radius * WORLD_WIDTH;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(radius, 2),
        rockMaterial,
      );
      rock.scale.y = 0.72;
      rock.position.set(
        center.x,
        center.y + radius * 0.63,
        center.z,
      );
      rock.rotation.set(
        seededNoise(obstacle.x * 1000, course.id) * 0.4,
        seededNoise(obstacle.y * 1000, course.id) * Math.PI,
        0,
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
    }

    const movingObstacleMaterial =
      new THREE.MeshPhysicalMaterial({
        color:
          course.theme === "night" ? "#8b5cf6" : "#f97316",
        emissive:
          course.theme === "night" ? "#6d28d9" : "#9a3412",
        emissiveIntensity: 0.42,
        roughness: 0.28,
        metalness: 0.66,
        clearcoat: 0.72,
        clearcoatRoughness: 0.2,
      });
    const movingObstacleObjects: MovingObstacleObject[] = [];
    for (const obstacle of course.movingObstacles) {
      const root = new THREE.Group();
      const pose = getMiniGolfMovingObstaclePose(
        obstacle,
        Date.now(),
      );
      const center = courseToWorld(pose, course);
      let movingPart: THREE.Mesh;

      if (obstacle.shape === "circle") {
        const radius =
          (obstacle.radius ?? 0.04) * WORLD_WIDTH;
        movingPart = new THREE.Mesh(
          new THREE.IcosahedronGeometry(radius, 3),
          movingObstacleMaterial,
        );
        movingPart.position.y = radius * 0.85;
      } else {
        const width =
          (obstacle.width ?? 0.04) * WORLD_WIDTH;
        const depth =
          (obstacle.height ?? 0.16) * WORLD_DEPTH;
        movingPart = new THREE.Mesh(
          new THREE.BoxGeometry(width, 0.72, depth, 3, 2, 3),
          movingObstacleMaterial,
        );
        movingPart.position.y = 0.38;
        const warningStripe = new THREE.Mesh(
          new THREE.BoxGeometry(
            Math.max(0.12, width - 0.04),
            0.08,
            Math.max(0.12, depth - 0.04),
          ),
          new THREE.MeshBasicMaterial({
            color: "#fde047",
            transparent: true,
            opacity: 0.86,
          }),
        );
        warningStripe.position.y = 0.4;
        movingPart.add(warningStripe);
      }

      movingPart.castShadow = true;
      movingPart.receiveShadow = true;
      root.add(movingPart);
      root.position.set(center.x, center.y, center.z);
      scene.add(root);
      movingObstacleObjects.push({
        obstacle,
        root,
        movingPart,
      });
    }

    const bladeGeometry = new THREE.ConeGeometry(
      0.014,
      0.09,
      3,
    );
    bladeGeometry.translate(0, 0.045, 0);
    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: palette.grassLight,
      roughness: 1,
    });
    const bladeTarget = 520;
    const blades = new THREE.InstancedMesh(
      bladeGeometry,
      bladeMaterial,
      bladeTarget,
    );
    const dummy = new THREE.Object3D();
    let bladeCount = 0;
    for (
      let index = 0;
      index < bladeTarget * 3 && bladeCount < bladeTarget;
      index += 1
    ) {
      const x = 0.045 + seededNoise(index, course.id * 83.3) * 0.91;
      const y = 0.045 + seededNoise(index, course.id * 89.7) * 0.91;
      const blocked = [
        ...course.water,
        ...course.sand,
        ...course.obstacles,
      ].some((rect) => pointInRect(x, y, rect));
      if (blocked) continue;
      const world = courseToWorld({ x, y }, course);
      dummy.position.set(
        world.x,
        world.y + 0.015,
        world.z,
      );
      dummy.rotation.y =
        seededNoise(index, course.id * 97.1) * Math.PI;
      const scale =
        0.65 + seededNoise(index, course.id * 101.8) * 0.75;
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      blades.setMatrixAt(bladeCount, dummy.matrix);
      blades.setColorAt(
        bladeCount,
        new THREE.Color(
          index % 3 === 0
            ? palette.grassLight
            : palette.grassDark,
        ),
      );
      bladeCount += 1;
    }
    blades.count = bladeCount;
    blades.instanceMatrix.needsUpdate = true;
    if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
    blades.receiveShadow = true;
    scene.add(blades);

    const hole = courseToWorld(course.hole, course);
    const holeGroundY = hole.y;
    const cupDepth = 0.36;
    const depression = new THREE.Mesh(
      makeCupDepressionGeometry(0.39, 0.175, cupDepth),
      new THREE.MeshStandardMaterial({
        color:
          course.theme === "desert"
            ? "#6f4b22"
            : palette.grassDark,
        roughness: 0.96,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    depression.position.set(
      hole.x,
      holeGroundY + 0.018,
      hole.z,
    );
    depression.receiveShadow = true;
    scene.add(depression);

    const cupMaterial = new THREE.MeshPhysicalMaterial({
      color: "#05070b",
      roughness: 0.54,
      metalness: 0.16,
      clearcoat: 0.25,
      side: THREE.DoubleSide,
    });
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.175,
        0.145,
        cupDepth,
        48,
        3,
        true,
      ),
      cupMaterial,
    );
    cup.position.set(
      hole.x,
      holeGroundY - cupDepth * 0.54,
      hole.z,
    );
    cup.receiveShadow = true;
    scene.add(cup);

    const cupBottom = new THREE.Mesh(
      new THREE.CircleGeometry(0.145, 48),
      new THREE.MeshStandardMaterial({
        color: "#000000",
        roughness: 1,
      }),
    );
    cupBottom.rotation.x = -Math.PI / 2;
    cupBottom.position.set(
      hole.x,
      holeGroundY - cupDepth - 0.008,
      hole.z,
    );
    cupBottom.receiveShadow = true;
    scene.add(cupBottom);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.178, 0.012, 10, 48),
      new THREE.MeshStandardMaterial({
        color: "#d7dee6",
        roughness: 0.42,
        metalness: 0.38,
      }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(hole.x, holeGroundY - 0.012, hole.z);
    rim.castShadow = true;
    scene.add(rim);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.035, 2.25, 16),
      new THREE.MeshStandardMaterial({
        color: "#f8fafc",
        roughness: 0.22,
        metalness: 0.72,
      }),
    );
    pole.position.set(hole.x, holeGroundY - 0.72, hole.z);
    pole.castShadow = true;
    scene.add(pole);

    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(0.92, -0.24);
    flagShape.lineTo(0, -0.5);
    flagShape.closePath();
    const flag = new THREE.Mesh(
      new THREE.ShapeGeometry(flagShape),
      new THREE.MeshStandardMaterial({
        color: "#ef3340",
        roughness: 0.45,
        metalness: 0.03,
        side: THREE.DoubleSide,
      }),
    );
    flag.position.set(
      hole.x + 0.02,
      holeGroundY + 0.1,
      hole.z,
    );
    flag.castShadow = true;
    scene.add(flag);
    let flagLift = 0.22;

    const treeTrunkMaterial = new THREE.MeshStandardMaterial({
      color: "#754416",
      roughness: 0.94,
      bumpScale: 0.04,
    });
    const leafBase =
      course.theme === "desert"
        ? new THREE.Color("#829f32")
        : course.theme === "night"
          ? new THREE.Color("#087966")
          : new THREE.Color("#16874b");
    const leafMaterials = [-0.07, 0.03, 0.11].map(
      (lightnessOffset) =>
        new THREE.MeshStandardMaterial({
          color: leafBase.clone().offsetHSL(0, 0, lightnessOffset),
          roughness: 0.82,
          flatShading: true,
        }),
    );
    const scenicOccluders: ScenicOccluder[] = [];
    const treeCount =
      course.theme === "forest"
        ? 18
        : course.theme === "desert"
          ? 8
          : 12;
    for (let index = 0; index < treeCount; index += 1) {
      const angle =
        (index / treeCount) * Math.PI * 2 +
        (seededNoise(index, course.id * 109.3) - 0.5) * 0.18;
      const x =
        Math.sin(angle) *
        (17.5 + seededNoise(index, course.id * 113.7) * 5.2);
      const z =
        Math.cos(angle) *
        (12.5 + seededNoise(index, course.id * 127.3) * 4.5);
      const height =
        0.9 + seededNoise(index, course.id * 131.9) * 1.45;
      const tree = new THREE.Group();
      tree.position.set(x, 0, z);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.08 + height * 0.018,
          0.14 + height * 0.022,
          height,
          10,
        ),
        treeTrunkMaterial,
      );
      trunk.position.set(0, -0.25 + height / 2, 0);
      trunk.rotation.z =
        (seededNoise(index, course.id * 137.1) - 0.5) * 0.08;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      tree.add(trunk);

      for (let cluster = 0; cluster < 3; cluster += 1) {
        const crownRadius =
          0.48 +
          height * 0.12 +
          seededNoise(index + cluster * 31, course.id * 139.1) *
            0.22;
        const crown = new THREE.Mesh(
          new THREE.IcosahedronGeometry(crownRadius, 1),
          leafMaterials[cluster],
        );
        crown.scale.set(
          1.05,
          0.9 + cluster * 0.07,
          0.92,
        );
        crown.position.set(
          (cluster - 1) * crownRadius * 0.58,
          -0.18 + height + (cluster % 2) * crownRadius * 0.42,
          (seededNoise(index + cluster, course.id * 143.8) - 0.5) *
            crownRadius,
        );
        crown.rotation.set(
          seededNoise(index, cluster + 1) * 0.3,
          seededNoise(index, course.id * 149.2 + cluster) *
            Math.PI,
          0,
        );
        crown.castShadow = true;
        crown.receiveShadow = true;
        tree.add(crown);
      }
      scene.add(tree);
      scenicOccluders.push({
        root: tree,
        center: new THREE.Vector3(
          x,
          height + 0.35,
          z,
        ),
        radius: 1.05 + height * 0.34,
      });
    }

    const bumpTexture = makeGolfBumpTexture(renderer);
    const balls = new Map<string, BallObject>();
    const trailGeometry = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(18);
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(trailPositions, 3),
    );
    const trail = new THREE.Points(
      trailGeometry,
      new THREE.PointsMaterial({
        color: "#ffffff",
        size: 0.09,
        transparent: true,
        opacity: 0.46,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    trail.visible = false;
    scene.add(trail);

    const aimGuide = new THREE.Group();
    aimGuide.visible = false;
    scene.add(aimGuide);

    const aimArrowShape = new THREE.Shape();
    aimArrowShape.moveTo(-0.09, 0.14);
    aimArrowShape.lineTo(0.09, 0.14);
    aimArrowShape.lineTo(0.09, 0.62);
    aimArrowShape.lineTo(0.26, 0.62);
    aimArrowShape.lineTo(0, 1);
    aimArrowShape.lineTo(-0.26, 0.62);
    aimArrowShape.lineTo(-0.09, 0.62);
    aimArrowShape.closePath();
    const aimArrowGeometry = new THREE.ShapeGeometry(aimArrowShape);

    const aimArrowBackdropMaterial = new THREE.MeshBasicMaterial({
      color: "#07111f",
      transparent: true,
      opacity: 0.76,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const aimArrowBackdrop = new THREE.Mesh(
      aimArrowGeometry,
      aimArrowBackdropMaterial,
    );
    aimArrowBackdrop.rotation.x = Math.PI / 2;
    aimArrowBackdrop.position.y = 0.17;
    aimArrowBackdrop.renderOrder = 99;
    aimArrowBackdrop.frustumCulled = false;
    aimGuide.add(aimArrowBackdrop);

    const aimArrowMaterial = new THREE.MeshBasicMaterial({
      color: "#22c55e",
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const aimArrow2D = new THREE.Mesh(
      aimArrowGeometry,
      aimArrowMaterial,
    );
    aimArrow2D.rotation.x = Math.PI / 2;
    aimArrow2D.position.y = 0.18;
    aimArrow2D.renderOrder = 100;
    aimArrow2D.frustumCulled = false;
    aimGuide.add(aimArrow2D);

    const aimHaloMaterial = new THREE.MeshBasicMaterial({
      color: "#22c55e",
      transparent: true,
      opacity: 0.68,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const aimHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.035, 12, 64),
      aimHaloMaterial,
    );
    aimHalo.rotation.x = -Math.PI / 2;
    aimHalo.position.y = 0.19;
    aimHalo.renderOrder = 101;
    aimHalo.frustumCulled = false;
    aimGuide.add(aimHalo);

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -GROUND_HEIGHT,
    );
    const intersection = new THREE.Vector3();
    let gesture: CameraGesture = null;
    const pointerPositions = new Map<
      number,
      { x: number; y: number }
    >();
    let pinchDistance: number | null = null;

    const pointerToCourse = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const terrainHit = raycaster.intersectObject(turf, false)[0];
      if (terrainHit) {
        return worldToCourse(terrainHit.point);
      }
      const hit = raycaster.ray.intersectPlane(
        groundPlane,
        intersection,
      );
      return hit ? worldToCourse(intersection) : null;
    };

    const distanceFromCurrentBall = (point: MiniGolfPoint) => {
      const latest = dynamicRef.current;
      return Math.hypot(
        (point.x - latest.ballRef.current.x) * 1000,
        (point.y - latest.ballRef.current.y) * 560,
      );
    };

    const currentPinchDistance = () => {
      const positions = [...pointerPositions.values()];
      if (positions.length < 2) return null;
      return Math.hypot(
        positions[0].x - positions[1].x,
        positions[0].y - positions[1].y,
      );
    };

    const handlePointerDown = (event: PointerEvent) => {
      const latest = dynamicRef.current;
      event.preventDefault();
      pointerPositions.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      renderer.domElement.setPointerCapture(event.pointerId);

      if (pointerPositions.size >= 2) {
        if (gesture?.mode === "aim") {
          latest.onAimCancel();
        }
        gesture = null;
        pinchDistance = currentPinchDistance();
        renderer.domElement.style.cursor = "ns-resize";
        return;
      }

      const point = pointerToCourse(event);
      const motion = latest.ballRef.current;
      const canBeginAim =
        event.button === 0 &&
        latest.interactive &&
        !motion.moving &&
        !motion.sinking &&
        point !== null &&
        distanceFromCurrentBall(point) <= 54;

      if (canBeginAim && point) {
        gesture = {
          mode: "aim",
          pointerId: event.pointerId,
        };
        renderer.domElement.style.cursor = "crosshair";
        latest.onAimStart(point);
        return;
      }

      gesture = {
        mode: "orbit",
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      renderer.domElement.style.cursor = "grabbing";
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (pointerPositions.has(event.pointerId)) {
        pointerPositions.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
      }

      if (pointerPositions.size >= 2) {
        const nextPinchDistance = currentPinchDistance();
        if (
          nextPinchDistance !== null &&
          pinchDistance !== null
        ) {
          cameraOrbit.distance = clamp(
            cameraOrbit.distance -
              (nextPinchDistance - pinchDistance) * 0.018,
            3.6,
            14.5,
          );
        }
        pinchDistance = nextPinchDistance;
        return;
      }

      if (gesture?.pointerId === event.pointerId) {
        if (gesture.mode === "aim") {
          const point = pointerToCourse(event);
          if (point) dynamicRef.current.onAimMove(point);
          return;
        }

        const deltaX = event.clientX - gesture.lastX;
        const deltaY = event.clientY - gesture.lastY;
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
        cameraOrbit.yaw -= deltaX * 0.008;
        cameraOrbit.pitch = clamp(
          cameraOrbit.pitch - deltaY * 0.006,
          0.18,
          1.08,
        );
        return;
      }

      if (event.pointerType === "mouse") {
        const point = pointerToCourse(event);
        const canAim =
          point !== null &&
          dynamicRef.current.interactive &&
          !dynamicRef.current.ballRef.current.moving &&
          distanceFromCurrentBall(point) <= 54;
        renderer.domElement.style.cursor = canAim
          ? "crosshair"
          : "grab";
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (
        gesture?.mode === "aim" &&
        gesture.pointerId === event.pointerId
      ) {
        const point = pointerToCourse(event);
        if (point) dynamicRef.current.onAimEnd(point);
      }
      if (gesture?.pointerId === event.pointerId) {
        gesture = null;
      }
      pointerPositions.delete(event.pointerId);
      pinchDistance =
        pointerPositions.size >= 2
          ? currentPinchDistance()
          : null;
      if (
        renderer.domElement.hasPointerCapture(event.pointerId)
      ) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      renderer.domElement.style.cursor = "grab";
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (
        gesture?.mode === "aim" &&
        gesture.pointerId === event.pointerId
      ) {
        dynamicRef.current.onAimCancel();
      }
      if (gesture?.pointerId === event.pointerId) {
        gesture = null;
      }
      pointerPositions.delete(event.pointerId);
      pinchDistance = null;
      renderer.domElement.style.cursor = "grab";
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraOrbit.distance = clamp(
        cameraOrbit.distance + Math.sign(event.deltaY) * 0.55,
        3.6,
        14.5,
      );
    };
    const handleDoubleClick = (event: MouseEvent) => {
      event.preventDefault();
      resetCameraBehindBall();
    };
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    renderer.domElement.addEventListener(
      "pointerdown",
      handlePointerDown,
    );
    renderer.domElement.addEventListener(
      "pointermove",
      handlePointerMove,
    );
    renderer.domElement.addEventListener(
      "pointerup",
      handlePointerUp,
    );
    renderer.domElement.addEventListener(
      "pointercancel",
      handlePointerCancel,
    );
    renderer.domElement.addEventListener("wheel", handleWheel, {
      passive: false,
    });
    renderer.domElement.addEventListener(
      "dblclick",
      handleDoubleClick,
    );
    renderer.domElement.addEventListener(
      "contextmenu",
      handleContextMenu,
    );

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let frame = 0;
    const startedAt = performance.now();
    let lastFrameAt = startedAt;
    const aimColor = new THREE.Color();
    const desiredCameraTarget = new THREE.Vector3();
    const desiredCameraPosition = new THREE.Vector3();
    const cameraFocus = new THREE.Vector3();
    const cameraLookAhead = new THREE.Vector3();
    const occlusionDirection = new THREE.Vector3();
    const occlusionOffset = new THREE.Vector3();
    const occlusionClosestPoint = new THREE.Vector3();
    const animate = (time: number) => {
      const latest = dynamicRef.current;
      const elapsed = (time - startedAt) / 1000;
      const frameDelta = clamp(
        (time - lastFrameAt) / 1000,
        0.001,
        0.05,
      );
      lastFrameAt = time;

      for (const water of waterMeshes) {
        const positions = water.mesh.geometry.attributes
          .position as THREE.BufferAttribute;
        for (
          let index = 0;
          index < positions.count;
          index += 1
        ) {
          const baseX = water.base[index * 3];
          const baseY = water.base[index * 3 + 1];
          const wave =
            Math.sin(baseX * 2.2 + elapsed * 2.4 + water.phase) *
              0.035 +
            Math.cos(baseY * 3.1 - elapsed * 1.8 + water.phase) *
              0.022;
          positions.setZ(index, wave);
        }
        positions.needsUpdate = true;
        if (frame % 3 === 0) {
          water.mesh.geometry.computeVertexNormals();
        }
        water.mesh.material.color.offsetHSL(
          Math.sin(elapsed * 0.7 + water.phase) * 0.00015,
          0,
          0,
        );
      }

      const synchronizedTime = Date.now();
      for (const movingObject of movingObstacleObjects) {
        const pose = getMiniGolfMovingObstaclePose(
          movingObject.obstacle,
          synchronizedTime,
        );
        const world = courseToWorld(pose, course);
        movingObject.root.position.set(
          world.x,
          world.y,
          world.z,
        );
        if (movingObject.obstacle.shape === "circle") {
          const spinDirection =
            movingObject.obstacle.axis === "x" ? -1 : 1;
          movingObject.movingPart.rotation.z =
            elapsed * 1.8 * spinDirection;
          movingObject.movingPart.rotation.x =
            elapsed * 1.15;
        }
      }

      const visiblePlayers = latest.players.filter(
        (player) =>
          player.player_status === "playing" &&
          player.current_hole === latest.viewedHole &&
          !player.hole_completed,
      );
      const visibleIds = new Set(
        visiblePlayers.map((player) => player.id),
      );
      for (const [playerId, object] of balls) {
        if (!visibleIds.has(playerId)) {
          scene.remove(object.root);
          object.sphere.geometry.dispose();
          object.sphere.material.dispose();
          object.ring.geometry.dispose();
          object.ring.material.dispose();
          const labelMaterial =
            object.label.material as THREE.SpriteMaterial;
          labelMaterial.map?.dispose();
          labelMaterial.dispose();
          balls.delete(playerId);
        }
      }

      for (const player of visiblePlayers) {
        let object = balls.get(player.id);
        if (!object) {
          object = createBallObject(
            scene,
            player,
            bumpTexture,
            latest.currentPlayer?.id ?? null,
          );
          balls.set(player.id, object);
        }
        const isCurrent =
          player.id === latest.currentPlayer?.id;
        const motion = latest.ballRef.current;
        const point = isCurrent
          ? { x: motion.x, y: motion.y }
          : {
              x: player.ball_x ?? course.start.x,
              y: player.ball_y ?? course.start.y,
            };
        const world = courseToWorld(point, course);
        let sinkProgress = 0;
        if (isCurrent && motion.sinking) {
          sinkProgress = clamp(
            (time - motion.sinkStartedAt) / 720,
            0,
            1,
          );
        }
        object.root.position.set(
          world.x,
          world.y + 0.19 - sinkProgress * 0.52,
          world.z,
        );
        object.sphere.scale.setScalar(
          1 - sinkProgress * 0.84,
        );
        object.sphere.rotation.x =
          isCurrent ? motion.rotation * 0.74 : 0;
        object.sphere.rotation.z =
          isCurrent ? motion.rotation * 0.42 : 0;
        object.label.visible = sinkProgress < 0.18;
        object.ring.visible =
          isCurrent && sinkProgress < 0.2;
      }

      const motion = latest.ballRef.current;
      if (
        latest.currentPlayer &&
        motion.moving &&
        !motion.sinking
      ) {
        const speed = Math.hypot(motion.vx, motion.vy);
        const directionX = speed > 0 ? motion.vx / speed : 0;
        const directionY = speed > 0 ? motion.vy / speed : 0;
        for (let index = 0; index < 6; index += 1) {
          const distance = (index + 1) * 0.12;
          const point = courseToWorld({
            x: motion.x - directionX * distance,
            y: motion.y - directionY * distance,
          }, course);
          trailPositions[index * 3] = point.x;
          trailPositions[index * 3 + 1] =
            point.y + 0.2 - index * 0.008;
          trailPositions[index * 3 + 2] = point.z;
        }
        (
          trailGeometry.attributes.position as THREE.BufferAttribute
        ).needsUpdate = true;
        trail.visible = true;
      } else {
        trail.visible = false;
      }

      if (
        latest.isAiming &&
        latest.aimOrigin &&
        latest.aimPoint
      ) {
        const direction = new THREE.Vector3(
          (latest.aimOrigin.x - latest.aimPoint.x) *
            WORLD_WIDTH,
          0,
          (latest.aimOrigin.y - latest.aimPoint.y) *
            WORLD_DEPTH,
        );
        const dragPixels = Math.hypot(
          (latest.aimOrigin.x - latest.aimPoint.x) * 1000,
          (latest.aimOrigin.y - latest.aimPoint.y) * 560,
        );
        const power = clamp(
          dragPixels / latest.maxDragDistance,
          0,
          1,
        );
        if (direction.lengthSq() > 0.0001) {
          direction.normalize();
          const start = courseToWorld(latest.aimOrigin, course);
          start.y += 0.28;
          const guideLength = 1.55 + power * 1.45;
          aimColor.set(
            power > 0.75
              ? "#ef4444"
              : power > 0.4
                ? "#facc15"
                : "#22c55e",
          );
          aimGuide.visible = true;
          aimGuide.position.copy(start);
          aimGuide.rotation.y = Math.atan2(
            direction.x,
            direction.z,
          );
          const arrowWidth = 0.92 + power * 0.12;
          aimArrow2D.scale.set(
            arrowWidth,
            guideLength,
            1,
          );
          aimArrowBackdrop.scale.set(
            arrowWidth * 1.18,
            guideLength * 1.045,
            1,
          );
          aimHalo.scale.setScalar(
            0.86 +
              Math.sin(elapsed * 6) * 0.08 +
              power * 0.14,
          );
          aimHalo.rotation.z = elapsed * 0.7;

          aimArrowMaterial.color.copy(aimColor);
          aimHaloMaterial.color.copy(aimColor);
        } else {
          aimGuide.visible = false;
        }
      } else {
        aimGuide.visible = false;
      }

      const cameraPoint =
        latest.currentPlayer &&
        latest.currentPlayer.current_hole === latest.viewedHole
          ? {
              x: motion.x,
              y: motion.y,
            }
          : visiblePlayers.length > 0
            ? {
                x:
                  visiblePlayers[0].ball_x ??
                  course.start.x,
                y:
                  visiblePlayers[0].ball_y ??
                  course.start.y,
              }
            : course.start;
      desiredCameraTarget.copy(courseToWorld(cameraPoint, course));
      desiredCameraTarget.y += 0.3;
      cameraLookAhead.set(0, 0, 0);
      if (
        latest.currentPlayer &&
        motion.moving &&
        Math.hypot(motion.vx, motion.vy) > 0.003
      ) {
        cameraLookAhead
          .set(
            motion.vx * WORLD_WIDTH,
            0,
            motion.vy * WORLD_DEPTH,
          )
          .normalize()
          .multiplyScalar(1.05);
      }
      cameraOrbit.target.lerp(
        desiredCameraTarget,
        1 - Math.exp(-frameDelta * 8.5),
      );
      cameraFocus
        .copy(cameraOrbit.target)
        .add(cameraLookAhead);
      cameraLookTarget.lerp(
        cameraFocus,
        1 - Math.exp(-frameDelta * 6.5),
      );
      const horizontalDistance =
        Math.cos(cameraOrbit.pitch) * cameraOrbit.distance;
      desiredCameraPosition.set(
        cameraOrbit.target.x +
          Math.sin(cameraOrbit.yaw) * horizontalDistance,
        cameraOrbit.target.y +
          0.72 +
          Math.sin(cameraOrbit.pitch) * cameraOrbit.distance,
        cameraOrbit.target.z +
          Math.cos(cameraOrbit.yaw) * horizontalDistance,
      );
      camera.position.lerp(
        desiredCameraPosition,
        1 - Math.exp(-frameDelta * 7.5),
      );
      camera.lookAt(cameraLookTarget);

      occlusionDirection
        .copy(cameraLookTarget)
        .sub(camera.position);
      const focusDistance = occlusionDirection.length();
      if (focusDistance > 0.001) {
        occlusionDirection.multiplyScalar(1 / focusDistance);
        for (const occluder of scenicOccluders) {
          occlusionOffset
            .copy(occluder.center)
            .sub(camera.position);
          const distanceFromCamera = occlusionOffset.length();
          const projection =
            occlusionOffset.dot(occlusionDirection);
          let blocksView = false;
          if (projection > 0 && projection < focusDistance) {
            occlusionClosestPoint
              .copy(camera.position)
              .addScaledVector(
                occlusionDirection,
                projection,
              );
            blocksView =
              occlusionClosestPoint.distanceToSquared(
                occluder.center,
              ) <
              (occluder.radius + 0.72) *
                (occluder.radius + 0.72);
          }
          const cameraInsideTree =
            distanceFromCamera < occluder.radius + 2.1;
          occluder.root.visible =
            !blocksView && !cameraInsideTree;
        }
      }

      const distanceToHole = Math.hypot(
        motion.x - course.hole.x,
        motion.y - course.hole.y,
      );
      const flagTarget = motion.sinking
        ? 0
        : distanceToHole < 0.22
          ? 1
          : 0.22;
      flagLift +=
        (flagTarget - flagLift) *
        (1 -
          Math.exp(
            -frameDelta * (motion.sinking ? 10.5 : 4.5),
          ));
      pole.position.y = holeGroundY - 0.72 + flagLift * 1.85;
      flag.position.y = holeGroundY + 0.1 + flagLift * 2.1;
      flag.rotation.y = Math.sin(elapsed * 1.4) * 0.08;
      renderer.render(scene, camera);
      frame += 1;
      animationFrame = window.requestAnimationFrame(animate);
    };

    let animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener(
        "pointerdown",
        handlePointerDown,
      );
      renderer.domElement.removeEventListener(
        "pointermove",
        handlePointerMove,
      );
      renderer.domElement.removeEventListener(
        "pointerup",
        handlePointerUp,
      );
      renderer.domElement.removeEventListener(
        "pointercancel",
        handlePointerCancel,
      );
      renderer.domElement.removeEventListener("wheel", handleWheel);
      renderer.domElement.removeEventListener(
        "dblclick",
        handleDoubleClick,
      );
      renderer.domElement.removeEventListener(
        "contextmenu",
        handleContextMenu,
      );
      cameraControllerRef.current = null;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          for (const material of materials) {
            const mappedMaterial = material as THREE.Material & {
              map?: THREE.Texture | null;
              bumpMap?: THREE.Texture | null;
            };
            mappedMaterial.map?.dispose();
            mappedMaterial.bumpMap?.dispose();
            material.dispose();
          }
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      trailGeometry.dispose();
      (
        trail.material as THREE.PointsMaterial
      ).dispose();
      bumpTexture?.dispose();
      turfTexture?.dispose();
      turfBumpTexture?.dispose();
      turfAlphaTexture?.dispose();
      sandTexture?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [course]);

  return (
    <div className="relative aspect-[25/14] w-full overflow-hidden bg-slate-950">
      <div
        ref={mountRef}
        className="absolute inset-0"
        aria-label={`Màn chơi Mini Golf, hố ${viewedHole}/${holeCount}: ${course.name}`}
      />

      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full border border-cyan-200/20 bg-slate-950/72 px-3 py-1.5 text-[11px] font-black text-cyan-100 shadow-lg backdrop-blur-md">
        🎮 MÀN CHƠI · HỐ {viewedHole}/{holeCount} ·{" "}
        {holeStrokes === null
          ? `—/${maxHoleStrokes}`
          : `${holeStrokes}/${maxHoleStrokes}`}{" "}
        GẬY
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-end gap-2">
        <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/15 bg-slate-950/78 p-1.5 shadow-2xl backdrop-blur-md">
          <button
            type="button"
            onClick={() =>
              cameraControllerRef.current?.rotate(-1)
            }
            title="Xoay camera sang trái"
            aria-label="Xoay camera sang trái"
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-base text-white transition hover:bg-cyan-400/25"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={() =>
              cameraControllerRef.current?.resetBehindBall()
            }
            title="Đặt camera lại phía sau bóng"
            aria-label="Đặt camera lại phía sau bóng"
            className="flex h-8 items-center justify-center gap-1 rounded-xl bg-cyan-400/20 px-2.5 text-[11px] font-black text-cyan-100 transition hover:bg-cyan-400/35"
          >
            🎥 SAU BÓNG
          </button>
          <button
            type="button"
            onClick={() =>
              cameraControllerRef.current?.rotate(1)
            }
            title="Xoay camera sang phải"
            aria-label="Xoay camera sang phải"
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-base text-white transition hover:bg-cyan-400/25"
          >
            ↷
          </button>
          <span className="mx-0.5 h-5 w-px bg-white/10" />
          <button
            type="button"
            onClick={() =>
              cameraControllerRef.current?.zoom(-1)
            }
            title="Phóng gần camera"
            aria-label="Phóng gần camera"
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-sm font-black text-white transition hover:bg-cyan-400/25"
          >
            +
          </button>
          <button
            type="button"
            onClick={() =>
              cameraControllerRef.current?.zoom(1)
            }
            title="Thu xa camera"
            aria-label="Thu xa camera"
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-sm font-black text-white transition hover:bg-cyan-400/25"
          >
            −
          </button>
        </div>
        <div className="hidden rounded-xl border border-white/10 bg-slate-950/68 px-3 py-2 text-[10px] font-bold text-slate-200 backdrop-blur-md lg:block">
          Kéo vùng trống để xoay · Cuộn/chụm để zoom
        </div>
      </div>
    </div>
  );
}
