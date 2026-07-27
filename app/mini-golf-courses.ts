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
