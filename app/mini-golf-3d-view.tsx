"use client";

import {
  MutableRefObject,
  useEffect,
  useRef,
} from "react";
import * as THREE from "three";
import {
  type MiniGolfCourse,
  type MiniGolfPoint,
  type MiniGolfRect,
} from "./mini-golf-courses";

const WORLD_WIDTH = 18;
const WORLD_DEPTH = 10;
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function seededNoise(index: number, seed: number) {
  const value =
    Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function courseToWorld(point: MiniGolfPoint) {
  return new THREE.Vector3(
    (point.x - 0.5) * WORLD_WIDTH,
    GROUND_HEIGHT,
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
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#c8c8c8";
  context.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 12; row += 1) {
    for (let column = 0; column < 24; column += 1) {
      const x = column * 11 + (row % 2) * 5.5;
      const y = row * 11;
      const dimple = context.createRadialGradient(
        x - 1,
        y - 1,
        0,
        x,
        y,
        4,
      );
      dimple.addColorStop(0, "#f5f5f5");
      dimple.addColorStop(0.5, "#969696");
      dimple.addColorStop(1, "#d8d8d8");
      context.fillStyle = dimple;
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.5, 1);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
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
    roughness: 0.28,
    metalness: 0.03,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    bumpMap: bumpTexture,
    bumpScale: 0.025,
  });
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 36, 24),
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
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
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
    scene.fog = new THREE.Fog(palette.fog, 17, 38);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setSize(
      Math.max(1, mount.clientWidth),
      Math.max(1, mount.clientHeight),
      false,
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure =
      course.theme === "night" ? 1.18 : 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(41, 1, 0.1, 80);
    camera.position.set(0, 11.5, 13.2);
    camera.lookAt(0, 0.3, 0);

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
    sunlight.shadow.camera.left = -14;
    sunlight.shadow.camera.right = 14;
    sunlight.shadow.camera.top = 12;
    sunlight.shadow.camera.bottom = -12;
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

    const landscapeMaterial = new THREE.MeshStandardMaterial({
      color: palette.ground,
      roughness: 1,
    });
    const landscape = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 36),
      landscapeMaterial,
    );
    landscape.rotation.x = -Math.PI / 2;
    landscape.position.y = -0.34;
    landscape.receiveShadow = true;
    scene.add(landscape);

    const borderMaterial = new THREE.MeshStandardMaterial({
      color: palette.border,
      roughness: 0.48,
      metalness: course.theme === "night" ? 0.42 : 0.04,
    });
    const borderDarkMaterial = new THREE.MeshStandardMaterial({
      color: palette.borderDark,
      roughness: 0.72,
      metalness: course.theme === "night" ? 0.35 : 0.02,
    });
    addBox(
      scene,
      WORLD_WIDTH + 0.9,
      0.46,
      WORLD_DEPTH + 0.9,
      0,
      -0.02,
      0,
      borderDarkMaterial,
    );

    const turfTexture = makeTurfTexture(renderer, course);
    const turfGeometry = new THREE.PlaneGeometry(
      WORLD_WIDTH,
      WORLD_DEPTH,
      64,
      36,
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
      const edge =
        Math.min(
          WORLD_WIDTH / 2 - Math.abs(x),
          WORLD_DEPTH / 2 - Math.abs(z),
        ) / 2;
      const bump =
        (seededNoise(index, course.id * 61.7) - 0.5) *
        0.045 *
        clamp(edge, 0, 1);
      turfPositions.setY(index, GROUND_HEIGHT + bump);
    }
    turfGeometry.computeVertexNormals();
    const turfMaterial = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: turfTexture,
      roughness: 0.93,
      metalness: 0,
    });
    const turf = new THREE.Mesh(turfGeometry, turfMaterial);
    turf.receiveShadow = true;
    scene.add(turf);

    const railHeight = 0.62;
    addBox(
      scene,
      WORLD_WIDTH + 0.7,
      railHeight,
      0.34,
      0,
      GROUND_HEIGHT + railHeight / 2,
      -WORLD_DEPTH / 2 - 0.18,
      borderMaterial,
    );
    addBox(
      scene,
      WORLD_WIDTH + 0.7,
      railHeight,
      0.34,
      0,
      GROUND_HEIGHT + railHeight / 2,
      WORLD_DEPTH / 2 + 0.18,
      borderMaterial,
    );
    addBox(
      scene,
      0.34,
      railHeight,
      WORLD_DEPTH,
      -WORLD_WIDTH / 2 - 0.18,
      GROUND_HEIGHT + railHeight / 2,
      0,
      borderMaterial,
    );
    addBox(
      scene,
      0.34,
      railHeight,
      WORLD_DEPTH,
      WORLD_WIDTH / 2 + 0.18,
      GROUND_HEIGHT + railHeight / 2,
      0,
      borderMaterial,
    );

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
      });
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
      mesh.position.set(center.x, GROUND_HEIGHT + 0.025, center.z);
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
    for (let waterIndex = 0; waterIndex < course.water.length; waterIndex += 1) {
      const water = course.water[waterIndex];
      const width = water.width * WORLD_WIDTH;
      const depth = water.height * WORLD_DEPTH;
      const center = courseToWorld({
        x: water.x + water.width / 2,
        y: water.y + water.height / 2,
      });

      addBox(
        scene,
        width + 0.14,
        0.07,
        depth + 0.14,
        center.x,
        GROUND_HEIGHT - 0.005,
        center.z,
        new THREE.MeshStandardMaterial({
          color: "#064f75",
          roughness: 0.38,
        }),
      );

      const geometry = new THREE.PlaneGeometry(
        width,
        depth,
        22,
        14,
      );
      const material = new THREE.MeshPhysicalMaterial({
        color: course.theme === "night" ? "#0ea5e9" : "#38bdf8",
        roughness: 0.12,
        metalness: 0.18,
        transparent: true,
        opacity: 0.86,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(center.x, GROUND_HEIGHT + 0.055, center.z);
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

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: course.theme === "night" ? "#3d5b89" : "#65758b",
      roughness: 0.3,
      metalness: 0.7,
    });
    for (const obstacle of course.obstacles) {
      const width = obstacle.width * WORLD_WIDTH;
      const depth = obstacle.height * WORLD_DEPTH;
      const center = courseToWorld({
        x: obstacle.x + obstacle.width / 2,
        y: obstacle.y + obstacle.height / 2,
      });
      const height = 0.76;
      const mesh = addBox(
        scene,
        width,
        height,
        depth,
        center.x,
        GROUND_HEIGHT + height / 2,
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
    }

    const rockMaterial = new THREE.MeshStandardMaterial({
      color: course.theme === "desert" ? "#8f6a45" : "#526171",
      roughness: 0.84,
      metalness: 0.04,
      flatShading: true,
    });
    for (const obstacle of course.roundObstacles) {
      const center = courseToWorld(obstacle);
      const radius = obstacle.radius * WORLD_WIDTH;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(radius, 2),
        rockMaterial,
      );
      rock.scale.y = 0.72;
      rock.position.set(
        center.x,
        GROUND_HEIGHT + radius * 0.63,
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
      const world = courseToWorld({ x, y });
      dummy.position.set(
        world.x,
        GROUND_HEIGHT + 0.015,
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

    const hole = courseToWorld(course.hole);
    const cupMaterial = new THREE.MeshStandardMaterial({
      color: "#020617",
      roughness: 0.66,
      metalness: 0.1,
    });
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.16, 0.11, 40),
      cupMaterial,
    );
    cup.position.set(hole.x, GROUND_HEIGHT + 0.005, hole.z);
    cup.receiveShadow = true;
    scene.add(cup);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.205, 0.026, 12, 48),
      new THREE.MeshStandardMaterial({
        color: course.theme === "night" ? "#67e8f9" : "#f7df83",
        roughness: 0.32,
        metalness: 0.58,
      }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(hole.x, GROUND_HEIGHT + 0.045, hole.z);
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
    pole.position.set(hole.x, GROUND_HEIGHT + 1.13, hole.z);
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
      GROUND_HEIGHT + 2.2,
      hole.z,
    );
    flag.castShadow = true;
    scene.add(flag);

    const treeTrunkMaterial = new THREE.MeshStandardMaterial({
      color: "#754416",
      roughness: 1,
    });
    const leafMaterial = new THREE.MeshStandardMaterial({
      color:
        course.theme === "desert"
          ? "#7a9b32"
          : course.theme === "night"
            ? "#0b7d68"
            : "#16874b",
      roughness: 0.92,
    });
    for (let index = 0; index < 22; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const x =
        side *
        (10.2 + seededNoise(index, course.id * 113.7) * 3.4);
      const z =
        -7.5 +
        seededNoise(index, course.id * 127.3) * 15;
      const height =
        0.7 + seededNoise(index, course.id * 131.9) * 1.1;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, height, 8),
        treeTrunkMaterial,
      );
      trunk.position.set(x, -0.25 + height / 2, z);
      trunk.castShadow = true;
      scene.add(trunk);
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(0.5 + height * 0.16, 1.35, 10),
        leafMaterial,
      );
      crown.position.set(x, -0.1 + height + 0.48, z);
      crown.rotation.y =
        seededNoise(index, course.id * 139.1) * Math.PI;
      crown.castShadow = true;
      scene.add(crown);
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

    const aimMaterial = new THREE.LineDashedMaterial({
      color: "#ffffff",
      dashSize: 0.32,
      gapSize: 0.18,
      transparent: true,
      opacity: 0.95,
    });
    const aimGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const aimLine = new THREE.Line(aimGeometry, aimMaterial);
    aimLine.computeLineDistances();
    aimLine.visible = false;
    scene.add(aimLine);

    const arrowMaterial = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      emissive: "#ffffff",
      emissiveIntensity: 0.35,
      roughness: 0.4,
    });
    const aimArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.56, 18),
      arrowMaterial,
    );
    aimArrow.visible = false;
    aimArrow.castShadow = true;
    scene.add(aimArrow);

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -GROUND_HEIGHT,
    );
    const intersection = new THREE.Vector3();
    let dragPointerId: number | null = null;

    const pointerToCourse = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(
        groundPlane,
        intersection,
      );
      return hit ? worldToCourse(intersection) : null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      const latest = dynamicRef.current;
      if (!latest.interactive) return;
      const point = pointerToCourse(event);
      if (!point) return;
      dragPointerId = event.pointerId;
      renderer.domElement.setPointerCapture(event.pointerId);
      latest.onAimStart(point);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (dragPointerId !== event.pointerId) return;
      const point = pointerToCourse(event);
      if (point) dynamicRef.current.onAimMove(point);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (dragPointerId !== event.pointerId) return;
      const point = pointerToCourse(event);
      if (point) dynamicRef.current.onAimEnd(point);
      dragPointerId = null;
      if (
        renderer.domElement.hasPointerCapture(event.pointerId)
      ) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (dragPointerId !== event.pointerId) return;
      dragPointerId = null;
      dynamicRef.current.onAimCancel();
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
    const animate = (time: number) => {
      const latest = dynamicRef.current;
      const elapsed = (time - startedAt) / 1000;

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
        const world = courseToWorld(point);
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
          GROUND_HEIGHT + 0.19 - sinkProgress * 0.22,
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
          });
          trailPositions[index * 3] = point.x;
          trailPositions[index * 3 + 1] =
            GROUND_HEIGHT + 0.2 - index * 0.008;
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
          const start = courseToWorld(latest.aimOrigin);
          start.y = GROUND_HEIGHT + 0.25;
          const end = start
            .clone()
            .add(direction.clone().multiplyScalar(2.2 + power * 4.6));
          aimGeometry.setFromPoints([start, end]);
          aimLine.computeLineDistances();
          const color =
            power > 0.75
              ? new THREE.Color("#ff3b30")
              : power > 0.4
                ? new THREE.Color("#ffd43b")
                : new THREE.Color("#ffffff");
          aimMaterial.color.copy(color);
          arrowMaterial.color.copy(color);
          arrowMaterial.emissive.copy(color);
          aimLine.visible = true;
          aimArrow.visible = true;
          aimArrow.position.copy(end);
          aimArrow.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction,
          );
        }
      } else {
        aimLine.visible = false;
        aimArrow.visible = false;
      }

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
      aimGeometry.dispose();
      aimMaterial.dispose();
      trailGeometry.dispose();
      (
        trail.material as THREE.PointsMaterial
      ).dispose();
      bumpTexture?.dispose();
      turfTexture?.dispose();
      sandTexture?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [course]);

  return (
    <div
      ref={mountRef}
      className={`aspect-[25/14] w-full overflow-hidden bg-slate-950 ${
        interactive ? "cursor-crosshair" : "cursor-default"
      }`}
      aria-label={`Sân Mini Golf 3D hố ${viewedHole}: ${course.name}`}
    />
  );
}
