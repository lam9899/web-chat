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

export type MiniGolfBoundarySide =
  | "top"
  | "right"
  | "bottom"
  | "left";

export type MiniGolfBoundaryRail = {
  side: MiniGolfBoundarySide;
  from: number;
  to: number;
};

export type MiniGolfMovingObstacle = {
  id: string;
  shape: "rect" | "circle";
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  axis: "x" | "y";
  travel: number;
  cycleSeconds: number;
  phase: number;
};

type MiniGolfTerrainProfile = {
  slopeX: number;
  slopeY: number;
  waveX: number;
  waveY: number;
  ridge: number;
  frequencyX: number;
  frequencyY: number;
};

export type MiniGolfCourse = {
  id: number;
  name: string;
  par: number;
  theme: "coast" | "forest" | "desert" | "night";
  start: MiniGolfPoint;
  hole: MiniGolfPoint;
  terrain: MiniGolfTerrainProfile;
  obstacles: MiniGolfRect[];
  roundObstacles: MiniGolfCircle[];
  movingObstacles: MiniGolfMovingObstacle[];
  boundaryRails: MiniGolfBoundaryRail[];
  water: MiniGolfRect[];
  sand: MiniGolfRect[];
};

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

export function getMiniGolfMovingObstaclePose(
  obstacle: MiniGolfMovingObstacle,
  timeMs: number,
): MiniGolfPoint {
  const cycleSeconds = Math.max(1.5, obstacle.cycleSeconds);
  const phase =
    (timeMs / 1000 / cycleSeconds + obstacle.phase) *
    Math.PI *
    2;
  const offset = Math.sin(phase) * obstacle.travel;
  return {
    x: obstacle.x + (obstacle.axis === "x" ? offset : 0),
    y: obstacle.y + (obstacle.axis === "y" ? offset : 0),
  };
}

export function isMiniGolfBoundaryProtected(
  course: MiniGolfCourse,
  side: MiniGolfBoundarySide,
  positionAlongEdge: number,
) {
  const position = clamp01(positionAlongEdge);
  return course.boundaryRails.some(
    (rail) =>
      rail.side === side &&
      position >= Math.min(rail.from, rail.to) &&
      position <= Math.max(rail.from, rail.to),
  );
}

export function getMiniGolfTerrainElevation(
  point: MiniGolfPoint,
  course: MiniGolfCourse,
) {
  const profile = course.terrain;
  const x = clamp01(point.x);
  const y = clamp01(point.y);
  const phase = course.id * 0.41;
  const directionalSlope =
    profile.slopeX * (x - 0.5) +
    profile.slopeY * (y - 0.5);
  const broadHills =
    Math.sin((x * profile.frequencyX + phase) * Math.PI) *
      profile.waveX +
    Math.cos((y * profile.frequencyY - phase * 0.57) * Math.PI) *
      profile.waveY;
  const ridge =
    Math.sin(
      (x * profile.frequencyX +
        y * profile.frequencyY +
        phase * 0.38) *
        Math.PI *
        1.35,
    ) * profile.ridge;

  const startBlend =
    1 - smoothstep(0.06, 0.17, pointDistance(point, course.start));
  const holeBlend =
    1 - smoothstep(0.05, 0.15, pointDistance(point, course.hole));
  const flattenAmount = Math.max(startBlend * 0.78, holeBlend * 0.86);

  return (directionalSlope + broadHills + ridge) *
    (1 - flattenAmount);
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
    name: "Thung lũng thông reo",
    par: 3,
    theme: "forest",
    start: { x: 0.09, y: 0.78 },
    hole: { x: 0.89, y: 0.22 },
    terrain: {
      slopeX: 0.13,
      slopeY: -0.19,
      waveX: 0.12,
      waveY: 0.08,
      ridge: 0.045,
      frequencyX: 1.35,
      frequencyY: 1.15,
    },
    obstacles: [
      { x: 0.3, y: 0.57, width: 0.035, height: 0.2 },
      { x: 0.68, y: 0.22, width: 0.035, height: 0.2 },
    ],
    roundObstacles: [
      { x: 0.47, y: 0.5, radius: 0.047 },
    ],
    movingObstacles: [
      {
        id: "valley-gate",
        shape: "rect",
        x: 0.57,
        y: 0.5,
        width: 0.035,
        height: 0.18,
        axis: "y",
        travel: 0.15,
        cycleSeconds: 5.5,
        phase: 0.1,
      },
    ],
    boundaryRails: [
      { side: "top", from: 0, to: 0.34 },
      { side: "top", from: 0.56, to: 1 },
      { side: "right", from: 0, to: 0.58 },
      { side: "bottom", from: 0.2, to: 0.82 },
      { side: "left", from: 0.28, to: 1 },
    ],
    water: [],
    sand: [
      { x: 0.17, y: 0.58, width: 0.15, height: 0.13 },
      { x: 0.72, y: 0.3, width: 0.12, height: 0.1 },
    ],
  },
  {
    id: 2,
    name: "Vịnh san hô xanh",
    par: 4,
    theme: "coast",
    start: { x: 0.1, y: 0.17 },
    hole: { x: 0.9, y: 0.82 },
    terrain: {
      slopeX: -0.1,
      slopeY: 0.16,
      waveX: 0.07,
      waveY: 0.15,
      ridge: 0.055,
      frequencyX: 1.15,
      frequencyY: 1.55,
    },
    obstacles: [
      { x: 0.28, y: 0.18, width: 0.04, height: 0.27 },
      { x: 0.69, y: 0.58, width: 0.04, height: 0.24 },
    ],
    roundObstacles: [
      { x: 0.22, y: 0.7, radius: 0.045 },
      { x: 0.78, y: 0.3, radius: 0.052 },
    ],
    movingObstacles: [
      {
        id: "coral-ferry",
        shape: "rect",
        x: 0.51,
        y: 0.5,
        width: 0.13,
        height: 0.035,
        axis: "y",
        travel: 0.19,
        cycleSeconds: 6.2,
        phase: 0.35,
      },
    ],
    boundaryRails: [
      { side: "top", from: 0.12, to: 0.74 },
      { side: "right", from: 0.24, to: 1 },
      { side: "bottom", from: 0, to: 0.48 },
      { side: "bottom", from: 0.7, to: 1 },
      { side: "left", from: 0, to: 0.66 },
    ],
    water: [
      { x: 0.39, y: 0.17, width: 0.23, height: 0.24 },
      { x: 0.39, y: 0.59, width: 0.23, height: 0.24 },
    ],
    sand: [
      { x: 0.72, y: 0.64, width: 0.13, height: 0.12 },
    ],
  },
  {
    id: 3,
    name: "Cầu gió cao nguyên",
    par: 4,
    theme: "forest",
    start: { x: 0.1, y: 0.84 },
    hole: { x: 0.9, y: 0.16 },
    terrain: {
      slopeX: 0.2,
      slopeY: -0.27,
      waveX: 0.14,
      waveY: 0.11,
      ridge: 0.075,
      frequencyX: 1.65,
      frequencyY: 1.35,
    },
    obstacles: [
      { x: 0.22, y: 0.65, width: 0.21, height: 0.035 },
      { x: 0.58, y: 0.3, width: 0.21, height: 0.035 },
    ],
    roundObstacles: [
      { x: 0.27, y: 0.28, radius: 0.044 },
      { x: 0.73, y: 0.7, radius: 0.044 },
    ],
    movingObstacles: [
      {
        id: "highland-crossbar-a",
        shape: "rect",
        x: 0.45,
        y: 0.55,
        width: 0.16,
        height: 0.032,
        axis: "x",
        travel: 0.13,
        cycleSeconds: 4.6,
        phase: 0,
      },
      {
        id: "highland-crossbar-b",
        shape: "rect",
        x: 0.58,
        y: 0.43,
        width: 0.032,
        height: 0.17,
        axis: "y",
        travel: 0.12,
        cycleSeconds: 5.2,
        phase: 0.5,
      },
    ],
    boundaryRails: [
      { side: "top", from: 0, to: 0.26 },
      { side: "top", from: 0.45, to: 1 },
      { side: "right", from: 0, to: 0.42 },
      { side: "right", from: 0.62, to: 1 },
      { side: "bottom", from: 0.16, to: 0.76 },
      { side: "left", from: 0.38, to: 1 },
    ],
    water: [
      { x: 0.44, y: 0.18, width: 0.1, height: 0.21 },
    ],
    sand: [
      { x: 0.45, y: 0.7, width: 0.16, height: 0.1 },
    ],
  },
  {
    id: 4,
    name: "Hẻm núi dung nham",
    par: 4,
    theme: "desert",
    start: { x: 0.08, y: 0.51 },
    hole: { x: 0.92, y: 0.49 },
    terrain: {
      slopeX: -0.24,
      slopeY: 0.12,
      waveX: 0.18,
      waveY: 0.09,
      ridge: 0.085,
      frequencyX: 1.8,
      frequencyY: 1.3,
    },
    obstacles: [
      { x: 0.36, y: 0.14, width: 0.035, height: 0.25 },
      { x: 0.36, y: 0.62, width: 0.035, height: 0.24 },
      { x: 0.67, y: 0.36, width: 0.035, height: 0.28 },
    ],
    roundObstacles: [
      { x: 0.22, y: 0.27, radius: 0.065 },
      { x: 0.78, y: 0.74, radius: 0.07 },
    ],
    movingObstacles: [
      {
        id: "canyon-boulder",
        shape: "circle",
        x: 0.53,
        y: 0.5,
        radius: 0.048,
        axis: "y",
        travel: 0.27,
        cycleSeconds: 4.8,
        phase: 0.2,
      },
    ],
    boundaryRails: [
      { side: "top", from: 0.08, to: 0.62 },
      { side: "right", from: 0.2, to: 0.8 },
      { side: "bottom", from: 0.38, to: 0.94 },
      { side: "left", from: 0, to: 0.35 },
      { side: "left", from: 0.62, to: 1 },
    ],
    water: [],
    sand: [
      { x: 0.17, y: 0.38, width: 0.16, height: 0.23 },
      { x: 0.72, y: 0.36, width: 0.13, height: 0.25 },
    ],
  },
  {
    id: 5,
    name: "Đảo nổi thủy triều",
    par: 5,
    theme: "coast",
    start: { x: 0.09, y: 0.84 },
    hole: { x: 0.91, y: 0.16 },
    terrain: {
      slopeX: 0.12,
      slopeY: -0.15,
      waveX: 0.16,
      waveY: 0.19,
      ridge: 0.06,
      frequencyX: 1.45,
      frequencyY: 1.75,
    },
    obstacles: [
      { x: 0.3, y: 0.48, width: 0.12, height: 0.035 },
      { x: 0.63, y: 0.48, width: 0.12, height: 0.035 },
    ],
    roundObstacles: [
      { x: 0.2, y: 0.3, radius: 0.045 },
      { x: 0.82, y: 0.68, radius: 0.045 },
    ],
    movingObstacles: [
      {
        id: "tide-bridge",
        shape: "rect",
        x: 0.52,
        y: 0.5,
        width: 0.1,
        height: 0.035,
        axis: "x",
        travel: 0.14,
        cycleSeconds: 5.8,
        phase: 0.15,
      },
    ],
    boundaryRails: [
      { side: "top", from: 0.2, to: 0.82 },
      { side: "right", from: 0, to: 0.42 },
      { side: "right", from: 0.66, to: 1 },
      { side: "bottom", from: 0, to: 0.56 },
      { side: "left", from: 0.24, to: 0.88 },
    ],
    water: [
      { x: 0.24, y: 0.08, width: 0.16, height: 0.31 },
      { x: 0.24, y: 0.65, width: 0.16, height: 0.27 },
      { x: 0.62, y: 0.24, width: 0.15, height: 0.28 },
    ],
    sand: [
      { x: 0.77, y: 0.28, width: 0.11, height: 0.12 },
    ],
  },
  {
    id: 6,
    name: "Khu vườn đồng hồ",
    par: 4,
    theme: "night",
    start: { x: 0.1, y: 0.5 },
    hole: { x: 0.9, y: 0.5 },
    terrain: {
      slopeX: -0.09,
      slopeY: 0.13,
      waveX: 0.14,
      waveY: 0.14,
      ridge: 0.07,
      frequencyX: 1.7,
      frequencyY: 1.7,
    },
    obstacles: [
      { x: 0.26, y: 0.23, width: 0.035, height: 0.22 },
      { x: 0.26, y: 0.56, width: 0.035, height: 0.22 },
      { x: 0.72, y: 0.23, width: 0.035, height: 0.22 },
      { x: 0.72, y: 0.56, width: 0.035, height: 0.22 },
    ],
    roundObstacles: [
      { x: 0.5, y: 0.5, radius: 0.055 },
    ],
    movingObstacles: [
      {
        id: "clock-hand-horizontal",
        shape: "rect",
        x: 0.5,
        y: 0.36,
        width: 0.2,
        height: 0.03,
        axis: "x",
        travel: 0.16,
        cycleSeconds: 4.4,
        phase: 0,
      },
      {
        id: "clock-hand-vertical",
        shape: "rect",
        x: 0.5,
        y: 0.65,
        width: 0.03,
        height: 0.19,
        axis: "y",
        travel: 0.13,
        cycleSeconds: 5.1,
        phase: 0.5,
      },
    ],
    boundaryRails: [
      { side: "top", from: 0, to: 0.44 },
      { side: "top", from: 0.62, to: 1 },
      { side: "right", from: 0.18, to: 0.78 },
      { side: "bottom", from: 0.16, to: 0.7 },
      { side: "left", from: 0.32, to: 1 },
    ],
    water: [
      { x: 0.39, y: 0.13, width: 0.22, height: 0.13 },
      { x: 0.39, y: 0.74, width: 0.22, height: 0.13 },
    ],
    sand: [],
  },
  {
    id: 7,
    name: "Sa mạc ốc đảo",
    par: 5,
    theme: "desert",
    start: { x: 0.1, y: 0.14 },
    hole: { x: 0.9, y: 0.84 },
    terrain: {
      slopeX: 0.27,
      slopeY: 0.17,
      waveX: 0.21,
      waveY: 0.13,
      ridge: 0.09,
      frequencyX: 1.9,
      frequencyY: 1.4,
    },
    obstacles: [
      { x: 0.31, y: 0.25, width: 0.035, height: 0.25 },
      { x: 0.65, y: 0.51, width: 0.035, height: 0.25 },
    ],
    roundObstacles: [
      { x: 0.22, y: 0.7, radius: 0.068 },
      { x: 0.78, y: 0.29, radius: 0.07 },
    ],
    movingObstacles: [
      {
        id: "desert-roller-a",
        shape: "circle",
        x: 0.48,
        y: 0.38,
        radius: 0.042,
        axis: "x",
        travel: 0.19,
        cycleSeconds: 4.7,
        phase: 0.18,
      },
      {
        id: "desert-roller-b",
        shape: "circle",
        x: 0.55,
        y: 0.68,
        radius: 0.04,
        axis: "x",
        travel: 0.17,
        cycleSeconds: 5.4,
        phase: 0.62,
      },
    ],
    boundaryRails: [
      { side: "top", from: 0, to: 0.52 },
      { side: "right", from: 0.28, to: 1 },
      { side: "bottom", from: 0.3, to: 0.86 },
      { side: "left", from: 0, to: 0.42 },
      { side: "left", from: 0.65, to: 1 },
    ],
    water: [
      { x: 0.44, y: 0.48, width: 0.14, height: 0.14 },
    ],
    sand: [
      { x: 0.17, y: 0.35, width: 0.18, height: 0.17 },
      { x: 0.66, y: 0.62, width: 0.17, height: 0.14 },
    ],
  },
  {
    id: 8,
    name: "Rừng mưa xoáy nước",
    par: 5,
    theme: "forest",
    start: { x: 0.09, y: 0.83 },
    hole: { x: 0.91, y: 0.17 },
    terrain: {
      slopeX: -0.2,
      slopeY: -0.24,
      waveX: 0.15,
      waveY: 0.22,
      ridge: 0.085,
      frequencyX: 1.55,
      frequencyY: 1.9,
    },
    obstacles: [
      { x: 0.22, y: 0.51, width: 0.18, height: 0.035 },
      { x: 0.62, y: 0.38, width: 0.18, height: 0.035 },
    ],
    roundObstacles: [
      { x: 0.29, y: 0.25, radius: 0.052 },
      { x: 0.72, y: 0.76, radius: 0.052 },
    ],
    movingObstacles: [
      {
        id: "rainforest-gate-a",
        shape: "rect",
        x: 0.48,
        y: 0.29,
        width: 0.035,
        height: 0.18,
        axis: "y",
        travel: 0.13,
        cycleSeconds: 4.5,
        phase: 0.25,
      },
      {
        id: "rainforest-gate-b",
        shape: "rect",
        x: 0.53,
        y: 0.7,
        width: 0.18,
        height: 0.035,
        axis: "x",
        travel: 0.13,
        cycleSeconds: 5.6,
        phase: 0.7,
      },
    ],
    boundaryRails: [
      { side: "top", from: 0.14, to: 0.68 },
      { side: "right", from: 0, to: 0.36 },
      { side: "right", from: 0.56, to: 1 },
      { side: "bottom", from: 0.24, to: 0.92 },
      { side: "left", from: 0.34, to: 1 },
    ],
    water: [
      { x: 0.2, y: 0.09, width: 0.13, height: 0.28 },
      { x: 0.44, y: 0.4, width: 0.14, height: 0.23 },
      { x: 0.69, y: 0.61, width: 0.13, height: 0.25 },
    ],
    sand: [
      { x: 0.73, y: 0.25, width: 0.13, height: 0.11 },
    ],
  },
  {
    id: 9,
    name: "Thiên hà cực quang",
    par: 6,
    theme: "night",
    start: { x: 0.07, y: 0.88 },
    hole: { x: 0.93, y: 0.12 },
    terrain: {
      slopeX: 0.22,
      slopeY: -0.28,
      waveX: 0.22,
      waveY: 0.2,
      ridge: 0.11,
      frequencyX: 2,
      frequencyY: 1.85,
    },
    obstacles: [
      { x: 0.2, y: 0.68, width: 0.17, height: 0.032 },
      { x: 0.63, y: 0.28, width: 0.17, height: 0.032 },
      { x: 0.34, y: 0.23, width: 0.032, height: 0.21 },
      { x: 0.67, y: 0.56, width: 0.032, height: 0.22 },
    ],
    roundObstacles: [
      { x: 0.23, y: 0.24, radius: 0.05 },
      { x: 0.78, y: 0.75, radius: 0.05 },
    ],
    movingObstacles: [
      {
        id: "aurora-gate-a",
        shape: "rect",
        x: 0.47,
        y: 0.57,
        width: 0.2,
        height: 0.03,
        axis: "x",
        travel: 0.16,
        cycleSeconds: 4.2,
        phase: 0.05,
      },
      {
        id: "aurora-gate-b",
        shape: "rect",
        x: 0.57,
        y: 0.38,
        width: 0.03,
        height: 0.2,
        axis: "y",
        travel: 0.15,
        cycleSeconds: 4.9,
        phase: 0.48,
      },
      {
        id: "aurora-orb",
        shape: "circle",
        x: 0.5,
        y: 0.5,
        radius: 0.045,
        axis: "x",
        travel: 0.24,
        cycleSeconds: 6,
        phase: 0.77,
      },
    ],
    boundaryRails: [
      { side: "top", from: 0, to: 0.3 },
      { side: "top", from: 0.5, to: 1 },
      { side: "right", from: 0.18, to: 0.72 },
      { side: "bottom", from: 0.2, to: 0.76 },
      { side: "left", from: 0, to: 0.32 },
      { side: "left", from: 0.56, to: 1 },
    ],
    water: [
      { x: 0.04, y: 0.08, width: 0.18, height: 0.19 },
      { x: 0.76, y: 0.71, width: 0.19, height: 0.23 },
      { x: 0.43, y: 0.39, width: 0.14, height: 0.22 },
    ],
    sand: [
      { x: 0.11, y: 0.56, width: 0.13, height: 0.11 },
      { x: 0.75, y: 0.15, width: 0.12, height: 0.1 },
    ],
  },
];
