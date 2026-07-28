"use client";

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";
import {
  MINI_GOLF_2D_COURSES,
  MINI_GOLF_2D_HEIGHT,
  MINI_GOLF_2D_WIDTH,
  type MiniGolf2DCannon,
  type MiniGolf2DCourse,
  type MiniGolf2DPoint,
  type MiniGolf2DRect,
  type MiniGolf2DWall,
} from "./mini-golf-2d-courses";

const supabase = createClient();
const BALL_RADIUS = 11;
const HOLE_RADIUS = 16;
const HOLE_SECONDS = 120;
const MAX_HOLE_STROKES = 12;
const MAX_DRAG_DISTANCE = 115;
const MIN_DRAG_DISTANCE = 5;
const MAX_SHOT_SPEED = 1450;

const PLAYER_COLORS = [
  "#fb7185",
  "#60a5fa",
  "#facc15",
  "#4ade80",
  "#c084fc",
  "#fb923c",
  "#2dd4bf",
  "#818cf8",
  "#f472b6",
  "#22d3ee",
  "#a3e635",
  "#f87171",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#7dd3fc",
];

type MiniGolf2DMatch = {
  match_id: string;
  status: "playing" | "finished" | "cancelled";
  hole_count: number;
  course_seed: number;
  started_at: string;
  finished_at: string | null;
};

type MiniGolf2DPlayer = {
  match_id: string;
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: "admin" | "moderator" | "member";
  seat_index: number;
  current_hole: number;
  hole_strokes: number;
  total_strokes: number;
  hole_scores: number[];
  ball_x: number | null;
  ball_y: number | null;
  hole_started_at: string;
  hole_completed: boolean;
  player_status: "playing" | "finished" | "dnf";
  finished_at: string | null;
  rank_position: number;
};

type BallState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
  shotOriginX: number;
  shotOriginY: number;
  lastSafeX: number;
  lastSafeY: number;
  portalCooldownUntil: number;
  cannonCooldownUntil: number;
};

type ResumeSnapshot = {
  version: 1;
  matchId: string;
  hole: number;
  holeStrokes: number;
  savedAt: number;
  ball: BallState;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function pointInRect(
  point: MiniGolf2DPoint,
  rect: MiniGolf2DRect,
) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function distance(
  first: MiniGolf2DPoint,
  second: MiniGolf2DPoint,
) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  rect: MiniGolf2DRect,
  radius = 12,
) {
  context.beginPath();
  context.roundRect(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    radius,
  );
}

function themePalette(theme: MiniGolf2DCourse["theme"]) {
  switch (theme) {
    case "sunset":
      return {
        background: "#f97316",
        backgroundDark: "#9a3412",
        floor: "#86efac",
        floorDark: "#22c55e",
        border: "#7c2d12",
        highlight: "#fed7aa",
      };
    case "ice":
      return {
        background: "#0c4a6e",
        backgroundDark: "#082f49",
        floor: "#cffafe",
        floorDark: "#67e8f9",
        border: "#e0f2fe",
        highlight: "#ffffff",
      };
    case "factory":
      return {
        background: "#111827",
        backgroundDark: "#030712",
        floor: "#475569",
        floorDark: "#334155",
        border: "#f59e0b",
        highlight: "#fde68a",
      };
    case "neon":
      return {
        background: "#1e1b4b",
        backgroundDark: "#020617",
        floor: "#312e81",
        floorDark: "#1e1b4b",
        border: "#22d3ee",
        highlight: "#f0abfc",
      };
    default:
      return {
        background: "#166534",
        backgroundDark: "#052e16",
        floor: "#4ade80",
        floorDark: "#22c55e",
        border: "#713f12",
        highlight: "#fef3c7",
      };
  }
}

function bounceBall(
  ball: BallState,
  normalX: number,
  normalY: number,
  energy: number,
) {
  const dot = ball.vx * normalX + ball.vy * normalY;
  if (dot >= 0) return;
  ball.vx = (ball.vx - 2 * dot * normalX) * energy;
  ball.vy = (ball.vy - 2 * dot * normalY) * energy;
}

function collideWall(ball: BallState, wall: MiniGolf2DWall) {
  const nearestX = clamp(ball.x, wall.x, wall.x + wall.width);
  const nearestY = clamp(ball.y, wall.y, wall.y + wall.height);
  let offsetX = ball.x - nearestX;
  let offsetY = ball.y - nearestY;
  let currentDistance = Math.hypot(offsetX, offsetY);
  if (currentDistance >= BALL_RADIUS) return false;

  if (currentDistance < 0.001) {
    const candidates = [
      { value: Math.abs(ball.x - wall.x), x: -1, y: 0 },
      {
        value: Math.abs(wall.x + wall.width - ball.x),
        x: 1,
        y: 0,
      },
      { value: Math.abs(ball.y - wall.y), x: 0, y: -1 },
      {
        value: Math.abs(wall.y + wall.height - ball.y),
        x: 0,
        y: 1,
      },
    ].sort((first, second) => first.value - second.value);
    offsetX = candidates[0].x;
    offsetY = candidates[0].y;
    currentDistance = 1;
  }

  const normalX = offsetX / currentDistance;
  const normalY = offsetY / currentDistance;
  const penetration = BALL_RADIUS - currentDistance;
  ball.x += normalX * penetration;
  ball.y += normalY * penetration;
  const energy =
    wall.kind === "bumper"
      ? 1.12
      : wall.kind === "slippery"
        ? 1.01
        : wall.kind === "sticky"
          ? 0.28
          : 0.78;
  bounceBall(ball, normalX, normalY, energy);
  return true;
}

function collideBumper(
  ball: BallState,
  center: MiniGolf2DPoint,
  radius: number,
) {
  const offsetX = ball.x - center.x;
  const offsetY = ball.y - center.y;
  const currentDistance = Math.hypot(offsetX, offsetY);
  const minimumDistance = BALL_RADIUS + radius;
  if (
    currentDistance <= 0.001 ||
    currentDistance >= minimumDistance
  ) {
    return;
  }
  const normalX = offsetX / currentDistance;
  const normalY = offsetY / currentDistance;
  const penetration = minimumDistance - currentDistance;
  ball.x += normalX * penetration;
  ball.y += normalY * penetration;
  bounceBall(ball, normalX, normalY, 1.15);
  ball.vx += normalX * 85;
  ball.vy += normalY * 85;
}

function fireCannon(ball: BallState, cannon: MiniGolf2DCannon) {
  ball.x = cannon.x + Math.cos(cannon.angle) * 31;
  ball.y = cannon.y + Math.sin(cannon.angle) * 31;
  ball.vx = Math.cos(cannon.angle) * cannon.power;
  ball.vy = Math.sin(cannon.angle) * cannon.power;
  ball.cannonCooldownUntil = performance.now() + 650;
}

function trapdoorIsOpen(phase: number, timeMs: number) {
  return (
    ((timeMs / 1000 + phase * 3.2) % 3.2) <
    1.45
  );
}

function drawPixelBackground(
  context: CanvasRenderingContext2D,
  course: MiniGolf2DCourse,
) {
  const palette = themePalette(course.theme);
  const gradient = context.createLinearGradient(
    0,
    0,
    0,
    MINI_GOLF_2D_HEIGHT,
  );
  gradient.addColorStop(0, palette.background);
  gradient.addColorStop(1, palette.backgroundDark);
  context.fillStyle = gradient;
  context.fillRect(
    0,
    0,
    MINI_GOLF_2D_WIDTH,
    MINI_GOLF_2D_HEIGHT,
  );

  context.fillStyle = palette.floor;
  context.fillRect(28, 28, 944, 504);
  const tileSize = 32;
  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < 30; column += 1) {
      if ((row + column) % 2 !== 0) continue;
      context.fillStyle = `${palette.floorDark}55`;
      context.fillRect(
        30 + column * tileSize,
        30 + row * tileSize,
        tileSize,
        tileSize,
      );
    }
  }

  context.strokeStyle = palette.border;
  context.lineWidth = 18;
  context.strokeRect(26, 26, 948, 508);
  context.strokeStyle = palette.highlight;
  context.lineWidth = 3;
  context.strokeRect(36, 36, 928, 488);
}

function drawZones(
  context: CanvasRenderingContext2D,
  course: MiniGolf2DCourse,
  timeMs: number,
) {
  for (const zone of course.zones) {
    context.save();
    if (zone.type === "water") {
      const gradient = context.createLinearGradient(
        zone.x,
        zone.y,
        zone.x,
        zone.y + zone.height,
      );
      gradient.addColorStop(0, "#67e8f9");
      gradient.addColorStop(1, "#0369a1");
      context.fillStyle = gradient;
      roundedRectPath(context, zone, 22);
      context.fill();
      context.clip();
      context.strokeStyle = "rgba(255,255,255,0.45)";
      context.lineWidth = 3;
      const offset = (timeMs / 45) % 28;
      for (
        let y = zone.y + 15;
        y < zone.y + zone.height;
        y += 24
      ) {
        context.beginPath();
        for (
          let x = zone.x - 20 + offset;
          x < zone.x + zone.width;
          x += 28
        ) {
          context.moveTo(x, y);
          context.quadraticCurveTo(x + 7, y - 5, x + 14, y);
        }
        context.stroke();
      }
    } else if (zone.type === "ice") {
      context.fillStyle = "rgba(224,242,254,0.88)";
      roundedRectPath(context, zone, 16);
      context.fill();
      context.clip();
      context.strokeStyle = "rgba(56,189,248,0.5)";
      context.lineWidth = 2;
      for (let x = zone.x - 40; x < zone.x + zone.width; x += 36) {
        context.beginPath();
        context.moveTo(x, zone.y + zone.height);
        context.lineTo(x + zone.height, zone.y);
        context.stroke();
      }
    } else if (zone.type === "mud") {
      context.fillStyle = "#92400e";
      roundedRectPath(context, zone, 24);
      context.fill();
      context.fillStyle = "rgba(69,26,3,0.45)";
      for (let index = 0; index < 18; index += 1) {
        const x = zone.x + 12 + ((index * 47) % (zone.width - 24));
        const y =
          zone.y + 12 + ((index * 29) % (zone.height - 24));
        context.beginPath();
        context.arc(x, y, 3 + (index % 4), 0, Math.PI * 2);
        context.fill();
      }
    } else if (zone.type === "wind") {
      context.fillStyle = "rgba(219,234,254,0.13)";
      roundedRectPath(context, zone, 15);
      context.fill();
      context.strokeStyle = "rgba(255,255,255,0.7)";
      context.lineWidth = 3;
      const direction = Math.atan2(
        zone.forceY ?? 0,
        zone.forceX ?? 0,
      );
      for (let index = 0; index < 9; index += 1) {
        const x =
          zone.x + 28 + ((index * 71 + timeMs / 12) % (zone.width - 56));
        const y =
          zone.y + 20 + ((index * 43) % (zone.height - 40));
        context.save();
        context.translate(x, y);
        context.rotate(direction);
        context.beginPath();
        context.moveTo(-13, 0);
        context.lineTo(13, 0);
        context.lineTo(5, -6);
        context.moveTo(13, 0);
        context.lineTo(5, 6);
        context.stroke();
        context.restore();
      }
    } else {
      const open = trapdoorIsOpen(zone.phase ?? 0, timeMs);
      context.fillStyle = open ? "#020617" : "#475569";
      roundedRectPath(context, zone, 10);
      context.fill();
      context.strokeStyle = open ? "#ef4444" : "#facc15";
      context.lineWidth = 5;
      roundedRectPath(context, zone, 10);
      context.stroke();
      if (!open) {
        context.strokeStyle = "rgba(255,255,255,0.35)";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(zone.x + zone.width / 2, zone.y + 8);
        context.lineTo(
          zone.x + zone.width / 2,
          zone.y + zone.height - 8,
        );
        context.stroke();
      }
    }
    context.restore();
  }
}

function drawWalls(
  context: CanvasRenderingContext2D,
  course: MiniGolf2DCourse,
) {
  for (const wall of course.walls) {
    const colors =
      wall.kind === "bumper"
        ? ["#ef4444", "#facc15"]
        : wall.kind === "sticky"
          ? ["#7e22ce", "#e879f9"]
          : wall.kind === "slippery"
            ? ["#bae6fd", "#ffffff"]
            : ["#334155", "#94a3b8"];
    context.save();
    context.shadowColor = "rgba(0,0,0,0.5)";
    context.shadowBlur = 10;
    context.shadowOffsetY = 5;
    context.fillStyle = colors[0];
    roundedRectPath(context, wall, 8);
    context.fill();
    context.restore();
    context.strokeStyle = colors[1];
    context.lineWidth = 4;
    roundedRectPath(context, wall, 8);
    context.stroke();

    if (wall.kind === "bumper") {
      context.save();
      roundedRectPath(context, wall, 8);
      context.clip();
      context.strokeStyle = "#111827";
      context.lineWidth = 7;
      for (
        let offset = -wall.height;
        offset < wall.width + wall.height;
        offset += 25
      ) {
        context.beginPath();
        context.moveTo(wall.x + offset, wall.y);
        context.lineTo(
          wall.x + offset + wall.height,
          wall.y + wall.height,
        );
        context.stroke();
      }
      context.restore();
    }
  }
}

function drawMechanisms(
  context: CanvasRenderingContext2D,
  course: MiniGolf2DCourse,
  timeMs: number,
) {
  for (const bumper of course.bumpers) {
    const pulse = 1 + Math.sin(timeMs / 180 + bumper.x) * 0.08;
    const gradient = context.createRadialGradient(
      bumper.x - 8,
      bumper.y - 8,
      4,
      bumper.x,
      bumper.y,
      bumper.radius * pulse,
    );
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.25, "#facc15");
    gradient.addColorStop(0.7, "#f97316");
    gradient.addColorStop(1, "#991b1b");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(
      bumper.x,
      bumper.y,
      bumper.radius * pulse,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.strokeStyle = "#450a0a";
    context.lineWidth = 5;
    context.stroke();
  }

  for (const portal of course.portals) {
    const radius = portal.radius ?? 25;
    context.save();
    context.translate(portal.x, portal.y);
    context.rotate(timeMs / 650);
    context.strokeStyle = portal.color;
    context.lineWidth = 7;
    context.setLineDash([12, 8]);
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = `${portal.color}3d`;
    context.beginPath();
    context.arc(0, 0, radius - 7, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  for (const cannon of course.cannons) {
    context.save();
    context.translate(cannon.x, cannon.y);
    context.rotate(cannon.angle);
    context.fillStyle = "#111827";
    context.fillRect(-18, -15, 50, 30);
    context.fillStyle = "#64748b";
    context.fillRect(6, -11, 44, 22);
    context.strokeStyle = "#facc15";
    context.lineWidth = 4;
    context.strokeRect(6, -11, 44, 22);
    context.restore();
    context.fillStyle = "#0f172a";
    context.beginPath();
    context.arc(cannon.x - 7, cannon.y + 20, 13, 0, Math.PI * 2);
    context.fill();
  }

  for (const magnet of course.magnets) {
    context.save();
    context.strokeStyle =
      magnet.polarity === "pull" ? "#22d3ee" : "#fb7185";
    context.globalAlpha = 0.22;
    context.lineWidth = 3;
    for (let ring = 0.35; ring <= 1; ring += 0.22) {
      context.beginPath();
      context.arc(
        magnet.x,
        magnet.y,
        magnet.radius * ring +
          Math.sin(timeMs / 250 + ring) * 5,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
    context.globalAlpha = 1;
    context.lineWidth = 10;
    context.beginPath();
    context.arc(
      magnet.x,
      magnet.y,
      26,
      Math.PI * 0.15,
      Math.PI * 0.85,
    );
    context.stroke();
    context.fillStyle =
      magnet.polarity === "pull" ? "#22d3ee" : "#fb7185";
    context.font = "900 19px system-ui";
    context.textAlign = "center";
    context.fillText(
      magnet.polarity === "pull" ? "HÚT" : "ĐẨY",
      magnet.x,
      magnet.y + 9,
    );
    context.restore();
  }
}

function drawHole(
  context: CanvasRenderingContext2D,
  course: MiniGolf2DCourse,
  timeMs: number,
) {
  const { x, y } = course.hole;
  const gradient = context.createRadialGradient(
    x - 4,
    y - 4,
    2,
    x,
    y,
    HOLE_RADIUS,
  );
  gradient.addColorStop(0, "#334155");
  gradient.addColorStop(0.55, "#020617");
  gradient.addColorStop(1, "#000000");
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(x, y, HOLE_RADIUS, 10, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x, y - 63);
  context.stroke();
  context.fillStyle = "#ef4444";
  context.beginPath();
  context.moveTo(x, y - 63);
  context.lineTo(x + 45, y - 50 + Math.sin(timeMs / 190) * 3);
  context.lineTo(x, y - 37);
  context.closePath();
  context.fill();
}

function drawBall(
  context: CanvasRenderingContext2D,
  point: MiniGolf2DPoint,
  color: string,
  label: string,
  active: boolean,
) {
  context.save();
  context.shadowColor = active ? color : "rgba(0,0,0,0.5)";
  context.shadowBlur = active ? 15 : 7;
  const gradient = context.createRadialGradient(
    point.x - 4,
    point.y - 5,
    2,
    point.x,
    point.y,
    BALL_RADIUS,
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.23, color);
  gradient.addColorStop(1, "#111827");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(point.x, point.y, BALL_RADIUS, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = active ? "#ffffff" : "rgba(255,255,255,0.6)";
  context.lineWidth = active ? 3 : 2;
  context.stroke();
  context.restore();

  context.font = "800 12px system-ui";
  context.textAlign = "center";
  context.fillStyle = "#ffffff";
  context.strokeStyle = "rgba(2,6,23,0.9)";
  context.lineWidth = 4;
  context.strokeText(label, point.x, point.y - 19);
  context.fillText(label, point.x, point.y - 19);
}

function updateBall(
  ball: BallState,
  course: MiniGolf2DCourse,
  deltaSeconds: number,
  timeMs: number,
) {
  for (const magnet of course.magnets) {
    const offsetX = magnet.x - ball.x;
    const offsetY = magnet.y - ball.y;
    const currentDistance = Math.hypot(offsetX, offsetY);
    if (
      currentDistance > 1 &&
      currentDistance < magnet.radius
    ) {
      const influence =
        (1 - currentDistance / magnet.radius) *
        magnet.strength *
        (magnet.polarity === "pull" ? 1 : -1);
      ball.vx +=
        (offsetX / currentDistance) * influence * deltaSeconds;
      ball.vy +=
        (offsetY / currentDistance) * influence * deltaSeconds;
    }
  }

  for (const zone of course.zones) {
    if (
      zone.type === "wind" &&
      pointInRect(ball, zone)
    ) {
      ball.vx += (zone.forceX ?? 0) * deltaSeconds;
      ball.vy += (zone.forceY ?? 0) * deltaSeconds;
    }
  }

  ball.x += ball.vx * deltaSeconds;
  ball.y += ball.vy * deltaSeconds;

  const minimumX = 45 + BALL_RADIUS;
  const maximumX = MINI_GOLF_2D_WIDTH - 45 - BALL_RADIUS;
  const minimumY = 45 + BALL_RADIUS;
  const maximumY = MINI_GOLF_2D_HEIGHT - 45 - BALL_RADIUS;
  if (ball.x < minimumX) {
    ball.x = minimumX;
    bounceBall(ball, 1, 0, 0.76);
  } else if (ball.x > maximumX) {
    ball.x = maximumX;
    bounceBall(ball, -1, 0, 0.76);
  }
  if (ball.y < minimumY) {
    ball.y = minimumY;
    bounceBall(ball, 0, 1, 0.76);
  } else if (ball.y > maximumY) {
    ball.y = maximumY;
    bounceBall(ball, 0, -1, 0.76);
  }

  for (const wall of course.walls) collideWall(ball, wall);
  for (const bumper of course.bumpers) {
    collideBumper(ball, bumper, bumper.radius);
  }

  if (timeMs >= ball.portalCooldownUntil) {
    const enteredPortal = course.portals.find(
      (portal) =>
        distance(ball, portal) <
        BALL_RADIUS + (portal.radius ?? 25) * 0.72,
    );
    if (enteredPortal) {
      const destination = course.portals.find(
        (portal) =>
          portal.pairId === enteredPortal.pairId &&
          portal !== enteredPortal,
      );
      if (destination) {
        const speed = Math.max(220, Math.hypot(ball.vx, ball.vy));
        const direction = Math.atan2(ball.vy, ball.vx);
        ball.x = destination.x + Math.cos(direction) * 35;
        ball.y = destination.y + Math.sin(direction) * 35;
        ball.vx = Math.cos(direction) * speed;
        ball.vy = Math.sin(direction) * speed;
        ball.portalCooldownUntil = timeMs + 750;
      }
    }
  }

  if (timeMs >= ball.cannonCooldownUntil) {
    const cannon = course.cannons.find(
      (candidate) => distance(ball, candidate) < 28,
    );
    if (cannon) fireCannon(ball, cannon);
  }

  const activeZone = course.zones.find((zone) =>
    pointInRect(ball, zone),
  );
  const friction =
    activeZone?.type === "ice"
      ? 0.997
      : activeZone?.type === "mud"
        ? 0.88
        : 0.982;
  const frictionByTime = Math.pow(friction, deltaSeconds * 60);
  ball.vx *= frictionByTime;
  ball.vy *= frictionByTime;

  const hazard =
    activeZone?.type === "water" ||
    (activeZone?.type === "trapdoor" &&
      trapdoorIsOpen(activeZone.phase ?? 0, timeMs));
  return hazard ? "hazard" : "safe";
}

function playerInitial(player: MiniGolf2DPlayer) {
  return player.username.trim().charAt(0).toUpperCase() || "?";
}

export default function MiniGolf2DGame({
  channelId,
  currentUserId,
  onMatchChange,
}: {
  channelId: string;
  currentUserId: string;
  onMatchChange?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const shotResolvingRef = useRef(false);
  const shotStartedAtRef = useRef(0);
  const restoredKeyRef = useRef("");
  const timeoutKeyRef = useRef("");
  const ballRef = useRef<BallState>({
    x: 100,
    y: 440,
    vx: 0,
    vy: 0,
    moving: false,
    shotOriginX: 100,
    shotOriginY: 440,
    lastSafeX: 100,
    lastSafeY: 440,
    portalCooldownUntil: 0,
    cannonCooldownUntil: 0,
  });
  const [match, setMatch] = useState<MiniGolf2DMatch | null>(
    null,
  );
  const [players, setPlayers] = useState<MiniGolf2DPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [ballMoving, setBallMoving] = useState(false);
  const [isAiming, setIsAiming] = useState(false);
  const [aimStart, setAimStart] =
    useState<MiniGolf2DPoint | null>(null);
  const [aimPoint, setAimPoint] =
    useState<MiniGolf2DPoint | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState(
    "Giữ chuột trái trên bóng, kéo ngược hướng muốn đánh rồi thả.",
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const resumeStorageKey =
    `talkcunglamdz:minigolf2d:${channelId}:${currentUserId}`;

  const loadMatch = useCallback(async () => {
    const [
      { data: matchRows, error: matchError },
      { data: playerRows, error: playerError },
    ] = await Promise.all([
      supabase.rpc("get_minigolf_match", {
        p_channel_id: channelId,
      }),
      supabase.rpc("get_minigolf_players", {
        p_channel_id: channelId,
      }),
    ]);
    const firstError = matchError || playerError;
    if (firstError) {
      setErrorMessage(firstError.message);
      setLoading(false);
      return;
    }
    setMatch(
      ((matchRows ?? []) as MiniGolf2DMatch[])[0] ?? null,
    );
    setPlayers((playerRows ?? []) as MiniGolf2DPlayer[]);
    setErrorMessage("");
    setLoading(false);
  }, [channelId]);

  useEffect(() => {
    const initialTimer = window.setTimeout(
      () => void loadMatch(),
      0,
    );
    const realtime = supabase
      .channel(`mini-golf-2d-ui-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mini_golf_matches",
          filter: `channel_id=eq.${channelId}`,
        },
        () => {
          void loadMatch();
          onMatchChange?.();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mini_golf_match_players",
        },
        () => void loadMatch(),
      )
      .subscribe();
    const timer = window.setInterval(
      () => void loadMatch(),
      4_000,
    );
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      void supabase.removeChannel(realtime);
    };
  }, [channelId, loadMatch, onMatchChange]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleFullscreen = () =>
      setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () =>
      document.removeEventListener(
        "fullscreenchange",
        handleFullscreen,
      );
  }, []);

  const currentPlayer = useMemo(
    () =>
      players.find((player) => player.id === currentUserId) ??
      null,
    [currentUserId, players],
  );
  const viewedHole =
    currentPlayer?.current_hole ??
    Math.max(
      1,
      ...players.map((player) => player.current_hole),
    );
  const course =
    MINI_GOLF_2D_COURSES[
      (viewedHole - 1) % MINI_GOLF_2D_COURSES.length
    ];
  const activePlayerCount = players.filter(
    (player) => player.player_status === "playing",
  ).length;
  const remainingSeconds = currentPlayer
    ? clamp(
        HOLE_SECONDS -
          Math.floor(
            (now -
              new Date(currentPlayer.hole_started_at).getTime()) /
              1000,
          ),
        0,
        HOLE_SECONDS,
      )
    : HOLE_SECONDS;
  const canControl = Boolean(
    match?.status === "playing" &&
      currentPlayer?.player_status === "playing" &&
      !currentPlayer.hole_completed &&
      !working &&
      remainingSeconds > 0,
  );

  const clearResume = useCallback(() => {
    try {
      window.sessionStorage.removeItem(resumeStorageKey);
    } catch {
      // Trình duyệt có thể chặn storage; tiến độ server vẫn còn.
    }
  }, [resumeStorageKey]);

  const loadAfterAction = useCallback(async () => {
    await loadMatch();
    onMatchChange?.();
  }, [loadMatch, onMatchChange]);

  const recordShot = useCallback(
    async (
      x: number,
      y: number,
      holed: boolean,
      penalty: boolean,
      message?: string,
    ) => {
      if (shotResolvingRef.current) return;
      shotResolvingRef.current = true;
      setWorking(true);
      const { error } = await supabase.rpc(
        "record_minigolf_shot",
        {
          p_channel_id: channelId,
          p_ball_x: clamp(x / MINI_GOLF_2D_WIDTH, 0, 1),
          p_ball_y: clamp(y / MINI_GOLF_2D_HEIGHT, 0, 1),
          p_holed: holed,
          p_penalty: penalty,
        },
      );
      if (error) {
        setErrorMessage(error.message);
        setNoticeMessage("Không thể lưu cú đánh. Hãy thử lại.");
      } else {
        clearResume();
        setErrorMessage("");
        setNoticeMessage(
          message ??
            (holed
              ? activePlayerCount <= 1
                ? "⛳ Vào lỗ! Đang mở màn tiếp theo."
                : "⛳ Đã vào lỗ! Đang chờ những người chơi khác."
              : penalty
                ? "↩️ Bóng gặp bẫy: trở lại vị trí cũ và cộng gậy phạt."
                : "Bóng đã dừng. Bạn có thể đánh tiếp."),
        );
        await loadAfterAction();
      }
      shotResolvingRef.current = false;
      setWorking(false);
    },
    [
      activePlayerCount,
      channelId,
      clearResume,
      loadAfterAction,
    ],
  );

  const skipHole = useCallback(async () => {
    if (shotResolvingRef.current) return;
    shotResolvingRef.current = true;
    setWorking(true);
    const { error } = await supabase.rpc(
      "skip_minigolf_hole",
      { p_channel_id: channelId },
    );
    if (error) {
      setErrorMessage(error.message);
    } else {
      clearResume();
      setNoticeMessage(
        "Hết thời gian: màn được tính 12 gậy. Đang chờ cả phòng.",
      );
      await loadAfterAction();
    }
    shotResolvingRef.current = false;
    setWorking(false);
  }, [channelId, clearResume, loadAfterAction]);

  useEffect(() => {
    if (
      !match ||
      !currentPlayer ||
      match.status !== "playing" ||
      currentPlayer.hole_completed ||
      currentPlayer.player_status !== "playing"
    ) {
      return;
    }
    const timeoutKey = `${match.match_id}:${currentPlayer.current_hole}`;
    if (
      remainingSeconds <= 0 &&
      timeoutKeyRef.current !== timeoutKey
    ) {
      timeoutKeyRef.current = timeoutKey;
      void skipHole();
    }
  }, [currentPlayer, match, remainingSeconds, skipHole]);

  useEffect(() => {
    if (!match || !currentPlayer) return;
    const restoreKey =
      `${match.match_id}:${currentPlayer.current_hole}:` +
      currentPlayer.hole_strokes;
    if (restoredKeyRef.current === restoreKey) return;
    restoredKeyRef.current = restoreKey;
    const startX =
      (currentPlayer.ball_x ?? course.start.x / MINI_GOLF_2D_WIDTH) *
      MINI_GOLF_2D_WIDTH;
    const startY =
      (currentPlayer.ball_y ?? course.start.y / MINI_GOLF_2D_HEIGHT) *
      MINI_GOLF_2D_HEIGHT;
    let restored: BallState | null = null;
    try {
      const raw = window.sessionStorage.getItem(resumeStorageKey);
      if (raw) {
        const snapshot = JSON.parse(raw) as ResumeSnapshot;
        if (
          snapshot.version === 1 &&
          snapshot.matchId === match.match_id &&
          snapshot.hole === currentPlayer.current_hole &&
          snapshot.holeStrokes === currentPlayer.hole_strokes &&
          Date.now() - snapshot.savedAt < 120_000
        ) {
          restored = snapshot.ball;
        }
      }
    } catch {
      restored = null;
    }
    ballRef.current = restored ?? {
      x: startX,
      y: startY,
      vx: 0,
      vy: 0,
      moving: false,
      shotOriginX: startX,
      shotOriginY: startY,
      lastSafeX: startX,
      lastSafeY: startY,
      portalCooldownUntil: 0,
      cannonCooldownUntil: 0,
    };
    setBallMoving(Boolean(restored?.moving));
    if (restored?.moving) {
      shotStartedAtRef.current = performance.now();
    }
    setIsAiming(false);
    setAimStart(null);
    setAimPoint(null);
  }, [course, currentPlayer, match, resumeStorageKey]);

  useEffect(() => {
    if (!match || !currentPlayer) return;
    const save = () => {
      const ball = ballRef.current;
      if (!ball.moving) return;
      const snapshot: ResumeSnapshot = {
        version: 1,
        matchId: match.match_id,
        hole: currentPlayer.current_hole,
        holeStrokes: currentPlayer.hole_strokes,
        savedAt: Date.now(),
        ball: { ...ball },
      };
      try {
        window.sessionStorage.setItem(
          resumeStorageKey,
          JSON.stringify(snapshot),
        );
      } catch {
        // Không chặn game nếu storage bị vô hiệu hóa.
      }
    };
    const timer = window.setInterval(save, 200);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [currentPlayer, match, resumeStorageKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !match) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let animationFrame = 0;
    let lastFrameAt = performance.now();

    const render = (timeMs: number) => {
      const deltaSeconds = clamp(
        (timeMs - lastFrameAt) / 1000,
        0.001,
        0.04,
      );
      lastFrameAt = timeMs;
      const ball = ballRef.current;

      if (
        ball.moving &&
        match.status === "playing" &&
        currentPlayer?.player_status === "playing" &&
        !currentPlayer.hole_completed
      ) {
        const steps = Math.max(1, Math.ceil(deltaSeconds / 0.006));
        let result: "safe" | "hazard" = "safe";
        for (let step = 0; step < steps; step += 1) {
          result = updateBall(
            ball,
            course,
            deltaSeconds / steps,
            Date.now(),
          );
          if (result === "hazard") break;
        }
        const speed = Math.hypot(ball.vx, ball.vy);
        const holeDistance = distance(ball, course.hole);
        if (result === "hazard") {
          ball.x = ball.shotOriginX;
          ball.y = ball.shotOriginY;
          ball.lastSafeX = ball.x;
          ball.lastSafeY = ball.y;
          ball.vx = 0;
          ball.vy = 0;
          ball.moving = false;
          setBallMoving(false);
          void recordShot(
            ball.x,
            ball.y,
            false,
            true,
          );
        } else if (
          holeDistance < HOLE_RADIUS + 3 &&
          speed < 230
        ) {
          ball.x = course.hole.x;
          ball.y = course.hole.y;
          ball.vx = 0;
          ball.vy = 0;
          ball.moving = false;
          setBallMoving(false);
          void recordShot(
            ball.x,
            ball.y,
            true,
            false,
          );
        } else if (
          speed < 13 &&
          timeMs - shotStartedAtRef.current > 320
        ) {
          ball.vx = 0;
          ball.vy = 0;
          ball.moving = false;
          ball.lastSafeX = ball.x;
          ball.lastSafeY = ball.y;
          setBallMoving(false);
          void recordShot(
            ball.x,
            ball.y,
            false,
            false,
          );
        }
      }

      drawPixelBackground(context, course);
      drawZones(context, course, Date.now());
      drawWalls(context, course);
      drawMechanisms(context, course, Date.now());
      drawHole(context, course, Date.now());

      for (const player of players) {
        if (
          player.id === currentUserId ||
          player.player_status !== "playing" ||
          player.current_hole !== viewedHole ||
          player.hole_completed
        ) {
          continue;
        }
        drawBall(
          context,
          {
            x:
              (player.ball_x ??
                course.start.x / MINI_GOLF_2D_WIDTH) *
              MINI_GOLF_2D_WIDTH,
            y:
              (player.ball_y ??
                course.start.y / MINI_GOLF_2D_HEIGHT) *
              MINI_GOLF_2D_HEIGHT,
          },
          PLAYER_COLORS[player.seat_index % PLAYER_COLORS.length],
          player.username,
          false,
        );
      }

      if (
        currentPlayer &&
        !currentPlayer.hole_completed &&
        currentPlayer.player_status === "playing"
      ) {
        drawBall(
          context,
          ball,
          PLAYER_COLORS[
            currentPlayer.seat_index % PLAYER_COLORS.length
          ],
          "Bạn",
          true,
        );
      }

      if (isAiming && aimStart && aimPoint) {
        const directionX = aimStart.x - aimPoint.x;
        const directionY = aimStart.y - aimPoint.y;
        const drag = Math.hypot(directionX, directionY);
        const power = clamp(drag / MAX_DRAG_DISTANCE, 0, 1);
        const length = 55 + power * 105;
        const angle = Math.atan2(directionY, directionX);
        const color =
          power > 0.75
            ? "#ef4444"
            : power > 0.4
              ? "#facc15"
              : "#22c55e";
        context.save();
        context.translate(aimStart.x, aimStart.y);
        context.rotate(angle);
        context.strokeStyle = "rgba(2,6,23,0.85)";
        context.lineWidth = 12;
        context.beginPath();
        context.moveTo(18, 0);
        context.lineTo(length, 0);
        context.stroke();
        context.strokeStyle = color;
        context.lineWidth = 6;
        context.setLineDash([13, 8]);
        context.beginPath();
        context.moveTo(18, 0);
        context.lineTo(length, 0);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = color;
        context.beginPath();
        context.moveTo(length + 12, 0);
        context.lineTo(length - 5, -11);
        context.lineTo(length - 5, 11);
        context.closePath();
        context.fill();
        context.restore();
      }

      animationFrame = window.requestAnimationFrame(render);
    };
    animationFrame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    aimPoint,
    aimStart,
    course,
    currentPlayer,
    currentUserId,
    isAiming,
    match,
    players,
    recordShot,
    viewedHole,
  ]);

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x:
        ((event.clientX - bounds.left) / bounds.width) *
        MINI_GOLF_2D_WIDTH,
      y:
        ((event.clientY - bounds.top) / bounds.height) *
        MINI_GOLF_2D_HEIGHT,
    };
  }

  function beginAim(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!canControl || ballMoving || event.button !== 0) return;
    const point = canvasPoint(event);
    if (distance(point, ballRef.current) > BALL_RADIUS + 18) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsAiming(true);
    setAimStart({ x: ballRef.current.x, y: ballRef.current.y });
    setAimPoint(point);
    setNoticeMessage(
      "Kéo ngược hướng muốn đánh. Kéo càng xa, lực càng mạnh.",
    );
  }

  function moveAim(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isAiming) return;
    setAimPoint(canvasPoint(event));
  }

  function endAim(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isAiming || !aimStart) return;
    const point = canvasPoint(event);
    setIsAiming(false);
    setAimPoint(null);
    setAimStart(null);
    const directionX = aimStart.x - point.x;
    const directionY = aimStart.y - point.y;
    const drag = Math.hypot(directionX, directionY);
    if (drag < MIN_DRAG_DISTANCE) {
      setNoticeMessage("Lực quá nhẹ. Hãy kéo xa hơn một chút.");
      return;
    }
    const rawPower = clamp(drag / MAX_DRAG_DISTANCE, 0.03, 1);
    const responsivePower =
      rawPower * rawPower * (3 - 2 * rawPower);
    const speed = MAX_SHOT_SPEED * responsivePower;
    const ball = ballRef.current;
    ball.vx = (directionX / drag) * speed;
    ball.vy = (directionY / drag) * speed;
    ball.moving = true;
    ball.shotOriginX = ball.x;
    ball.shotOriginY = ball.y;
    ball.lastSafeX = ball.x;
    ball.lastSafeY = ball.y;
    shotStartedAtRef.current = performance.now();
    setBallMoving(true);
    setNoticeMessage(
      `Bóng đang lăn với lực ${Math.round(rawPower * 100)}%...`,
    );
  }

  const restartHole = useCallback(() => {
    if (!canControl || shotResolvingRef.current) return;
    const ball = ballRef.current;
    ball.x = course.start.x;
    ball.y = course.start.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.moving = false;
    ball.shotOriginX = course.start.x;
    ball.shotOriginY = course.start.y;
    setBallMoving(false);
    setIsAiming(false);
    setAimPoint(null);
    setAimStart(null);
    void recordShot(
      ball.x,
      ball.y,
      false,
      true,
      "⟳ Chơi lại màn: bóng về điểm xuất phát và cộng gậy phạt.",
    );
  }, [canControl, course.start.x, course.start.y, recordShot]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      restartHole();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [restartHole]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await surfaceRef.current?.requestFullscreen();
      }
    } catch {
      setErrorMessage(
        "Trình duyệt không thể chuyển chế độ toàn màn hình.",
      );
    }
  }

  const rankedPlayers = useMemo(
    () =>
      [...players].sort(
        (first, second) =>
          Number(first.rank_position) -
          Number(second.rank_position),
      ),
    [players],
  );
  const aimPower =
    isAiming && aimStart && aimPoint
      ? clamp(
          distance(aimStart, aimPoint) / MAX_DRAG_DISTANCE,
          0,
          1,
        )
      : 0;

  if (loading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center bg-gradient-to-br from-sky-950 to-indigo-950 text-cyan-100">
        Đang tải Mini Golf 2D...
      </div>
    );
  }

  if (!match) {
    return (
      <div className="relative flex min-h-[520px] items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#22c55e_0%,#0f766e_50%,#172554_100%)] p-8 text-center">
        <div className="relative z-10 max-w-xl rounded-3xl border-4 border-white/20 bg-black/35 p-8 shadow-2xl backdrop-blur">
          <div className="text-8xl">⛳</div>
          <h2 className="mt-4 text-4xl font-black">
            Mini Golf 2D
          </h2>
          <p className="mt-3 text-white/85">
            9 màn pixel 2D với gió, bumper, băng trơn, cổng
            dịch chuyển, pháo, cửa sập và nam châm.
          </p>
          <p className="mt-5 rounded-xl bg-black/30 p-3 text-sm">
            Vào ô chờ và sẵn sàng. Chủ phòng có thể chơi một
            mình hoặc bắt đầu khi mọi khách đã sẵn sàng.
          </p>
        </div>
      </div>
    );
  }

  if (match.status === "cancelled") {
    return (
      <div className="flex min-h-[520px] items-center justify-center bg-slate-950 p-8 text-center">
        <div>
          <div className="text-7xl">⏹️</div>
          <h2 className="mt-4 text-3xl font-black">
            Trận Mini Golf 2D đã dừng
          </h2>
          <p className="mt-3 text-gray-300">
            Phòng chờ đã mở lại cho trận tiếp theo.
          </p>
        </div>
      </div>
    );
  }

  if (match.status === "finished") {
    return (
      <div className="min-h-[520px] bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-950 p-5 sm:p-8">
        <div className="text-center">
          <div className="text-7xl">🏆</div>
          <h2 className="mt-3 text-3xl font-black">
            Kết quả Mini Golf 2D
          </h2>
          <p className="mt-2 text-sm text-gray-300">
            Hoàn thành 9 màn · Ít gậy nhất chiến thắng
          </p>
        </div>
        <div className="mx-auto mt-7 max-w-3xl space-y-2">
          {rankedPlayers.map((player, index) => (
            <div
              key={player.id}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/10 p-3"
            >
              <span className="w-10 text-center text-xl font-black">
                {index === 0
                  ? "🥇"
                  : index === 1
                    ? "🥈"
                    : index === 2
                      ? "🥉"
                      : `#${index + 1}`}
              </span>
              <span
                className="flex h-10 w-10 items-center justify-center rounded-lg font-black"
                style={{
                  backgroundColor:
                    PLAYER_COLORS[
                      player.seat_index % PLAYER_COLORS.length
                    ],
                }}
              >
                {playerInitial(player)}
              </span>
              <span className="min-w-0 flex-1 truncate font-black">
                {player.username}
              </span>
              <span className="font-black text-amber-300">
                {player.total_strokes} gậy
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={surfaceRef}
      className={`relative bg-[#111827] ${
        isFullscreen
          ? "flex h-screen w-screen flex-col justify-center"
          : ""
      }`}
    >
      {errorMessage && (
        <div className="border-b border-red-400/20 bg-red-500/15 px-4 py-2 text-sm font-bold text-red-200">
          {errorMessage}
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0f172a] px-4 py-3">
        <div>
          <h2 className="font-black">
            ⛳ {course.name}
            <span className="ml-2 text-sm text-cyan-300">
              · Màn {viewedHole}/{match.hole_count}
            </span>
          </h2>
          <p className="text-xs text-gray-400">
            {course.pack} · Par {course.par}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-black">
          <span className="rounded-lg bg-amber-500/15 px-3 py-2 text-amber-300">
            ⏱ {remainingSeconds}s
          </span>
          <span className="rounded-lg bg-white/10 px-3 py-2">
            {currentPlayer?.hole_strokes ?? 0}/{MAX_HOLE_STROKES} gậy
          </span>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="rounded-lg bg-white/10 px-3 py-2 hover:bg-white/15"
            aria-label={
              isFullscreen ? "Thu nhỏ game" : "Phóng to game"
            }
          >
            {isFullscreen ? "↙ Thu nhỏ" : "⛶"}
          </button>
        </div>
      </header>

      <div className="relative mx-auto w-full max-w-[1500px] overflow-hidden bg-black">
        <canvas
          ref={canvasRef}
          width={MINI_GOLF_2D_WIDTH}
          height={MINI_GOLF_2D_HEIGHT}
          onPointerDown={beginAim}
          onPointerMove={moveAim}
          onPointerUp={endAim}
          onPointerCancel={() => {
            setIsAiming(false);
            setAimPoint(null);
            setAimStart(null);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            restartHole();
          }}
          className="block aspect-[1000/560] w-full touch-none select-none [image-rendering:pixelated]"
          aria-label={`Mini Golf 2D, màn ${viewedHole}: ${course.name}`}
        />

        <aside className="pointer-events-none absolute right-3 top-3 w-44 overflow-hidden rounded-xl border border-white/15 bg-slate-950/60 text-xs shadow-xl backdrop-blur-sm sm:w-52">
          <div className="flex justify-between bg-white/10 px-3 py-2 font-black">
            <span>MÀN {viewedHole}</span>
            <span>SỐ GẬY</span>
          </div>
          <div className="max-h-40 overflow-hidden p-2">
            {players
              .filter(
                (player) =>
                  player.current_hole === viewedHole &&
                  player.player_status === "playing",
              )
              .slice(0, 8)
              .map((player) => (
                <div
                  key={player.id}
                  className="flex items-center gap-2 rounded-lg px-1 py-1.5"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black"
                    style={{
                      backgroundColor:
                        PLAYER_COLORS[
                          player.seat_index %
                            PLAYER_COLORS.length
                        ],
                    }}
                  >
                    {playerInitial(player)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {player.username}
                  </span>
                  <span className="font-black text-amber-300">
                    {player.hole_strokes}
                  </span>
                </div>
              ))}
          </div>
        </aside>

        {isAiming && (
          <div className="pointer-events-none absolute bottom-4 right-4 w-44 rounded-xl border border-white/15 bg-slate-950/80 p-3 shadow-xl backdrop-blur">
            <div className="flex justify-between text-[10px] font-black">
              <span>LỰC</span>
              <span>{Math.round(aimPower * 100)}%</span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500"
                style={{ width: `${aimPower * 100}%` }}
              />
            </div>
          </div>
        )}

        {currentPlayer?.hole_completed && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 p-5 backdrop-blur-[2px]">
            <div className="max-w-md rounded-2xl border border-cyan-300/30 bg-slate-950/90 p-6 text-center shadow-2xl">
              <div className="text-5xl">⛳</div>
              <h3 className="mt-2 text-xl font-black text-cyan-300">
                Bạn đã hoàn thành màn {viewedHole}
              </h3>
              <p className="mt-2 text-sm text-gray-300">
                Cả phòng sẽ sang màn tiếp theo khi mọi người đã
                hoàn thành.
              </p>
            </div>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#0f172a] px-4 py-3 text-xs">
        <p className="text-gray-300">{noticeMessage}</p>
        <button
          type="button"
          onClick={restartHole}
          disabled={!canControl}
          className="rounded-lg bg-white/10 px-3 py-2 font-black disabled:opacity-40"
        >
          ⟳ Chơi lại · Chuột phải / Space
        </button>
      </footer>
    </div>
  );
}
