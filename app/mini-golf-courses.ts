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

export type MiniGolfEllipseArea = {
  shape: "ellipse";
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation?: number;
};

export type MiniGolfPolygonArea = {
  shape: "polygon";
  points: MiniGolfPoint[];
};

export type MiniGolfArea =
  | MiniGolfEllipseArea
  | MiniGolfPolygonArea;

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

export type MiniGolfMechanism = {
  id: string;
  type: "windmill" | "press" | "spinner" | "slide" | "vortex";
  x: number;
  y: number;
  angle?: number;
  width?: number;
  height?: number;
  length?: number;
  radius?: number;
  speed?: number;
  cycleSeconds?: number;
  phase?: number;
  strength?: number;
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
  playableArea: MiniGolfPoint[];
  railEdges: number[];
  obstacles: MiniGolfRect[];
  roundObstacles: MiniGolfCircle[];
  movingObstacles: MiniGolfMovingObstacle[];
  mechanisms: MiniGolfMechanism[];
  water: MiniGolfArea[];
  sand: MiniGolfArea[];
};

export type MiniGolfPlayableEdgeHit = {
  index: number;
  start: MiniGolfPoint;
  end: MiniGolfPoint;
  closest: MiniGolfPoint;
  normal: MiniGolfPoint;
  distance: number;
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

function polygonContainsPoint(
  point: MiniGolfPoint,
  polygon: MiniGolfPoint[],
) {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current, current += 1
  ) {
    const first = polygon[current];
    const second = polygon[previous];
    const crosses =
      first.y > point.y !== second.y > point.y &&
      point.x <
        ((second.x - first.x) * (point.y - first.y)) /
          (second.y - first.y || Number.EPSILON) +
          first.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function getMiniGolfAreaOutline(
  area: MiniGolfArea,
  ellipseSegments = 40,
) {
  if (area.shape === "polygon") {
    return area.points;
  }

  const rotation = area.rotation ?? 0;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return Array.from(
    { length: Math.max(16, ellipseSegments) },
    (_, index) => {
      const angle =
        (index / Math.max(16, ellipseSegments)) * Math.PI * 2;
      const localX = Math.cos(angle) * area.radiusX;
      const localY = Math.sin(angle) * area.radiusY;
      return {
        x: area.x + localX * cosine - localY * sine,
        y: area.y + localX * sine + localY * cosine,
      };
    },
  );
}

export function isMiniGolfPointInArea(
  point: MiniGolfPoint,
  area: MiniGolfArea,
) {
  if (area.shape === "polygon") {
    return polygonContainsPoint(point, area.points);
  }

  const rotation = -(area.rotation ?? 0);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const offsetX = point.x - area.x;
  const offsetY = point.y - area.y;
  const localX = offsetX * cosine - offsetY * sine;
  const localY = offsetX * sine + offsetY * cosine;
  return (
    (localX * localX) / (area.radiusX * area.radiusX) +
      (localY * localY) / (area.radiusY * area.radiusY) <=
    1
  );
}

export function isMiniGolfPointInPlayableArea(
  point: MiniGolfPoint,
  course: MiniGolfCourse,
) {
  return polygonContainsPoint(point, course.playableArea);
}

export function getClosestMiniGolfPlayableEdge(
  point: MiniGolfPoint,
  course: MiniGolfCourse,
): MiniGolfPlayableEdgeHit {
  const polygon = course.playableArea;
  const centroid = polygon.reduce(
    (total, current) => ({
      x: total.x + current.x / polygon.length,
      y: total.y + current.y / polygon.length,
    }),
    { x: 0, y: 0 },
  );
  let best: MiniGolfPlayableEdgeHit | null = null;

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const edgeX = end.x - start.x;
    const edgeY = end.y - start.y;
    const edgeLengthSquared = edgeX * edgeX + edgeY * edgeY;
    const along = Math.min(
      1,
      Math.max(
        0,
        ((point.x - start.x) * edgeX +
          (point.y - start.y) * edgeY) /
          Math.max(Number.EPSILON, edgeLengthSquared),
      ),
    );
    const closest = {
      x: start.x + edgeX * along,
      y: start.y + edgeY * along,
    };
    const distance = pointDistance(point, closest);
    const edgeLength = Math.sqrt(edgeLengthSquared);
    let normal = {
      x: -edgeY / Math.max(Number.EPSILON, edgeLength),
      y: edgeX / Math.max(Number.EPSILON, edgeLength),
    };
    if (
      (centroid.x - closest.x) * normal.x +
        (centroid.y - closest.y) * normal.y <
      0
    ) {
      normal = { x: -normal.x, y: -normal.y };
    }
    if (!best || distance < best.distance) {
      best = {
        index,
        start,
        end,
        closest,
        normal,
        distance,
      };
    }
  }

  return (
    best ?? {
      index: 0,
      start: polygon[0],
      end: polygon[1] ?? polygon[0],
      closest: polygon[0],
      normal: { x: 0, y: 1 },
      distance: 0,
    }
  );
}

export function isMiniGolfPlayableEdgeGuarded(
  course: MiniGolfCourse,
  edgeIndex: number,
) {
  return course.railEdges.includes(edgeIndex);
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

export function getMiniGolfMechanismAngle(
  mechanism: MiniGolfMechanism,
  timeMs: number,
) {
  return (
    (mechanism.angle ?? 0) +
    (timeMs / 1000) * (mechanism.speed ?? 1)
  );
}

export function getMiniGolfPressAmount(
  mechanism: MiniGolfMechanism,
  timeMs: number,
) {
  const cycleSeconds = Math.max(1.4, mechanism.cycleSeconds ?? 3.6);
  const phase =
    (timeMs / 1000 / cycleSeconds + (mechanism.phase ?? 0)) *
    Math.PI *
    2;
  return (Math.sin(phase) + 1) / 2;
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

  return (
    (directionalSlope + broadHills + ridge) *
    (1 - flattenAmount)
  );
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

function ellipse(
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation = 0,
): MiniGolfEllipseArea {
  return { shape: "ellipse", x, y, radiusX, radiusY, rotation };
}

function polygon(points: MiniGolfPoint[]): MiniGolfPolygonArea {
  return { shape: "polygon", points };
}

const TERRAIN = {
  valley: {
    slopeX: 0.13,
    slopeY: -0.19,
    waveX: 0.12,
    waveY: 0.08,
    ridge: 0.045,
    frequencyX: 1.35,
    frequencyY: 1.15,
  },
  coast: {
    slopeX: -0.1,
    slopeY: 0.16,
    waveX: 0.07,
    waveY: 0.15,
    ridge: 0.055,
    frequencyX: 1.15,
    frequencyY: 1.55,
  },
  highland: {
    slopeX: 0.2,
    slopeY: -0.27,
    waveX: 0.14,
    waveY: 0.11,
    ridge: 0.075,
    frequencyX: 1.65,
    frequencyY: 1.35,
  },
  canyon: {
    slopeX: -0.24,
    slopeY: 0.12,
    waveX: 0.18,
    waveY: 0.09,
    ridge: 0.085,
    frequencyX: 1.8,
    frequencyY: 1.3,
  },
  island: {
    slopeX: 0.12,
    slopeY: -0.15,
    waveX: 0.16,
    waveY: 0.19,
    ridge: 0.06,
    frequencyX: 1.45,
    frequencyY: 1.75,
  },
  clock: {
    slopeX: -0.09,
    slopeY: 0.13,
    waveX: 0.14,
    waveY: 0.14,
    ridge: 0.07,
    frequencyX: 1.7,
    frequencyY: 1.7,
  },
  desert: {
    slopeX: 0.27,
    slopeY: 0.17,
    waveX: 0.21,
    waveY: 0.13,
    ridge: 0.09,
    frequencyX: 1.9,
    frequencyY: 1.4,
  },
  rain: {
    slopeX: -0.2,
    slopeY: -0.24,
    waveX: 0.15,
    waveY: 0.22,
    ridge: 0.085,
    frequencyX: 1.55,
    frequencyY: 1.9,
  },
  aurora: {
    slopeX: 0.22,
    slopeY: -0.28,
    waveX: 0.22,
    waveY: 0.2,
    ridge: 0.11,
    frequencyX: 2,
    frequencyY: 1.85,
  },
} satisfies Record<string, MiniGolfTerrainProfile>;

export const MINI_GOLF_COURSES: MiniGolfCourse[] = [
  {
    id: 1,
    name: "Đồi cỏ Cánh Quạt",
    par: 3,
    theme: "forest",
    start: { x: 0.11, y: 0.76 },
    hole: { x: 0.87, y: 0.2 },
    terrain: TERRAIN.valley,
    playableArea: [
      { x: 0.04, y: 0.2 },
      { x: 0.17, y: 0.08 },
      { x: 0.39, y: 0.13 },
      { x: 0.53, y: 0.05 },
      { x: 0.79, y: 0.09 },
      { x: 0.96, y: 0.23 },
      { x: 0.9, y: 0.43 },
      { x: 0.98, y: 0.65 },
      { x: 0.83, y: 0.92 },
      { x: 0.61, y: 0.86 },
      { x: 0.44, y: 0.96 },
      { x: 0.21, y: 0.9 },
      { x: 0.05, y: 0.75 },
      { x: 0.1, y: 0.51 },
    ],
    railEdges: [0, 1, 2, 4, 5, 7, 8, 10, 11, 13],
    obstacles: [
      { x: 0.28, y: 0.54, width: 0.035, height: 0.2 },
    ],
    roundObstacles: [{ x: 0.55, y: 0.3, radius: 0.045 }],
    movingObstacles: [],
    mechanisms: [
      {
        id: "windmill-one",
        type: "windmill",
        x: 0.53,
        y: 0.55,
        radius: 0.12,
        speed: 1.45,
      },
      {
        id: "slide-one",
        type: "slide",
        x: 0.73,
        y: 0.43,
        width: 0.16,
        height: 0.09,
        angle: -0.7,
        strength: 0.42,
      },
    ],
    water: [
      ellipse(0.24, 0.3, 0.11, 0.075, -0.35),
    ],
    sand: [
      polygon([
        { x: 0.14, y: 0.57 },
        { x: 0.27, y: 0.54 },
        { x: 0.32, y: 0.65 },
        { x: 0.23, y: 0.72 },
        { x: 0.12, y: 0.68 },
      ]),
    ],
  },
  {
    id: 2,
    name: "Vịnh Xoáy San Hô",
    par: 4,
    theme: "coast",
    start: { x: 0.12, y: 0.18 },
    hole: { x: 0.87, y: 0.81 },
    terrain: TERRAIN.coast,
    playableArea: [
      { x: 0.05, y: 0.1 },
      { x: 0.3, y: 0.06 },
      { x: 0.42, y: 0.16 },
      { x: 0.62, y: 0.07 },
      { x: 0.91, y: 0.13 },
      { x: 0.96, y: 0.36 },
      { x: 0.88, y: 0.49 },
      { x: 0.97, y: 0.71 },
      { x: 0.85, y: 0.93 },
      { x: 0.57, y: 0.88 },
      { x: 0.39, y: 0.96 },
      { x: 0.12, y: 0.88 },
      { x: 0.04, y: 0.64 },
      { x: 0.12, y: 0.45 },
    ],
    railEdges: [0, 1, 3, 4, 6, 7, 9, 10, 12],
    obstacles: [
      { x: 0.31, y: 0.18, width: 0.035, height: 0.2 },
    ],
    roundObstacles: [{ x: 0.76, y: 0.27, radius: 0.05 }],
    movingObstacles: [],
    mechanisms: [
      {
        id: "vortex-bay",
        type: "vortex",
        x: 0.5,
        y: 0.52,
        radius: 0.115,
        strength: 0.3,
        speed: 1.6,
      },
      {
        id: "spinner-bay",
        type: "spinner",
        x: 0.7,
        y: 0.65,
        length: 0.22,
        width: 0.02,
        speed: -1.9,
      },
    ],
    water: [
      polygon([
        { x: 0.36, y: 0.26 },
        { x: 0.48, y: 0.2 },
        { x: 0.58, y: 0.27 },
        { x: 0.61, y: 0.4 },
        { x: 0.52, y: 0.47 },
        { x: 0.39, y: 0.43 },
        { x: 0.32, y: 0.35 },
      ]),
      ellipse(0.27, 0.73, 0.13, 0.07, 0.3),
    ],
    sand: [
      ellipse(0.79, 0.5, 0.11, 0.065, -0.45),
    ],
  },
  {
    id: 3,
    name: "Cầu Trượt Cao Nguyên",
    par: 4,
    theme: "forest",
    start: { x: 0.1, y: 0.82 },
    hole: { x: 0.9, y: 0.16 },
    terrain: TERRAIN.highland,
    playableArea: [
      { x: 0.06, y: 0.24 },
      { x: 0.2, y: 0.08 },
      { x: 0.42, y: 0.15 },
      { x: 0.55, y: 0.06 },
      { x: 0.86, y: 0.1 },
      { x: 0.96, y: 0.3 },
      { x: 0.87, y: 0.48 },
      { x: 0.96, y: 0.66 },
      { x: 0.82, y: 0.9 },
      { x: 0.62, y: 0.85 },
      { x: 0.48, y: 0.96 },
      { x: 0.22, y: 0.91 },
      { x: 0.05, y: 0.76 },
      { x: 0.12, y: 0.53 },
    ],
    railEdges: [0, 2, 3, 4, 5, 7, 8, 10, 11, 13],
    obstacles: [
      { x: 0.2, y: 0.61, width: 0.18, height: 0.03 },
      { x: 0.67, y: 0.26, width: 0.16, height: 0.03 },
    ],
    roundObstacles: [{ x: 0.25, y: 0.3, radius: 0.043 }],
    movingObstacles: [],
    mechanisms: [
      {
        id: "highland-slide",
        type: "slide",
        x: 0.49,
        y: 0.51,
        width: 0.22,
        height: 0.1,
        angle: -0.82,
        strength: 0.55,
      },
      {
        id: "highland-press",
        type: "press",
        x: 0.72,
        y: 0.49,
        width: 0.09,
        height: 0.13,
        cycleSeconds: 3.2,
        phase: 0.18,
      },
    ],
    water: [ellipse(0.49, 0.73, 0.12, 0.055, 0.1)],
    sand: [ellipse(0.55, 0.2, 0.1, 0.055, -0.2)],
  },
  {
    id: 4,
    name: "Hẻm Máy Dập",
    par: 4,
    theme: "desert",
    start: { x: 0.09, y: 0.5 },
    hole: { x: 0.9, y: 0.48 },
    terrain: TERRAIN.canyon,
    playableArea: [
      { x: 0.04, y: 0.35 },
      { x: 0.15, y: 0.17 },
      { x: 0.36, y: 0.22 },
      { x: 0.48, y: 0.08 },
      { x: 0.71, y: 0.17 },
      { x: 0.94, y: 0.31 },
      { x: 0.87, y: 0.48 },
      { x: 0.96, y: 0.66 },
      { x: 0.75, y: 0.85 },
      { x: 0.58, y: 0.76 },
      { x: 0.39, y: 0.91 },
      { x: 0.16, y: 0.8 },
      { x: 0.05, y: 0.63 },
    ],
    railEdges: [0, 1, 3, 4, 5, 7, 8, 10, 11],
    obstacles: [
      { x: 0.31, y: 0.2, width: 0.03, height: 0.22 },
      { x: 0.31, y: 0.6, width: 0.03, height: 0.18 },
    ],
    roundObstacles: [
      { x: 0.2, y: 0.3, radius: 0.055 },
      { x: 0.78, y: 0.7, radius: 0.06 },
    ],
    movingObstacles: [],
    mechanisms: [
      {
        id: "press-canyon-a",
        type: "press",
        x: 0.5,
        y: 0.38,
        width: 0.1,
        height: 0.16,
        cycleSeconds: 2.7,
        phase: 0,
      },
      {
        id: "press-canyon-b",
        type: "press",
        x: 0.66,
        y: 0.62,
        width: 0.11,
        height: 0.14,
        cycleSeconds: 3.1,
        phase: 0.5,
      },
    ],
    water: [],
    sand: [
      polygon([
        { x: 0.39, y: 0.58 },
        { x: 0.54, y: 0.54 },
        { x: 0.61, y: 0.65 },
        { x: 0.51, y: 0.76 },
        { x: 0.37, y: 0.7 },
      ]),
    ],
  },
  {
    id: 5,
    name: "Quần Đảo Cầu Gỗ",
    par: 5,
    theme: "coast",
    start: { x: 0.1, y: 0.84 },
    hole: { x: 0.9, y: 0.16 },
    terrain: TERRAIN.island,
    playableArea: [
      { x: 0.06, y: 0.18 },
      { x: 0.26, y: 0.08 },
      { x: 0.4, y: 0.17 },
      { x: 0.57, y: 0.07 },
      { x: 0.83, y: 0.1 },
      { x: 0.95, y: 0.27 },
      { x: 0.88, y: 0.45 },
      { x: 0.97, y: 0.64 },
      { x: 0.83, y: 0.91 },
      { x: 0.59, y: 0.84 },
      { x: 0.43, y: 0.95 },
      { x: 0.2, y: 0.9 },
      { x: 0.04, y: 0.73 },
      { x: 0.12, y: 0.53 },
    ],
    railEdges: [0, 2, 3, 5, 6, 8, 9, 11, 12],
    obstacles: [
      { x: 0.34, y: 0.45, width: 0.1, height: 0.03 },
      { x: 0.62, y: 0.42, width: 0.11, height: 0.03 },
    ],
    roundObstacles: [{ x: 0.2, y: 0.3, radius: 0.045 }],
    movingObstacles: [],
    mechanisms: [
      {
        id: "island-spinner",
        type: "spinner",
        x: 0.53,
        y: 0.57,
        length: 0.28,
        width: 0.022,
        speed: 1.6,
      },
      {
        id: "island-slide",
        type: "slide",
        x: 0.73,
        y: 0.29,
        width: 0.16,
        height: 0.08,
        angle: -0.55,
        strength: 0.48,
      },
    ],
    water: [
      polygon([
        { x: 0.17, y: 0.39 },
        { x: 0.29, y: 0.34 },
        { x: 0.39, y: 0.4 },
        { x: 0.36, y: 0.55 },
        { x: 0.23, y: 0.59 },
        { x: 0.14, y: 0.51 },
      ]),
      ellipse(0.66, 0.72, 0.14, 0.075, -0.25),
    ],
    sand: [ellipse(0.82, 0.48, 0.09, 0.06, 0.35)],
  },
  {
    id: 6,
    name: "Vườn Đồng Hồ Xoay",
    par: 4,
    theme: "night",
    start: { x: 0.1, y: 0.5 },
    hole: { x: 0.9, y: 0.5 },
    terrain: TERRAIN.clock,
    playableArea: [
      { x: 0.05, y: 0.27 },
      { x: 0.2, y: 0.09 },
      { x: 0.41, y: 0.15 },
      { x: 0.52, y: 0.06 },
      { x: 0.81, y: 0.11 },
      { x: 0.95, y: 0.29 },
      { x: 0.88, y: 0.49 },
      { x: 0.96, y: 0.69 },
      { x: 0.8, y: 0.91 },
      { x: 0.57, y: 0.85 },
      { x: 0.43, y: 0.95 },
      { x: 0.17, y: 0.88 },
      { x: 0.04, y: 0.68 },
      { x: 0.12, y: 0.48 },
    ],
    railEdges: [0, 1, 3, 4, 6, 7, 9, 10, 12, 13],
    obstacles: [],
    roundObstacles: [{ x: 0.5, y: 0.5, radius: 0.045 }],
    movingObstacles: [],
    mechanisms: [
      {
        id: "clock-spinner-a",
        type: "spinner",
        x: 0.35,
        y: 0.35,
        length: 0.25,
        width: 0.022,
        speed: 2.1,
      },
      {
        id: "clock-spinner-b",
        type: "spinner",
        x: 0.66,
        y: 0.65,
        length: 0.25,
        width: 0.022,
        speed: -1.7,
      },
      {
        id: "clock-press",
        type: "press",
        x: 0.5,
        y: 0.25,
        width: 0.09,
        height: 0.12,
        cycleSeconds: 2.6,
        phase: 0.3,
      },
    ],
    water: [
      ellipse(0.5, 0.79, 0.15, 0.055),
    ],
    sand: [],
  },
  {
    id: 7,
    name: "Ốc Đảo Zíc Zắc",
    par: 5,
    theme: "desert",
    start: { x: 0.1, y: 0.15 },
    hole: { x: 0.89, y: 0.83 },
    terrain: TERRAIN.desert,
    playableArea: [
      { x: 0.05, y: 0.08 },
      { x: 0.28, y: 0.07 },
      { x: 0.37, y: 0.2 },
      { x: 0.57, y: 0.09 },
      { x: 0.77, y: 0.17 },
      { x: 0.95, y: 0.11 },
      { x: 0.91, y: 0.36 },
      { x: 0.97, y: 0.55 },
      { x: 0.89, y: 0.92 },
      { x: 0.66, y: 0.86 },
      { x: 0.49, y: 0.96 },
      { x: 0.31, y: 0.84 },
      { x: 0.09, y: 0.91 },
      { x: 0.13, y: 0.64 },
      { x: 0.04, y: 0.47 },
    ],
    railEdges: [0, 2, 4, 5, 7, 8, 10, 12, 14],
    obstacles: [
      { x: 0.31, y: 0.24, width: 0.03, height: 0.19 },
      { x: 0.64, y: 0.55, width: 0.03, height: 0.2 },
    ],
    roundObstacles: [
      { x: 0.23, y: 0.7, radius: 0.055 },
      { x: 0.77, y: 0.29, radius: 0.058 },
    ],
    movingObstacles: [],
    mechanisms: [
      {
        id: "desert-windmill",
        type: "windmill",
        x: 0.49,
        y: 0.4,
        radius: 0.13,
        speed: -1.35,
      },
      {
        id: "desert-slide",
        type: "slide",
        x: 0.68,
        y: 0.73,
        width: 0.16,
        height: 0.08,
        angle: 0.65,
        strength: 0.5,
      },
    ],
    water: [ellipse(0.49, 0.62, 0.11, 0.075, 0.25)],
    sand: [
      polygon([
        { x: 0.14, y: 0.31 },
        { x: 0.27, y: 0.28 },
        { x: 0.34, y: 0.41 },
        { x: 0.26, y: 0.51 },
        { x: 0.13, y: 0.46 },
      ]),
      ellipse(0.78, 0.51, 0.1, 0.07, -0.4),
    ],
  },
  {
    id: 8,
    name: "Thác Rừng Vòng Xoáy",
    par: 5,
    theme: "forest",
    start: { x: 0.09, y: 0.82 },
    hole: { x: 0.9, y: 0.17 },
    terrain: TERRAIN.rain,
    playableArea: [
      { x: 0.05, y: 0.22 },
      { x: 0.19, y: 0.08 },
      { x: 0.38, y: 0.16 },
      { x: 0.52, y: 0.05 },
      { x: 0.78, y: 0.11 },
      { x: 0.96, y: 0.25 },
      { x: 0.88, y: 0.43 },
      { x: 0.97, y: 0.64 },
      { x: 0.82, y: 0.91 },
      { x: 0.61, y: 0.83 },
      { x: 0.43, y: 0.96 },
      { x: 0.2, y: 0.89 },
      { x: 0.04, y: 0.72 },
      { x: 0.12, y: 0.5 },
    ],
    railEdges: [0, 1, 3, 5, 6, 8, 9, 11, 13],
    obstacles: [
      { x: 0.24, y: 0.54, width: 0.16, height: 0.03 },
    ],
    roundObstacles: [{ x: 0.27, y: 0.25, radius: 0.05 }],
    movingObstacles: [],
    mechanisms: [
      {
        id: "rain-vortex",
        type: "vortex",
        x: 0.53,
        y: 0.47,
        radius: 0.13,
        strength: 0.34,
        speed: 1.8,
      },
      {
        id: "rain-press",
        type: "press",
        x: 0.72,
        y: 0.67,
        width: 0.1,
        height: 0.13,
        cycleSeconds: 3,
        phase: 0.6,
      },
    ],
    water: [
      polygon([
        { x: 0.16, y: 0.35 },
        { x: 0.31, y: 0.31 },
        { x: 0.39, y: 0.39 },
        { x: 0.35, y: 0.5 },
        { x: 0.2, y: 0.53 },
        { x: 0.12, y: 0.45 },
      ]),
      ellipse(0.74, 0.32, 0.13, 0.065, -0.3),
    ],
    sand: [ellipse(0.68, 0.81, 0.11, 0.055, 0.2)],
  },
  {
    id: 9,
    name: "Thiên Hà Cổng Xoay",
    par: 6,
    theme: "night",
    start: { x: 0.08, y: 0.87 },
    hole: { x: 0.92, y: 0.13 },
    terrain: TERRAIN.aurora,
    playableArea: [
      { x: 0.04, y: 0.2 },
      { x: 0.16, y: 0.06 },
      { x: 0.36, y: 0.14 },
      { x: 0.49, y: 0.04 },
      { x: 0.7, y: 0.13 },
      { x: 0.94, y: 0.07 },
      { x: 0.9, y: 0.34 },
      { x: 0.98, y: 0.51 },
      { x: 0.9, y: 0.76 },
      { x: 0.96, y: 0.92 },
      { x: 0.69, y: 0.85 },
      { x: 0.5, y: 0.97 },
      { x: 0.31, y: 0.84 },
      { x: 0.06, y: 0.94 },
      { x: 0.12, y: 0.67 },
      { x: 0.03, y: 0.48 },
    ],
    railEdges: [0, 2, 3, 5, 7, 8, 10, 11, 13, 15],
    obstacles: [
      { x: 0.2, y: 0.66, width: 0.15, height: 0.03 },
      { x: 0.65, y: 0.27, width: 0.16, height: 0.03 },
    ],
    roundObstacles: [
      { x: 0.23, y: 0.24, radius: 0.048 },
      { x: 0.79, y: 0.75, radius: 0.048 },
    ],
    movingObstacles: [],
    mechanisms: [
      {
        id: "aurora-windmill",
        type: "windmill",
        x: 0.44,
        y: 0.39,
        radius: 0.13,
        speed: 1.9,
      },
      {
        id: "aurora-spinner",
        type: "spinner",
        x: 0.63,
        y: 0.61,
        length: 0.25,
        width: 0.022,
        speed: -2.2,
      },
      {
        id: "aurora-vortex",
        type: "vortex",
        x: 0.51,
        y: 0.72,
        radius: 0.105,
        strength: 0.3,
        speed: -1.7,
      },
    ],
    water: [
      ellipse(0.16, 0.22, 0.1, 0.065, 0.4),
      polygon([
        { x: 0.69, y: 0.4 },
        { x: 0.8, y: 0.34 },
        { x: 0.88, y: 0.43 },
        { x: 0.85, y: 0.57 },
        { x: 0.73, y: 0.6 },
        { x: 0.65, y: 0.51 },
      ]),
    ],
    sand: [ellipse(0.31, 0.55, 0.11, 0.06, -0.2)],
  },
];
