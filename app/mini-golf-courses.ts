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
  { slopeX: 0.08, slopeY: -0.18, waveX: 0.2, waveY: 0.1 },
  { slopeX: -0.12, slopeY: 0.08, waveX: 0.08, waveY: 0.18 },
  { slopeX: 0.18, slopeY: -0.26, waveX: 0.13, waveY: 0.08 },
  { slopeX: -0.22, slopeY: 0.18, waveX: 0.17, waveY: 0.13 },
  { slopeX: 0.1, slopeY: -0.14, waveX: 0.12, waveY: 0.18 },
  { slopeX: -0.08, slopeY: 0.12, waveX: 0.2, waveY: 0.16 },
  { slopeX: 0.24, slopeY: 0.08, waveX: 0.22, waveY: 0.11 },
  { slopeX: -0.18, slopeY: -0.22, waveX: 0.14, waveY: 0.22 },
  { slopeX: 0.16, slopeY: 0.2, waveX: 0.2, waveY: 0.18 },
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
    name: "Đồi cỏ ban mai",
    par: 3,
    theme: "forest",
    start: { x: 0.1, y: 0.72 },
    hole: { x: 0.88, y: 0.27 },
    obstacles: [
      { x: 0.38, y: 0.18, width: 0.035, height: 0.27 },
      { x: 0.61, y: 0.55, width: 0.035, height: 0.27 },
    ],
    roundObstacles: [
      { x: 0.47, y: 0.5, radius: 0.06 },
      { x: 0.57, y: 0.35, radius: 0.04 },
    ],
    water: [],
    sand: [
      { x: 0.24, y: 0.65, width: 0.17, height: 0.13 },
      { x: 0.69, y: 0.16, width: 0.13, height: 0.12 },
    ],
  },
  {
    id: 2,
    name: "Vịnh trăng lưỡi liềm",
    par: 3,
    theme: "coast",
    start: { x: 0.12, y: 0.18 },
    hole: { x: 0.88, y: 0.79 },
    obstacles: [
      { x: 0.31, y: 0.14, width: 0.05, height: 0.3 },
      { x: 0.64, y: 0.56, width: 0.05, height: 0.3 },
    ],
    roundObstacles: [
      { x: 0.24, y: 0.67, radius: 0.055 },
    ],
    water: [
      { x: 0.4, y: 0.34, width: 0.21, height: 0.32 },
    ],
    sand: [
      { x: 0.72, y: 0.33, width: 0.13, height: 0.16 },
    ],
  },
  {
    id: 3,
    name: "Bậc thang trên mây",
    par: 4,
    theme: "forest",
    start: { x: 0.1, y: 0.84 },
    hole: { x: 0.9, y: 0.15 },
    obstacles: [
      { x: 0.22, y: 0.65, width: 0.23, height: 0.045 },
      { x: 0.4, y: 0.46, width: 0.23, height: 0.045 },
      { x: 0.6, y: 0.27, width: 0.22, height: 0.045 },
    ],
    roundObstacles: [
      { x: 0.3, y: 0.34, radius: 0.045 },
      { x: 0.7, y: 0.69, radius: 0.045 },
    ],
    water: [],
    sand: [
      { x: 0.44, y: 0.75, width: 0.16, height: 0.1 },
    ],
  },
  {
    id: 4,
    name: "Hẻm núi đỏ",
    par: 4,
    theme: "desert",
    start: { x: 0.1, y: 0.16 },
    hole: { x: 0.9, y: 0.84 },
    obstacles: [
      { x: 0.34, y: 0.29, width: 0.05, height: 0.24 },
      { x: 0.61, y: 0.48, width: 0.05, height: 0.24 },
    ],
    roundObstacles: [
      { x: 0.34, y: 0.72, radius: 0.08 },
      { x: 0.67, y: 0.28, radius: 0.08 },
    ],
    water: [],
    sand: [
      { x: 0.18, y: 0.46, width: 0.22, height: 0.15 },
      { x: 0.56, y: 0.68, width: 0.24, height: 0.14 },
    ],
  },
  {
    id: 5,
    name: "Quần đảo ngọc",
    par: 4,
    theme: "coast",
    start: { x: 0.1, y: 0.5 },
    hole: { x: 0.9, y: 0.18 },
    obstacles: [],
    roundObstacles: [
      { x: 0.5, y: 0.48, radius: 0.055 },
      { x: 0.81, y: 0.55, radius: 0.045 },
    ],
    water: [
      { x: 0.27, y: 0.04, width: 0.17, height: 0.29 },
      { x: 0.27, y: 0.67, width: 0.17, height: 0.29 },
      { x: 0.58, y: 0.34, width: 0.17, height: 0.32 },
    ],
    sand: [
      { x: 0.76, y: 0.34, width: 0.12, height: 0.13 },
    ],
  },
  {
    id: 6,
    name: "Vườn sao đêm",
    par: 4,
    theme: "night",
    start: { x: 0.12, y: 0.78 },
    hole: { x: 0.88, y: 0.22 },
    obstacles: [
      { x: 0.27, y: 0.5, width: 0.16, height: 0.04 },
      { x: 0.58, y: 0.46, width: 0.16, height: 0.04 },
    ],
    roundObstacles: [
      { x: 0.28, y: 0.27, radius: 0.05 },
      { x: 0.48, y: 0.69, radius: 0.06 },
      { x: 0.72, y: 0.3, radius: 0.05 },
    ],
    water: [
      { x: 0.43, y: 0.38, width: 0.14, height: 0.2 },
    ],
    sand: [
      { x: 0.2, y: 0.2, width: 0.12, height: 0.11 },
      { x: 0.68, y: 0.68, width: 0.13, height: 0.11 },
    ],
  },
  {
    id: 7,
    name: "Cồn cát gió",
    par: 4,
    theme: "desert",
    start: { x: 0.12, y: 0.82 },
    hole: { x: 0.88, y: 0.18 },
    obstacles: [
      { x: 0.45, y: 0.72, width: 0.18, height: 0.04 },
    ],
    roundObstacles: [
      { x: 0.32, y: 0.26, radius: 0.06 },
      { x: 0.69, y: 0.76, radius: 0.06 },
    ],
    water: [],
    sand: [
      { x: 0.22, y: 0.58, width: 0.2, height: 0.18 },
      { x: 0.42, y: 0.36, width: 0.18, height: 0.16 },
      { x: 0.64, y: 0.14, width: 0.17, height: 0.17 },
    ],
  },
  {
    id: 8,
    name: "Thác rừng sâu",
    par: 5,
    theme: "forest",
    start: { x: 0.12, y: 0.2 },
    hole: { x: 0.88, y: 0.8 },
    obstacles: [
      { x: 0.39, y: 0.47, width: 0.17, height: 0.04 },
    ],
    roundObstacles: [
      { x: 0.49, y: 0.22, radius: 0.05 },
      { x: 0.52, y: 0.8, radius: 0.05 },
    ],
    water: [
      { x: 0.27, y: 0.04, width: 0.12, height: 0.36 },
      { x: 0.27, y: 0.58, width: 0.12, height: 0.38 },
      { x: 0.59, y: 0.28, width: 0.14, height: 0.44 },
    ],
    sand: [
      { x: 0.75, y: 0.13, width: 0.13, height: 0.13 },
    ],
  },
  {
    id: 9,
    name: "Cực quang chung kết",
    par: 5,
    theme: "night",
    start: { x: 0.08, y: 0.86 },
    hole: { x: 0.92, y: 0.14 },
    obstacles: [
      { x: 0.22, y: 0.65, width: 0.18, height: 0.04 },
      { x: 0.6, y: 0.3, width: 0.18, height: 0.04 },
      { x: 0.34, y: 0.24, width: 0.04, height: 0.24 },
      { x: 0.66, y: 0.53, width: 0.04, height: 0.23 },
    ],
    roundObstacles: [
      { x: 0.25, y: 0.25, radius: 0.055 },
      { x: 0.76, y: 0.74, radius: 0.055 },
    ],
    water: [
      { x: 0.04, y: 0.04, width: 0.19, height: 0.23 },
      { x: 0.77, y: 0.73, width: 0.19, height: 0.23 },
      { x: 0.43, y: 0.38, width: 0.14, height: 0.24 },
    ],
    sand: [
      { x: 0.12, y: 0.54, width: 0.12, height: 0.11 },
      { x: 0.75, y: 0.12, width: 0.12, height: 0.1 },
    ],
  },
];
