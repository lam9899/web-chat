export const MINI_GOLF_2D_WIDTH = 1000;
export const MINI_GOLF_2D_HEIGHT = 560;

export type MiniGolf2DPoint = {
  x: number;
  y: number;
};

export type MiniGolf2DRect = MiniGolf2DPoint & {
  width: number;
  height: number;
};

export type MiniGolf2DWall = MiniGolf2DRect & {
  kind?: "normal" | "bumper" | "sticky" | "slippery";
};

export type MiniGolf2DZone = MiniGolf2DRect & {
  type: "water" | "ice" | "mud" | "wind" | "trapdoor";
  forceX?: number;
  forceY?: number;
  phase?: number;
};

export type MiniGolf2DBumper = MiniGolf2DPoint & {
  radius: number;
};

export type MiniGolf2DPortal = MiniGolf2DPoint & {
  pairId: string;
  color: string;
  radius?: number;
};

export type MiniGolf2DCannon = MiniGolf2DPoint & {
  angle: number;
  power: number;
};

export type MiniGolf2DMagnet = MiniGolf2DPoint & {
  radius: number;
  strength: number;
  polarity: "pull" | "push";
};

export type MiniGolf2DCourse = {
  id: number;
  name: string;
  pack:
    | "Khởi hành"
    | "Gió & Bumper"
    | "Băng giá"
    | "Cơ khí"
    | "Một gậy";
  par: number;
  theme: "meadow" | "sunset" | "ice" | "factory" | "neon";
  start: MiniGolf2DPoint;
  hole: MiniGolf2DPoint;
  walls: MiniGolf2DWall[];
  zones: MiniGolf2DZone[];
  bumpers: MiniGolf2DBumper[];
  portals: MiniGolf2DPortal[];
  cannons: MiniGolf2DCannon[];
  magnets: MiniGolf2DMagnet[];
};

export const MINI_GOLF_2D_COURSES: MiniGolf2DCourse[] = [
  {
    id: 1,
    name: "Đường cong đầu tiên",
    pack: "Khởi hành",
    par: 3,
    theme: "meadow",
    start: { x: 105, y: 440 },
    hole: { x: 875, y: 115 },
    walls: [
      { x: 255, y: 320, width: 360, height: 24 },
      { x: 590, y: 175, width: 24, height: 169 },
      { x: 735, y: 175, width: 155, height: 24 },
    ],
    zones: [
      { type: "mud", x: 675, y: 350, width: 185, height: 100 },
    ],
    bumpers: [
      { x: 370, y: 205, radius: 29 },
    ],
    portals: [],
    cannons: [],
    magnets: [],
  },
  {
    id: 2,
    name: "Thung lũng đệm nảy",
    pack: "Gió & Bumper",
    par: 4,
    theme: "sunset",
    start: { x: 100, y: 280 },
    hole: { x: 900, y: 280 },
    walls: [
      {
        x: 285,
        y: 80,
        width: 25,
        height: 155,
        kind: "bumper",
      },
      {
        x: 285,
        y: 325,
        width: 25,
        height: 155,
        kind: "bumper",
      },
      {
        x: 690,
        y: 80,
        width: 25,
        height: 155,
        kind: "bumper",
      },
      {
        x: 690,
        y: 325,
        width: 25,
        height: 155,
        kind: "bumper",
      },
    ],
    zones: [
      {
        type: "wind",
        x: 330,
        y: 105,
        width: 330,
        height: 350,
        forceX: 0,
        forceY: -175,
      },
    ],
    bumpers: [
      { x: 410, y: 190, radius: 34 },
      { x: 500, y: 365, radius: 34 },
      { x: 590, y: 190, radius: 34 },
    ],
    portals: [],
    cannons: [],
    magnets: [],
  },
  {
    id: 3,
    name: "Hồ băng ngoằn ngoèo",
    pack: "Băng giá",
    par: 4,
    theme: "ice",
    start: { x: 95, y: 460 },
    hole: { x: 900, y: 100 },
    walls: [
      { x: 210, y: 360, width: 420, height: 24 },
      { x: 610, y: 190, width: 24, height: 194 },
      { x: 610, y: 190, width: 210, height: 24 },
    ],
    zones: [
      { type: "ice", x: 250, y: 390, width: 590, height: 100 },
      { type: "ice", x: 650, y: 225, width: 230, height: 120 },
      { type: "water", x: 335, y: 120, width: 190, height: 120 },
    ],
    bumpers: [
      { x: 755, y: 410, radius: 25 },
    ],
    portals: [],
    cannons: [],
    magnets: [],
  },
  {
    id: 4,
    name: "Cặp cổng bí mật",
    pack: "Cơ khí",
    par: 3,
    theme: "factory",
    start: { x: 105, y: 115 },
    hole: { x: 890, y: 425 },
    walls: [
      { x: 245, y: 70, width: 25, height: 350 },
      { x: 460, y: 145, width: 25, height: 345 },
      { x: 665, y: 70, width: 25, height: 350 },
      { x: 820, y: 260, width: 25, height: 230 },
    ],
    zones: [
      { type: "water", x: 285, y: 225, width: 150, height: 190 },
    ],
    bumpers: [],
    portals: [
      { pairId: "violet", color: "#c084fc", x: 165, y: 455 },
      { pairId: "violet", color: "#c084fc", x: 750, y: 130 },
      { pairId: "cyan", color: "#22d3ee", x: 565, y: 95 },
      { pairId: "cyan", color: "#22d3ee", x: 900, y: 180 },
    ],
    cannons: [],
    magnets: [],
  },
  {
    id: 5,
    name: "Pháo đài bắn bóng",
    pack: "Cơ khí",
    par: 4,
    theme: "factory",
    start: { x: 100, y: 445 },
    hole: { x: 900, y: 100 },
    walls: [
      { x: 185, y: 105, width: 25, height: 250 },
      { x: 355, y: 230, width: 330, height: 25 },
      { x: 665, y: 230, width: 25, height: 230 },
      {
        x: 790,
        y: 345,
        width: 150,
        height: 25,
        kind: "bumper",
      },
    ],
    zones: [
      { type: "water", x: 245, y: 300, width: 285, height: 120 },
    ],
    bumpers: [
      { x: 520, y: 110, radius: 35 },
    ],
    portals: [],
    cannons: [
      { x: 260, y: 475, angle: -0.85, power: 930 },
      { x: 735, y: 275, angle: -0.75, power: 850 },
    ],
    magnets: [],
  },
  {
    id: 6,
    name: "Nhịp cửa sập",
    pack: "Cơ khí",
    par: 5,
    theme: "factory",
    start: { x: 90, y: 280 },
    hole: { x: 910, y: 280 },
    walls: [
      { x: 260, y: 80, width: 25, height: 140 },
      { x: 260, y: 340, width: 25, height: 140 },
      { x: 715, y: 80, width: 25, height: 140 },
      { x: 715, y: 340, width: 25, height: 140 },
    ],
    zones: [
      {
        type: "trapdoor",
        x: 330,
        y: 115,
        width: 130,
        height: 130,
        phase: 0,
      },
      {
        type: "trapdoor",
        x: 535,
        y: 315,
        width: 130,
        height: 130,
        phase: 0.5,
      },
      {
        type: "wind",
        x: 330,
        y: 265,
        width: 335,
        height: 45,
        forceX: 210,
        forceY: 0,
      },
    ],
    bumpers: [
      { x: 500, y: 280, radius: 38 },
    ],
    portals: [],
    cannons: [],
    magnets: [],
  },
  {
    id: 7,
    name: "Phòng thí nghiệm nam châm",
    pack: "Cơ khí",
    par: 5,
    theme: "neon",
    start: { x: 100, y: 470 },
    hole: { x: 900, y: 90 },
    walls: [
      { x: 250, y: 330, width: 300, height: 22 },
      { x: 530, y: 185, width: 22, height: 167 },
      { x: 690, y: 185, width: 190, height: 22 },
    ],
    zones: [
      { type: "water", x: 640, y: 365, width: 230, height: 105 },
    ],
    bumpers: [],
    portals: [],
    cannons: [],
    magnets: [
      {
        x: 360,
        y: 180,
        radius: 155,
        strength: 440,
        polarity: "pull",
      },
      {
        x: 720,
        y: 300,
        radius: 140,
        strength: 390,
        polarity: "push",
      },
    ],
  },
  {
    id: 8,
    name: "Tường dính, tường trơn",
    pack: "Một gậy",
    par: 3,
    theme: "neon",
    start: { x: 95, y: 450 },
    hole: { x: 900, y: 115 },
    walls: [
      {
        x: 210,
        y: 310,
        width: 360,
        height: 24,
        kind: "slippery",
      },
      {
        x: 550,
        y: 165,
        width: 24,
        height: 169,
        kind: "sticky",
      },
      {
        x: 550,
        y: 165,
        width: 230,
        height: 24,
        kind: "slippery",
      },
      {
        x: 760,
        y: 165,
        width: 24,
        height: 180,
        kind: "sticky",
      },
    ],
    zones: [
      { type: "ice", x: 590, y: 355, width: 260, height: 95 },
    ],
    bumpers: [
      { x: 355, y: 160, radius: 31 },
    ],
    portals: [],
    cannons: [],
    magnets: [],
  },
  {
    id: 9,
    name: "Cú đánh phiêu lưu cuối",
    pack: "Một gậy",
    par: 5,
    theme: "neon",
    start: { x: 75, y: 480 },
    hole: { x: 925, y: 80 },
    walls: [
      {
        x: 170,
        y: 355,
        width: 275,
        height: 22,
        kind: "bumper",
      },
      {
        x: 425,
        y: 195,
        width: 22,
        height: 182,
        kind: "sticky",
      },
      {
        x: 425,
        y: 195,
        width: 250,
        height: 22,
        kind: "slippery",
      },
      {
        x: 765,
        y: 150,
        width: 22,
        height: 250,
      },
    ],
    zones: [
      {
        type: "wind",
        x: 490,
        y: 235,
        width: 220,
        height: 115,
        forceX: 105,
        forceY: -150,
      },
      {
        type: "trapdoor",
        x: 800,
        y: 365,
        width: 105,
        height: 105,
        phase: 0.25,
      },
    ],
    bumpers: [
      { x: 260, y: 175, radius: 34 },
      { x: 620, y: 430, radius: 32 },
    ],
    portals: [
      { pairId: "final", color: "#f472b6", x: 520, y: 115 },
      { pairId: "final", color: "#f472b6", x: 875, y: 255 },
    ],
    cannons: [],
    magnets: [
      {
        x: 710,
        y: 105,
        radius: 115,
        strength: 320,
        polarity: "pull",
      },
    ],
  },
];
