export type MiniGolfPoint = {
  x: number;
  y: number;
};

export type MiniGolfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MiniGolfCircle = MiniGolfPoint & {
  radius: number;
};

export type MiniGolfCourse = {
  id: number;
  name: string;
  par: number;
  theme: "coast" | "forest" | "desert" | "night";
  start: MiniGolfPoint;
  hole: MiniGolfPoint;
  obstacles: MiniGolfRect[];
  roundObstacles: MiniGolfCircle[];
  water: MiniGolfRect[];
  sand: MiniGolfRect[];
};

const TERRAIN_PROFILES = [
  { slopeX: 0.24, slopeY: -0.06, waveX: 0.11, waveY: 0.08 },
  { slopeX: -0.17, slopeY: 0.22, waveX: 0.13, waveY: 0.11 },
  { slopeX: 0.12, slopeY: 0.18, waveX: 0.09, waveY: 0.14 },
  { slopeX: -0.2, slopeY: -0.12, waveX: 0.15, waveY: 0.1 },
  { slopeX: 0.18, slopeY: -0.2, waveX: 0.12, waveY: 0.13 },
  { slopeX: -0.16, slopeY: 0.17, waveX: 0.14, waveY: 0.12 },
  { slopeX: 0.27, slopeY: 0.04, waveX: 0.16, waveY: 0.09 },
  { slopeX: -0.14, slopeY: -0.23, waveX: 0.11, waveY: 0.15 },
  { slopeX: 0.21, slopeY: 0.19, waveX: 0.16, waveY: 0.14 },
] as const;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = clamp01((value - edge0) / (edge1 - edge0));
  return normalized * normalized * (3 - 2 * normalized);
}

function pointDistance(first: MiniGolfPoint, second: MiniGolfPoint) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function getMiniGolfTerrainElevation(
  point: MiniGolfPoint,
  course: MiniGolfCourse,
) {
  const profile =
    TERRAIN_PROFILES[(course.id - 1) % TERRAIN_PROFILES.length];
  const x = clamp01(point.x);
  const y = clamp01(point.y);
  const phase = course.id * 0.37;
  const directionalSlope =
    profile.slopeX * (x - 0.5) +
    profile.slopeY * (y - 0.5);
  const broadHills =
    Math.sin((x * 1.45 + phase) * Math.PI) * profile.waveX +
    Math.cos((y * 1.35 - phase * 0.55) * Math.PI) *
      profile.waveY +
    Math.sin((x + y + phase * 0.3) * Math.PI * 1.2) * 0.045;

  const startBlend =
    1 - smoothstep(0.055, 0.16, pointDistance(point, course.start));
  const holeBlend =
    1 - smoothstep(0.045, 0.14, pointDistance(point, course.hole));
  const flattenAmount = Math.max(startBlend * 0.72, holeBlend * 0.82);

  return (directionalSlope + broadHills) * (1 - flattenAmount);
}

export function getMiniGolfTerrainGradient(
  point: MiniGolfPoint,
  course: MiniGolfCourse,
) {
  const sampleDistance = 0.004;
  const left = getMiniGolfTerrainElevation(
    { x: point.x - sampleDistance, y: point.y },
    course,
  );
  const right = getMiniGolfTerrainElevation(
    { x: point.x + sampleDistance, y: point.y },
    course,
  );
  const top = getMiniGolfTerrainElevation(
    { x: point.x, y: point.y - sampleDistance },
    course,
  );
  const bottom = getMiniGolfTerrainElevation(
    { x: point.x, y: point.y + sampleDistance },
    course,
  );
  return {
    x: (right - left) / (sampleDistance * 2),
    y: (bottom - top) / (sampleDistance * 2),
  };
}

export const MINI_GOLF_COURSES: MiniGolfCourse[] = [
  {
    id: 1,
    name: "Bờ biển khởi động",
    par: 2,
    theme: "coast",
    start: { x: 0.16, y: 0.5 },
    hole: { x: 0.82, y: 0.5 },
    obstacles: [],
    roundObstacles: [
      { x: 0.49, y: 0.38, radius: 0.055 },
      { x: 0.49, y: 0.62, radius: 0.055 },
    ],
    water: [
      { x: 0.36, y: 0.04, width: 0.26, height: 0.18 },
      { x: 0.36, y: 0.78, width: 0.26, height: 0.18 },
    ],
    sand: [],
  },
  {
    id: 2,
    name: "Khúc cua chữ L",
    par: 3,
    theme: "forest",
    start: { x: 0.16, y: 0.76 },
    hole: { x: 0.8, y: 0.22 },
    obstacles: [
      { x: 0.33, y: 0.2, width: 0.06, height: 0.5 },
      { x: 0.33, y: 0.2, width: 0.32, height: 0.06 },
    ],
    roundObstacles: [],
    water: [
      { x: 0.45, y: 0.5, width: 0.23, height: 0.22 },
    ],
    sand: [
      { x: 0.68, y: 0.32, width: 0.17, height: 0.14 },
    ],
  },
  {
    id: 3,
    name: "Cây cầu hẹp",
    par: 3,
    theme: "coast",
    start: { x: 0.12, y: 0.5 },
    hole: { x: 0.88, y: 0.5 },
    obstacles: [
      { x: 0.34, y: 0.26, width: 0.03, height: 0.18 },
      { x: 0.34, y: 0.56, width: 0.03, height: 0.18 },
      { x: 0.63, y: 0.26, width: 0.03, height: 0.18 },
      { x: 0.63, y: 0.56, width: 0.03, height: 0.18 },
    ],
    roundObstacles: [],
    water: [
      { x: 0.3, y: 0.04, width: 0.4, height: 0.34 },
      { x: 0.3, y: 0.62, width: 0.4, height: 0.34 },
    ],
    sand: [],
  },
  {
    id: 4,
    name: "Vòng xoay đá",
    par: 3,
    theme: "desert",
    start: { x: 0.16, y: 0.76 },
    hole: { x: 0.84, y: 0.22 },
    obstacles: [
      { x: 0.46, y: 0.11, width: 0.07, height: 0.27 },
      { x: 0.46, y: 0.62, width: 0.07, height: 0.27 },
    ],
    roundObstacles: [
      { x: 0.495, y: 0.5, radius: 0.105 },
    ],
    water: [],
    sand: [
      { x: 0.17, y: 0.24, width: 0.23, height: 0.16 },
      { x: 0.61, y: 0.6, width: 0.23, height: 0.16 },
    ],
  },
  {
    id: 5,
    name: "Đảo đôi",
    par: 4,
    theme: "coast",
    start: { x: 0.12, y: 0.72 },
    hole: { x: 0.88, y: 0.28 },
    obstacles: [
      { x: 0.39, y: 0.43, width: 0.22, height: 0.05 },
      { x: 0.39, y: 0.52, width: 0.22, height: 0.05 },
    ],
    roundObstacles: [],
    water: [
      { x: 0.26, y: 0.04, width: 0.2, height: 0.32 },
      { x: 0.54, y: 0.64, width: 0.2, height: 0.32 },
    ],
    sand: [
      { x: 0.73, y: 0.48, width: 0.13, height: 0.13 },
    ],
  },
  {
    id: 6,
    name: "Đường zíc zắc",
    par: 4,
    theme: "night",
    start: { x: 0.1, y: 0.78 },
    hole: { x: 0.89, y: 0.2 },
    obstacles: [
      { x: 0.25, y: 0.28, width: 0.05, height: 0.54 },
      { x: 0.46, y: 0.18, width: 0.05, height: 0.54 },
      { x: 0.67, y: 0.28, width: 0.05, height: 0.54 },
    ],
    roundObstacles: [],
    water: [],
    sand: [
      { x: 0.31, y: 0.66, width: 0.13, height: 0.12 },
      { x: 0.52, y: 0.22, width: 0.13, height: 0.12 },
    ],
  },
  {
    id: 7,
    name: "Thung lũng cát",
    par: 4,
    theme: "desert",
    start: { x: 0.12, y: 0.5 },
    hole: { x: 0.88, y: 0.5 },
    obstacles: [
      { x: 0.35, y: 0.22, width: 0.04, height: 0.2 },
      { x: 0.35, y: 0.58, width: 0.04, height: 0.2 },
      { x: 0.61, y: 0.22, width: 0.04, height: 0.2 },
      { x: 0.61, y: 0.58, width: 0.04, height: 0.2 },
    ],
    roundObstacles: [],
    water: [],
    sand: [
      { x: 0.39, y: 0.3, width: 0.22, height: 0.4 },
    ],
  },
  {
    id: 8,
    name: "Ba cổng thành",
    par: 4,
    theme: "forest",
    start: { x: 0.12, y: 0.78 },
    hole: { x: 0.87, y: 0.2 },
    obstacles: [
      { x: 0.27, y: 0.04, width: 0.04, height: 0.56 },
      { x: 0.48, y: 0.4, width: 0.04, height: 0.56 },
      { x: 0.69, y: 0.04, width: 0.04, height: 0.56 },
    ],
    roundObstacles: [
      { x: 0.39, y: 0.25, radius: 0.05 },
      { x: 0.61, y: 0.75, radius: 0.05 },
    ],
    water: [],
    sand: [
      { x: 0.76, y: 0.38, width: 0.13, height: 0.13 },
    ],
  },
  {
    id: 9,
    name: "Chung kết Cyber Green",
    par: 5,
    theme: "night",
    start: { x: 0.1, y: 0.82 },
    hole: { x: 0.89, y: 0.18 },
    obstacles: [
      { x: 0.23, y: 0.32, width: 0.22, height: 0.045 },
      { x: 0.55, y: 0.63, width: 0.22, height: 0.045 },
      { x: 0.47, y: 0.18, width: 0.045, height: 0.26 },
      { x: 0.47, y: 0.56, width: 0.045, height: 0.26 },
    ],
    roundObstacles: [
      { x: 0.32, y: 0.62, radius: 0.06 },
      { x: 0.68, y: 0.37, radius: 0.06 },
    ],
    water: [
      { x: 0.04, y: 0.04, width: 0.22, height: 0.2 },
      { x: 0.74, y: 0.76, width: 0.22, height: 0.2 },
    ],
    sand: [
      { x: 0.74, y: 0.23, width: 0.13, height: 0.13 },
    ],
  },
];
