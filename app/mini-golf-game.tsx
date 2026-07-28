"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";
import MiniGolf3DView from "./mini-golf-3d-view";
import {
  getMiniGolfTerrainGradient,
  MINI_GOLF_COURSES,
  type MiniGolfCourse,
  type MiniGolfPoint,
  type MiniGolfRect,
} from "./mini-golf-courses";

const supabase = createClient();
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 560;
const BALL_RADIUS = 0.014;
const HOLE_SECONDS = 120;
const MAX_HOLE_STROKES = 12;
const MAX_DRAG_DISTANCE = 86;
const MIN_DRAG_DISTANCE = 5;
const MAX_SHOT_SPEED = 1750;

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

type MiniGolfMatch = {
  match_id: string;
  status: "playing" | "finished" | "cancelled";
  hole_count: number;
  course_seed: number;
  started_at: string;
  finished_at: string | null;
};

type MiniGolfPlayer = {
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

type BallMotion = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
  rotation: number;
  sinking: boolean;
  sinkStartedAt: number;
  lastSafeX: number;
  lastSafeY: number;
};

type BallResumeSnapshot = {
  version: 1;
  matchId: string;
  hole: number;
  holeStrokes: number;
  savedAt: number;
  shotElapsedMs: number;
  sinkElapsedMs: number;
  ball: Omit<BallMotion, "sinkStartedAt">;
};

type AimPoint = MiniGolfPoint;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function seededNoise(index: number, seed: number) {
  const value =
    Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value);
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

function pixelDistance(
  firstX: number,
  firstY: number,
  secondX: number,
  secondY: number,
) {
  return Math.hypot(
    (firstX - secondX) * CANVAS_WIDTH,
    (firstY - secondY) * CANVAS_HEIGHT,
  );
}

function ballPixelSpeed(ball: BallMotion) {
  return Math.hypot(
    ball.vx * CANVAS_WIDTH,
    ball.vy * CANVAS_HEIGHT,
  );
}

function bounceVelocity(
  ball: BallMotion,
  normalX: number,
  normalY: number,
  energy = 0.78,
) {
  const dot = ball.vx * normalX + ball.vy * normalY;
  if (dot >= 0) return;
  ball.vx = (ball.vx - 2 * dot * normalX) * energy;
  ball.vy = (ball.vy - 2 * dot * normalY) * energy;
}

function collideWithRect(
  ball: BallMotion,
  rect: MiniGolfRect,
) {
  const nearestX = clamp(ball.x, rect.x, rect.x + rect.width);
  const nearestY = clamp(ball.y, rect.y, rect.y + rect.height);
  let differenceX = ball.x - nearestX;
  let differenceY = ball.y - nearestY;
  let distance = Math.hypot(differenceX, differenceY);

  if (distance >= BALL_RADIUS) return;

  if (distance < 0.0001) {
    const distances = [
      { value: Math.abs(ball.x - rect.x), x: -1, y: 0 },
      {
        value: Math.abs(rect.x + rect.width - ball.x),
        x: 1,
        y: 0,
      },
      { value: Math.abs(ball.y - rect.y), x: 0, y: -1 },
      {
        value: Math.abs(rect.y + rect.height - ball.y),
        x: 0,
        y: 1,
      },
    ].sort((first, second) => first.value - second.value);

    differenceX = distances[0].x;
    differenceY = distances[0].y;
    distance = 1;
  }

  const normalX = differenceX / distance;
  const normalY = differenceY / distance;
  const penetration = BALL_RADIUS - distance;
  ball.x += normalX * penetration;
  ball.y += normalY * penetration;
  bounceVelocity(ball, normalX, normalY);
}

function updateBallPhysics(
  ball: BallMotion,
  course: MiniGolfCourse,
  deltaSeconds: number,
) {
  const startedInSand = course.sand.some((rect) =>
    pointInRect(ball.x, ball.y, rect),
  );
  const terrainGradient = getMiniGolfTerrainGradient(
    { x: ball.x, y: ball.y },
    course,
  );
  const slopeAcceleration = startedInSand ? 0.013 : 0.028;
  ball.vx -=
    terrainGradient.x * slopeAcceleration * deltaSeconds;
  ball.vy -=
    terrainGradient.y * slopeAcceleration * deltaSeconds;

  const speedBeforeMove = ballPixelSpeed(ball);
  ball.x += ball.vx * deltaSeconds;
  ball.y += ball.vy * deltaSeconds;
  ball.rotation +=
    (speedBeforeMove * deltaSeconds) /
    (BALL_RADIUS * CANVAS_WIDTH);

  const minimumX = 0.04 + BALL_RADIUS;
  const maximumX = 0.96 - BALL_RADIUS;
  const minimumY = 0.04 + BALL_RADIUS;
  const maximumY = 0.96 - BALL_RADIUS;

  if (ball.x < minimumX) {
    ball.x = minimumX;
    bounceVelocity(ball, 1, 0);
  } else if (ball.x > maximumX) {
    ball.x = maximumX;
    bounceVelocity(ball, -1, 0);
  }

  if (ball.y < minimumY) {
    ball.y = minimumY;
    bounceVelocity(ball, 0, 1);
  } else if (ball.y > maximumY) {
    ball.y = maximumY;
    bounceVelocity(ball, 0, -1);
  }

  for (const obstacle of course.obstacles) {
    collideWithRect(ball, obstacle);
  }

  for (const obstacle of course.roundObstacles) {
    const differenceX = ball.x - obstacle.x;
    const differenceY = ball.y - obstacle.y;
    const distance = Math.hypot(differenceX, differenceY);
    const minimumDistance = BALL_RADIUS + obstacle.radius;

    if (distance > 0.0001 && distance < minimumDistance) {
      const normalX = differenceX / distance;
      const normalY = differenceY / distance;
      const penetration = minimumDistance - distance;
      ball.x += normalX * penetration;
      ball.y += normalY * penetration;
      bounceVelocity(ball, normalX, normalY);
    }
  }

  const inSand = course.sand.some((rect) =>
    pointInRect(ball.x, ball.y, rect),
  );
  const friction = inSand ? 0.91 : 0.98;
  const frictionByTime = Math.pow(friction, deltaSeconds * 60);
  ball.vx *= frictionByTime;
  ball.vy *= frictionByTime;
}

function themeColors(course: MiniGolfCourse) {
  switch (course.theme) {
    case "coast":
      return {
        skyTop: "#38bdf8",
        skyBottom: "#075985",
        glow: "#a5f3fc",
        green: "#22c55e",
        lightGreen: "#6ee7a2",
        darkGreen: "#15803d",
        border: "#f8fafc",
        borderShadow: "#155e75",
        accent: "#facc15",
      };
    case "desert":
      return {
        skyTop: "#fbbf24",
        skyBottom: "#c2410c",
        glow: "#fef3c7",
        green: "#84cc16",
        lightGreen: "#bef264",
        darkGreen: "#4d7c0f",
        border: "#fde68a",
        borderShadow: "#78350f",
        accent: "#fb923c",
      };
    case "night":
      return {
        skyTop: "#312e81",
        skyBottom: "#020617",
        glow: "#67e8f9",
        green: "#059669",
        lightGreen: "#34d399",
        darkGreen: "#065f46",
        border: "#67e8f9",
        borderShadow: "#312e81",
        accent: "#c084fc",
      };
    default:
      return {
        skyTop: "#0ea5e9",
        skyBottom: "#14532d",
        glow: "#bbf7d0",
        green: "#22c55e",
        lightGreen: "#86efac",
        darkGreen: "#15803d",
        border: "#d6a760",
        borderShadow: "#713f12",
        accent: "#facc15",
      };
  }
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

function drawPlayerBall(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
  emphasized: boolean,
  rotation = 0,
  scale = 1,
  alpha = 1,
) {
  const pixelX = x * CANVAS_WIDTH;
  const pixelY = y * CANVAS_HEIGHT;
  const radius = (emphasized ? 13 : 10) * scale;

  context.save();
  context.globalAlpha = alpha;
  if (emphasized) {
    context.beginPath();
    context.arc(pixelX, pixelY, radius + 10, 0, Math.PI * 2);
    const aura = context.createRadialGradient(
      pixelX,
      pixelY,
      radius,
      pixelX,
      pixelY,
      radius + 12,
    );
    aura.addColorStop(0, `${color}aa`);
    aura.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = aura;
    context.fill();
  }

  context.shadowColor = "rgba(0,0,0,0.55)";
  context.shadowBlur = emphasized ? 13 : 8;
  context.shadowOffsetY = Math.max(2, 5 * scale);
  context.beginPath();
  context.ellipse(
    pixelX,
    pixelY + radius * 0.72,
    radius * 0.95,
    radius * 0.38,
    0,
    0,
    Math.PI * 2,
  );
  context.fillStyle = "rgba(0,0,0,0.38)";
  context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;

  const gradient = context.createRadialGradient(
    pixelX - radius * 0.38,
    pixelY - radius * 0.42,
    Math.max(1, radius * 0.06),
    pixelX,
    pixelY,
    radius,
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.16, "#f8fafc");
  gradient.addColorStop(0.43, color);
  gradient.addColorStop(0.78, color);
  gradient.addColorStop(1, "#0f172a");
  context.beginPath();
  context.arc(pixelX, pixelY, radius, 0, Math.PI * 2);
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = emphasized
    ? "rgba(255,255,255,0.92)"
    : "rgba(255,255,255,0.7)";
  context.lineWidth = Math.max(1, (emphasized ? 2.5 : 1.5) * scale);
  context.stroke();

  context.save();
  context.beginPath();
  context.arc(pixelX, pixelY, radius * 0.9, 0, Math.PI * 2);
  context.clip();
  context.translate(pixelX, pixelY);
  context.rotate(rotation);
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const ring = index % 2 === 0 ? 0.48 : 0.72;
    const dimpleX = Math.cos(angle) * radius * ring;
    const dimpleY = Math.sin(angle) * radius * ring * 0.68;
    context.beginPath();
    context.arc(
      dimpleX,
      dimpleY,
      Math.max(0.7, radius * 0.075),
      0,
      Math.PI * 2,
    );
    context.fillStyle = "rgba(15,23,42,0.28)";
    context.fill();
    context.beginPath();
    context.arc(
      dimpleX - radius * 0.025,
      dimpleY - radius * 0.025,
      Math.max(0.35, radius * 0.035),
      0,
      Math.PI * 2,
    );
    context.fillStyle = "rgba(255,255,255,0.42)";
    context.fill();
  }
  context.strokeStyle = "rgba(255,255,255,0.62)";
  context.lineWidth = Math.max(0.7, scale);
  context.beginPath();
  context.arc(0, 0, radius * 0.58, -0.9, 1.25);
  context.stroke();
  context.restore();

  const highlight = context.createRadialGradient(
    pixelX - radius * 0.36,
    pixelY - radius * 0.4,
    0,
    pixelX - radius * 0.36,
    pixelY - radius * 0.4,
    radius * 0.42,
  );
  highlight.addColorStop(0, "rgba(255,255,255,0.95)");
  highlight.addColorStop(1, "rgba(255,255,255,0)");
  context.beginPath();
  context.arc(pixelX, pixelY, radius, 0, Math.PI * 2);
  context.fillStyle = highlight;
  context.fill();
  context.restore();

  if (scale < 0.55 || alpha < 0.45) return;
  context.save();
  context.globalAlpha = alpha;
  context.font = emphasized
    ? "bold 13px system-ui"
    : "bold 11px system-ui";
  context.textAlign = "center";
  context.fillStyle = "#ffffff";
  context.strokeStyle = "rgba(0,0,0,0.75)";
  context.lineWidth = 3;
  context.strokeText(label, pixelX, pixelY - radius - 8);
  context.fillText(label, pixelX, pixelY - radius - 8);
  context.restore();
}

export default function MiniGolfGame({
  channelId,
  currentUserId,
  onMatchChange,
}: {
  channelId: string;
  currentUserId: string;
  onMatchChange?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameSurfaceRef = useRef<HTMLDivElement | null>(null);
  const ballRef = useRef<BallMotion>({
    x: MINI_GOLF_COURSES[0].start.x,
    y: MINI_GOLF_COURSES[0].start.y,
    vx: 0,
    vy: 0,
    moving: false,
    rotation: 0,
    sinking: false,
    sinkStartedAt: 0,
    lastSafeX: MINI_GOLF_COURSES[0].start.x,
    lastSafeY: MINI_GOLF_COURSES[0].start.y,
  });
  const shotResolvingRef = useRef(false);
  const shotStartedAtRef = useRef(0);
  const timeoutSubmittedRef = useRef("");
  const restoredMotionKeyRef = useRef("");
  const [match, setMatch] = useState<MiniGolfMatch | null>(
    null,
  );
  const [players, setPlayers] = useState<MiniGolfPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [ballIsSinking, setBallIsSinking] = useState(false);
  const [isAiming, setIsAiming] = useState(false);
  const [aimOrigin, setAimOrigin] = useState<AimPoint | null>(
    null,
  );
  const [aimPoint, setAimPoint] = useState<AimPoint | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState(
    "Giữ chuột vào bóng, kéo ngược hướng muốn đánh rồi thả.",
  );
  const [
    dismissedWaitingOverlayKey,
    setDismissedWaitingOverlayKey,
  ] = useState<string | null>(null);
  const resumeStorageKey =
    `talkcunglamdz:minigolf:${channelId}:${currentUserId}`;

  const clearResumeSnapshot = useCallback(() => {
    try {
      window.sessionStorage.removeItem(resumeStorageKey);
    } catch {
      // Trinh duyet co the chan storage; du lieu tren server van duoc giu.
    }
  }, [resumeStorageKey]);

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

    const nextMatch =
      ((matchRows ?? []) as MiniGolfMatch[])[0] ?? null;
    const nextPlayers =
      (playerRows ?? []) as MiniGolfPlayer[];

    setMatch(nextMatch);
    setPlayers(nextPlayers);
    setErrorMessage("");
    setLoading(false);
  }, [channelId]);

  useEffect(() => {
    const initialTimer = window.setTimeout(
      () => void loadMatch(),
      0,
    );
    const realtime = supabase
      .channel(`mini-golf-ui-${channelId}`)
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
    const refreshTimer = window.setInterval(
      () => void loadMatch(),
      5_000,
    );
    const handlePageShow = () => {
      void loadMatch();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadMatch();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      void supabase.removeChannel(realtime);
    };
  }, [channelId, loadMatch, onMatchChange]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Date.now()),
      250,
    );
    return () => window.clearInterval(timer);
  }, []);

  const currentPlayer = useMemo(
    () =>
      players.find((player) => player.id === currentUserId) ??
      null,
    [currentUserId, players],
  );
  const activePlayers = useMemo(
    () =>
      players.filter(
        (player) => player.player_status === "playing",
      ),
    [players],
  );
  const activePlayerCount = activePlayers.length;
  const waitingForPlayers = activePlayers.filter(
    (player) => !player.hole_completed,
  );
  const currentPlayerWaiting = Boolean(
    currentPlayer?.player_status === "playing" &&
      currentPlayer.hole_completed,
  );

  const viewedHole = useMemo(() => {
    if (
      currentPlayer &&
      currentPlayer.player_status === "playing"
    ) {
      return currentPlayer.current_hole;
    }
    return (
      players.find(
        (player) => player.player_status === "playing",
      )?.current_hole ?? 1
    );
  }, [currentPlayer, players]);

  const course =
    MINI_GOLF_COURSES[
      clamp(viewedHole - 1, 0, MINI_GOLF_COURSES.length - 1)
    ];
  const waitingOverlayKey =
    currentPlayerWaiting && match
      ? `${match.match_id}:${viewedHole}`
      : null;
  const showWaitingOverlay =
    currentPlayerWaiting &&
    waitingOverlayKey !== dismissedWaitingOverlayKey;

  useEffect(() => {
    if (
      !currentPlayer ||
      ballRef.current.moving ||
      ballRef.current.sinking ||
      working
    ) {
      return;
    }

    const motionKey = match
      ? `${match.match_id}:${currentPlayer.current_hole}:${currentPlayer.hole_strokes}`
      : "";

    if (
      match?.status === "playing" &&
      restoredMotionKeyRef.current !== motionKey
    ) {
      restoredMotionKeyRef.current = motionKey;

      try {
        const rawSnapshot =
          window.sessionStorage.getItem(resumeStorageKey);
        const snapshot = rawSnapshot
          ? (JSON.parse(rawSnapshot) as BallResumeSnapshot)
          : null;
        const snapshotAge = snapshot
          ? Date.now() - snapshot.savedAt
          : Number.POSITIVE_INFINITY;
        const snapshotBall = snapshot?.ball;
        const validBall = Boolean(
          snapshotBall &&
            Number.isFinite(snapshotBall.x) &&
            Number.isFinite(snapshotBall.y) &&
            Number.isFinite(snapshotBall.vx) &&
            Number.isFinite(snapshotBall.vy) &&
            Number.isFinite(snapshotBall.lastSafeX) &&
            Number.isFinite(snapshotBall.lastSafeY),
        );

        if (
          snapshot?.version === 1 &&
          snapshot.matchId === match.match_id &&
          snapshot.hole === currentPlayer.current_hole &&
          snapshot.holeStrokes === currentPlayer.hole_strokes &&
          snapshotAge >= 0 &&
          snapshotAge <= 30_000 &&
          validBall &&
          snapshotBall &&
          (snapshotBall.moving || snapshotBall.sinking)
        ) {
          const restoredNow = performance.now();
          ballRef.current = {
            ...snapshotBall,
            sinkStartedAt: snapshotBall.sinking
              ? restoredNow -
                Math.max(
                  0,
                  snapshot.sinkElapsedMs + snapshotAge,
                )
              : 0,
          };
          shotStartedAtRef.current =
            restoredNow -
            Math.max(
              0,
              snapshot.shotElapsedMs + snapshotAge,
            );
          window.setTimeout(() => {
            setBallIsSinking(snapshotBall.sinking);
            setNoticeMessage(
              "Đã khôi phục cú đánh đang dở sau khi tải lại trang.",
            );
          }, 0);
          return;
        }

        if (rawSnapshot) {
          window.sessionStorage.removeItem(resumeStorageKey);
        }
      } catch {
        clearResumeSnapshot();
      }
    }

    const nextX = currentPlayer.ball_x ?? course.start.x;
    const nextY = currentPlayer.ball_y ?? course.start.y;
    ballRef.current = {
      x: nextX,
      y: nextY,
      vx: 0,
      vy: 0,
      moving: false,
      rotation: 0,
      sinking: false,
      sinkStartedAt: 0,
      lastSafeX: nextX,
      lastSafeY: nextY,
    };
    setBallIsSinking(false);
  }, [
    course.start.x,
    course.start.y,
    clearResumeSnapshot,
    currentPlayer,
    match,
    resumeStorageKey,
    working,
  ]);

  useEffect(() => {
    if (
      match?.status !== "playing" ||
      !currentPlayer ||
      currentPlayer.player_status !== "playing" ||
      currentPlayer.hole_completed
    ) {
      clearResumeSnapshot();
      return;
    }

    const saveMovingBall = () => {
      const ball = ballRef.current;
      if (!ball.moving && !ball.sinking) return;

      const currentTime = performance.now();
      const snapshot: BallResumeSnapshot = {
        version: 1,
        matchId: match.match_id,
        hole: currentPlayer.current_hole,
        holeStrokes: currentPlayer.hole_strokes,
        savedAt: Date.now(),
        shotElapsedMs: Math.max(
          0,
          currentTime - shotStartedAtRef.current,
        ),
        sinkElapsedMs: ball.sinking
          ? Math.max(0, currentTime - ball.sinkStartedAt)
          : 0,
        ball: {
          x: ball.x,
          y: ball.y,
          vx: ball.vx,
          vy: ball.vy,
          moving: ball.moving,
          rotation: ball.rotation,
          sinking: ball.sinking,
          lastSafeX: ball.lastSafeX,
          lastSafeY: ball.lastSafeY,
        },
      };

      try {
        window.sessionStorage.setItem(
          resumeStorageKey,
          JSON.stringify(snapshot),
        );
      } catch {
        // Neu storage bi chan, trang van khoi phuc tu du lieu Supabase.
      }
    };

    const snapshotTimer = window.setInterval(
      saveMovingBall,
      200,
    );
    window.addEventListener("pagehide", saveMovingBall);

    return () => {
      window.clearInterval(snapshotTimer);
      window.removeEventListener("pagehide", saveMovingBall);
    };
  }, [
    clearResumeSnapshot,
    currentPlayer,
    match,
    resumeStorageKey,
  ]);

  const remainingSeconds = currentPlayer
    ? clamp(
        HOLE_SECONDS -
          Math.floor(
            (now -
              new Date(
                currentPlayer.hole_started_at,
              ).getTime()) /
              1000,
          ),
        0,
        HOLE_SECONDS,
      )
    : HOLE_SECONDS;

  const loadAfterAction = useCallback(async () => {
    await loadMatch();
    onMatchChange?.();
  }, [loadMatch, onMatchChange]);

  const recordShot = useCallback(
    async (
      ballX: number,
      ballY: number,
      holed: boolean,
      penalty: boolean,
    ) => {
      if (shotResolvingRef.current) return;
      shotResolvingRef.current = true;
      setWorking(true);

      const { error } = await supabase.rpc(
        "record_minigolf_shot",
        {
          p_channel_id: channelId,
          p_ball_x: clamp(ballX, 0, 1),
          p_ball_y: clamp(ballY, 0, 1),
          p_holed: holed,
          p_penalty: penalty,
        },
      );

      if (error) {
        setErrorMessage(error.message);
        setNoticeMessage("Không thể lưu cú đánh. Hãy thử lại.");
      } else {
        clearResumeSnapshot();
        setErrorMessage("");
        setNoticeMessage(
          holed
            ? activePlayerCount <= 1
              ? "⛳ Vào lỗ! Đang mở hố tiếp theo."
              : "⛳ Đã vào lỗ! Hãy chờ mọi người hoàn thành hố này."
            : penalty
              ? "💦 Bóng xuống nước: cộng một gậy phạt."
              : "Bóng đã dừng. Bạn có thể đánh tiếp.",
        );
        await loadAfterAction();
      }

      shotResolvingRef.current = false;
      setWorking(false);
    },
    [
      activePlayerCount,
      channelId,
      clearResumeSnapshot,
      loadAfterAction,
    ],
  );

  const skipHole = useCallback(async () => {
    setWorking(true);
    const { error } = await supabase.rpc(
      "skip_minigolf_hole",
      { p_channel_id: channelId },
    );

    if (error) {
      setErrorMessage(error.message);
    } else {
      clearResumeSnapshot();
      setNoticeMessage(
        activePlayerCount <= 1
          ? "Hết thời gian: hố được tính 12 gậy. Đang mở hố tiếp theo."
          : "Hết thời gian: hố được tính 12 gậy. Đang chờ mọi người.",
      );
      await loadAfterAction();
    }
    setWorking(false);
  }, [
    activePlayerCount,
    channelId,
    clearResumeSnapshot,
    loadAfterAction,
  ]);

  useEffect(() => {
    if (
      !match ||
      match.status !== "playing" ||
      !currentPlayer ||
      currentPlayer.player_status !== "playing" ||
      currentPlayer.hole_completed ||
      remainingSeconds > 0 ||
      working ||
      ballRef.current.moving ||
      ballRef.current.sinking
    ) {
      return;
    }

    const timeoutKey = `${match.match_id}:${currentPlayer.current_hole}`;
    if (timeoutSubmittedRef.current === timeoutKey) return;
    timeoutSubmittedRef.current = timeoutKey;
    void skipHole();
  }, [
    currentPlayer,
    match,
    remainingSeconds,
    skipHole,
    working,
  ]);

  const drawCourse = useCallback(
    (
      context: CanvasRenderingContext2D,
      currentCourse: MiniGolfCourse,
      time: number,
    ) => {
      const colors = themeColors(currentCourse);
      const background = context.createLinearGradient(
        0,
        0,
        0,
        CANVAS_HEIGHT,
      );
      background.addColorStop(0, colors.skyTop);
      background.addColorStop(0.62, colors.skyBottom);
      background.addColorStop(1, "#020617");
      context.fillStyle = background;
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const ambientGlow = context.createRadialGradient(
        820,
        32,
        6,
        820,
        32,
        250,
      );
      ambientGlow.addColorStop(0, `${colors.glow}cc`);
      ambientGlow.addColorStop(0.25, `${colors.glow}44`);
      ambientGlow.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = ambientGlow;
      context.fillRect(500, 0, 500, 300);

      context.save();
      context.globalAlpha = currentCourse.theme === "night" ? 0.7 : 0.2;
      context.fillStyle = colors.glow;
      for (let index = 0; index < 26; index += 1) {
        const starX = 24 + ((index * 149) % 950);
        const starY = 12 + ((index * 67) % 190);
        const twinkle =
          1.2 + Math.sin(time / 500 + index * 1.7) * 0.8;
        context.beginPath();
        context.arc(starX, starY, twinkle, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();

      context.save();
      context.globalAlpha = 0.28;
      context.fillStyle = colors.darkGreen;
      context.beginPath();
      context.moveTo(0, 235);
      for (let x = 0; x <= CANVAS_WIDTH; x += 65) {
        context.quadraticCurveTo(
          x + 32,
          160 + ((x / 65) % 3) * 22,
          x + 65,
          235,
        );
      }
      context.lineTo(CANVAS_WIDTH, 330);
      context.lineTo(0, 330);
      context.closePath();
      context.fill();
      context.restore();

      context.save();
      context.shadowColor = "rgba(0,0,0,0.72)";
      context.shadowBlur = 32;
      context.shadowOffsetY = 14;
      const turf = context.createLinearGradient(
        0,
        22,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
      );
      turf.addColorStop(0, colors.lightGreen);
      turf.addColorStop(0.42, colors.green);
      turf.addColorStop(1, colors.darkGreen);
      context.fillStyle = turf;
      drawRoundedRect(context, 32, 22, 936, 516, 28);
      context.restore();

      context.save();
      context.beginPath();
      context.roundRect(32, 22, 936, 516, 28);
      context.clip();

      for (let stripe = -2; stripe < 16; stripe += 1) {
        context.fillStyle =
          stripe % 2 === 0
            ? "rgba(255,255,255,0.07)"
            : "rgba(0,0,0,0.055)";
        context.save();
        context.translate(500, 280);
        context.rotate(-0.06);
        context.fillRect(
          -600 + stripe * 78,
          -330,
          78,
          660,
        );
        context.restore();
      }

      for (let index = 0; index < 90; index += 1) {
        const patchX =
          42 +
          seededNoise(index, currentCourse.id * 3.1) * 916;
        const patchY =
          34 +
          seededNoise(index, currentCourse.id * 5.7) * 492;
        const patchRadius =
          9 + seededNoise(index, currentCourse.id * 8.3) * 25;
        const patch = context.createRadialGradient(
          patchX,
          patchY,
          0,
          patchX,
          patchY,
          patchRadius,
        );
        patch.addColorStop(
          0,
          index % 3 === 0
            ? "rgba(255,255,210,0.065)"
            : "rgba(3,70,35,0.09)",
        );
        patch.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = patch;
        context.fillRect(
          patchX - patchRadius,
          patchY - patchRadius,
          patchRadius * 2,
          patchRadius * 2,
        );
      }

      context.lineCap = "round";
      for (let index = 0; index < 620; index += 1) {
        const bladeX =
          39 +
          seededNoise(index, currentCourse.id * 11.1) * 922;
        const bladeY =
          31 +
          seededNoise(index, currentCourse.id * 13.7) * 500;
        const bladeLength =
          2.5 +
          seededNoise(index, currentCourse.id * 17.3) * 5.5;
        const bladeLean =
          (seededNoise(index, currentCourse.id * 19.9) - 0.5) *
          3.5;
        context.strokeStyle =
          index % 4 === 0
            ? "rgba(220,252,231,0.2)"
            : index % 3 === 0
              ? "rgba(6,78,59,0.22)"
              : "rgba(187,247,208,0.13)";
        context.lineWidth =
          index % 7 === 0 ? 1.25 : 0.75;
        context.beginPath();
        context.moveTo(bladeX, bladeY);
        context.quadraticCurveTo(
          bladeX + bladeLean * 0.45,
          bladeY - bladeLength * 0.55,
          bladeX + bladeLean,
          bladeY - bladeLength,
        );
        context.stroke();
      }

      for (let index = 0; index < 34; index += 1) {
        const dewX =
          44 +
          seededNoise(index, currentCourse.id * 23.4) * 912;
        const dewY =
          36 +
          seededNoise(index, currentCourse.id * 27.8) * 486;
        const shimmer =
          0.18 +
          ((Math.sin(time / 420 + index * 1.9) + 1) / 2) *
            0.42;
        context.fillStyle = `rgba(240,253,250,${shimmer})`;
        context.beginPath();
        context.arc(dewX, dewY, 0.8, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();

      context.save();
      context.strokeStyle = colors.borderShadow;
      context.lineWidth = 22;
      context.beginPath();
      context.roundRect(32, 22, 936, 516, 28);
      context.stroke();
      context.strokeStyle = colors.border;
      context.lineWidth = 12;
      context.beginPath();
      context.roundRect(32, 22, 936, 516, 28);
      context.stroke();
      context.strokeStyle = "rgba(255,255,255,0.55)";
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(38, 28, 924, 504, 22);
      context.stroke();

      context.globalAlpha = 0.26;
      context.lineWidth = 1.2;
      for (let index = 0; index < 30; index += 1) {
        const grainX = 56 + index * 30.2;
        const grainLength = 9 + (index % 5) * 4;
        context.strokeStyle =
          index % 2 === 0
            ? "rgba(255,255,255,0.8)"
            : "rgba(71,35,10,0.9)";
        context.beginPath();
        context.moveTo(grainX, 18 + (index % 3));
        context.quadraticCurveTo(
          grainX + grainLength * 0.5,
          13 + (index % 4),
          grainX + grainLength,
          18 + ((index + 1) % 3),
        );
        context.stroke();
        context.beginPath();
        context.moveTo(grainX, 542 - (index % 3));
        context.quadraticCurveTo(
          grainX + grainLength * 0.5,
          548 - (index % 4),
          grainX + grainLength,
          542 - ((index + 1) % 3),
        );
        context.stroke();
      }
      context.restore();

      for (const water of currentCourse.water) {
        const x = water.x * CANVAS_WIDTH;
        const y = water.y * CANVAS_HEIGHT;
        const width = water.width * CANVAS_WIDTH;
        const height = water.height * CANVAS_HEIGHT;
        const waterGradient = context.createLinearGradient(
          x,
          y,
          x,
          y + height,
        );
        waterGradient.addColorStop(0, "#a5f3fc");
        waterGradient.addColorStop(0.16, "#38bdf8");
        waterGradient.addColorStop(0.58, "#0284c7");
        waterGradient.addColorStop(1, "#082f49");
        context.save();
        context.shadowColor = "rgba(3,105,161,0.78)";
        context.shadowBlur = 20;
        context.shadowOffsetY = 5;
        context.fillStyle = waterGradient;
        drawRoundedRect(context, x, y, width, height, 16);
        context.restore();

        context.save();
        context.beginPath();
        context.roundRect(x, y, width, height, 16);
        context.clip();

        const waterLight = context.createRadialGradient(
          x + width * 0.25,
          y + height * 0.08,
          0,
          x + width * 0.25,
          y + height * 0.08,
          Math.max(width, height) * 0.9,
        );
        waterLight.addColorStop(0, "rgba(255,255,255,0.28)");
        waterLight.addColorStop(0.45, "rgba(125,211,252,0.08)");
        waterLight.addColorStop(1, "rgba(2,44,71,0.28)");
        context.fillStyle = waterLight;
        context.fillRect(x, y, width, height);

        context.strokeStyle = "rgba(224,242,254,0.48)";
        context.lineWidth = 1.6;
        const waveOffset = (time / 70) % 20;
        for (let waveY = y + 12; waveY < y + height; waveY += 19) {
          context.beginPath();
          for (
            let waveX = x - 12 + waveOffset;
            waveX < x + width - 6;
            waveX += 20
          ) {
            context.moveTo(waveX, waveY);
            context.quadraticCurveTo(
              waveX + 5,
              waveY - 3.5,
              waveX + 10,
              waveY,
            );
          }
          context.stroke();
        }

        context.globalCompositeOperation = "screen";
        context.strokeStyle = "rgba(165,243,252,0.2)";
        context.lineWidth = 4;
        for (let index = 0; index < 7; index += 1) {
          const rippleX =
            x +
            seededNoise(index, currentCourse.id * 33.2) *
              width;
          const rippleY =
            y +
            seededNoise(index, currentCourse.id * 37.6) *
              height;
          const ripple =
            8 +
            ((time / 38 + index * 17) %
              Math.max(20, Math.min(width, height) * 0.7));
          context.beginPath();
          context.ellipse(
            rippleX,
            rippleY,
            ripple,
            ripple * 0.32,
            0,
            0,
            Math.PI * 2,
          );
          context.stroke();
        }
        context.restore();

        context.strokeStyle = "rgba(224,242,254,0.8)";
        context.lineWidth = 3;
        context.beginPath();
        context.roundRect(x + 1, y + 1, width - 2, height - 2, 15);
        context.stroke();
        context.strokeStyle = "rgba(3,105,161,0.75)";
        context.lineWidth = 5;
        context.beginPath();
        context.roundRect(x - 2, y - 2, width + 4, height + 4, 18);
        context.stroke();
      }

      for (const sand of currentCourse.sand) {
        const x = sand.x * CANVAS_WIDTH;
        const y = sand.y * CANVAS_HEIGHT;
        const width = sand.width * CANVAS_WIDTH;
        const height = sand.height * CANVAS_HEIGHT;
        const sandGradient = context.createLinearGradient(
          x,
          y,
          x,
          y + height,
        );
        sandGradient.addColorStop(0, "#fff7d6");
        sandGradient.addColorStop(0.34, "#f8d88a");
        sandGradient.addColorStop(0.72, "#e7ac46");
        sandGradient.addColorStop(1, "#b96f20");
        context.save();
        context.shadowColor = "rgba(120,53,15,0.4)";
        context.shadowBlur = 10;
        context.fillStyle = sandGradient;
        drawRoundedRect(context, x, y, width, height, 20);
        context.restore();
        context.strokeStyle = "rgba(146,64,14,0.48)";
        context.lineWidth = 3;
        context.beginPath();
        context.roundRect(x, y, width, height, 20);
        context.stroke();
        context.save();
        context.beginPath();
        context.roundRect(x, y, width, height, 20);
        context.clip();
        for (let index = 0; index < 140; index += 1) {
          const grainX =
            x +
            seededNoise(index, currentCourse.id * 41.3) * width;
          const grainY =
            y +
            seededNoise(index, currentCourse.id * 47.9) * height;
          const grainRadius =
            0.45 +
            seededNoise(index, currentCourse.id * 51.1) * 1.25;
          context.fillStyle =
            index % 4 === 0
              ? "rgba(255,255,255,0.4)"
              : index % 3 === 0
                ? "rgba(120,53,15,0.3)"
                : "rgba(180,83,9,0.2)";
          context.beginPath();
          context.arc(
            grainX,
            grainY,
            grainRadius,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
        context.strokeStyle = "rgba(146,64,14,0.2)";
        context.lineWidth = 2;
        for (
          let rakeY = y + 12;
          rakeY < y + height;
          rakeY += 11
        ) {
          context.beginPath();
          context.moveTo(x - 4, rakeY);
          context.bezierCurveTo(
            x + width * 0.3,
            rakeY - 5,
            x + width * 0.65,
            rakeY + 5,
            x + width + 4,
            rakeY,
          );
          context.stroke();
        }
        context.restore();
      }

      for (const obstacle of currentCourse.obstacles) {
        const x = obstacle.x * CANVAS_WIDTH;
        const y = obstacle.y * CANVAS_HEIGHT;
        const width = obstacle.width * CANVAS_WIDTH;
        const height = obstacle.height * CANVAS_HEIGHT;
        const wallGradient = context.createLinearGradient(
          x,
          y,
          x + width,
          y + height,
        );
        wallGradient.addColorStop(0, "#cbd5e1");
        wallGradient.addColorStop(0.18, "#64748b");
        wallGradient.addColorStop(0.72, "#334155");
        wallGradient.addColorStop(1, "#0f172a");
        context.save();
        context.shadowColor = "rgba(0,0,0,0.55)";
        context.shadowBlur = 12;
        context.shadowOffsetY = 6;
        context.fillStyle = wallGradient;
        drawRoundedRect(context, x, y, width, height, 7);
        context.restore();
        context.strokeStyle = "rgba(226,232,240,0.72)";
        context.lineWidth = 3;
        context.beginPath();
        context.roundRect(x, y, width, height, 7);
        context.stroke();
        context.strokeStyle = "rgba(255,255,255,0.45)";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x + 5, y + 5);
        context.lineTo(x + width - 5, y + 5);
        context.stroke();
        const rivetCount = Math.max(
          2,
          Math.floor(Math.max(width, height) / 34),
        );
        for (let index = 0; index < rivetCount; index += 1) {
          const fraction = (index + 0.5) / rivetCount;
          const rivetX =
            width >= height ? x + width * fraction : x + width / 2;
          const rivetY =
            width >= height ? y + height / 2 : y + height * fraction;
          const rivet = context.createRadialGradient(
            rivetX - 1,
            rivetY - 1,
            0,
            rivetX,
            rivetY,
            4,
          );
          rivet.addColorStop(0, "#f8fafc");
          rivet.addColorStop(0.45, "#94a3b8");
          rivet.addColorStop(1, "#0f172a");
          context.fillStyle = rivet;
          context.beginPath();
          context.arc(rivetX, rivetY, 3.2, 0, Math.PI * 2);
          context.fill();
        }
        context.strokeStyle = "rgba(34,197,94,0.38)";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x + 4, y + height - 3);
        context.lineTo(x + width - 4, y + height - 3);
        context.stroke();
      }

      for (const obstacle of currentCourse.roundObstacles) {
        const centerX = obstacle.x * CANVAS_WIDTH;
        const centerY = obstacle.y * CANVAS_HEIGHT;
        const radius = obstacle.radius * CANVAS_WIDTH;
        const rockGradient = context.createRadialGradient(
          centerX - radius * 0.35,
          centerY - radius * 0.4,
          radius * 0.08,
          centerX,
          centerY,
          radius,
        );
        rockGradient.addColorStop(0, "#e2e8f0");
        rockGradient.addColorStop(0.28, "#64748b");
        rockGradient.addColorStop(1, "#0f172a");
        context.save();
        context.shadowColor = "rgba(0,0,0,0.65)";
        context.shadowBlur = 15;
        context.shadowOffsetY = 7;
        context.beginPath();
        context.arc(
          centerX,
          centerY,
          radius,
          0,
          Math.PI * 2,
        );
        context.fillStyle = rockGradient;
        context.fill();
        context.restore();
        context.strokeStyle = "#94a3b8";
        context.lineWidth = 4;
        context.stroke();
        context.beginPath();
        context.arc(
          centerX - radius * 0.27,
          centerY - radius * 0.3,
          Math.max(2, radius * 0.12),
          0,
          Math.PI * 2,
        );
        context.fillStyle = "rgba(255,255,255,0.42)";
        context.fill();
        context.strokeStyle = "rgba(15,23,42,0.5)";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(centerX - radius * 0.1, centerY - radius * 0.8);
        context.lineTo(centerX + radius * 0.05, centerY - radius * 0.25);
        context.lineTo(centerX - radius * 0.2, centerY + radius * 0.25);
        context.stroke();
        context.strokeStyle = "rgba(74,222,128,0.4)";
        context.lineWidth = 2.5;
        context.beginPath();
        context.arc(
          centerX,
          centerY,
          radius * 0.86,
          0.2,
          2.5,
        );
        context.stroke();
      }

      const holeX = currentCourse.hole.x * CANVAS_WIDTH;
      const holeY = currentCourse.hole.y * CANVAS_HEIGHT;
      const pulse = 1 + Math.sin(time / 360) * 0.08;
      context.save();
      const flagShadow = context.createLinearGradient(
        holeX,
        holeY,
        holeX - 130,
        holeY + 48,
      );
      flagShadow.addColorStop(0, "rgba(2,6,23,0.3)");
      flagShadow.addColorStop(1, "rgba(2,6,23,0)");
      context.strokeStyle = flagShadow;
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(holeX + 3, holeY + 4);
      context.lineTo(holeX - 122, holeY + 45);
      context.stroke();
      context.restore();

      context.save();
      context.beginPath();
      context.ellipse(
        holeX,
        holeY + 2,
        31 * pulse,
        18 * pulse,
        0,
        0,
        Math.PI * 2,
      );
      const holeGlow = context.createRadialGradient(
        holeX,
        holeY,
        5,
        holeX,
        holeY,
        34,
      );
      holeGlow.addColorStop(0, `${colors.accent}aa`);
      holeGlow.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = holeGlow;
      context.fill();
      context.restore();
      context.save();
      context.beginPath();
      context.ellipse(
        holeX,
        holeY + 3,
        22,
        13,
        0,
        0,
        Math.PI * 2,
      );
      context.fillStyle = "rgba(2,6,23,0.25)";
      context.fill();
      const cupRim = context.createRadialGradient(
        holeX - 4,
        holeY - 4,
        2,
        holeX,
        holeY,
        21,
      );
      cupRim.addColorStop(0, "#f8fafc");
      cupRim.addColorStop(0.48, "#d1d5db");
      cupRim.addColorStop(0.64, "#64748b");
      cupRim.addColorStop(1, "#111827");
      context.beginPath();
      context.ellipse(
        holeX,
        holeY,
        19,
        11,
        0,
        0,
        Math.PI * 2,
      );
      context.fillStyle = cupRim;
      context.fill();
      const cupDepth = context.createRadialGradient(
        holeX - 2,
        holeY - 3,
        1,
        holeX,
        holeY + 2,
        15,
      );
      cupDepth.addColorStop(0, "#334155");
      cupDepth.addColorStop(0.36, "#0f172a");
      cupDepth.addColorStop(1, "#000000");
      context.beginPath();
      context.ellipse(
        holeX,
        holeY + 1,
        14.5,
        8,
        0,
        0,
        Math.PI * 2,
      );
      context.fillStyle = cupDepth;
      context.fill();
      context.strokeStyle = `${colors.accent}cc`;
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(
        holeX,
        holeY,
        19,
        11,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.restore();
      const poleGradient = context.createLinearGradient(
        holeX - 3,
        0,
        holeX + 3,
        0,
      );
      poleGradient.addColorStop(0, "#64748b");
      poleGradient.addColorStop(0.45, "#ffffff");
      poleGradient.addColorStop(1, "#94a3b8");
      context.strokeStyle = poleGradient;
      context.lineWidth = 6;
      context.beginPath();
      context.moveTo(holeX, holeY);
      context.lineTo(holeX, holeY - 86);
      context.stroke();
      const flagWave = Math.sin(time / 230) * 6;
      const flagGradient = context.createLinearGradient(
        holeX,
        holeY - 86,
        holeX + 58,
        holeY - 50,
      );
      flagGradient.addColorStop(0, "#fb7185");
      flagGradient.addColorStop(0.6, "#ef4444");
      flagGradient.addColorStop(1, "#be123c");
      context.fillStyle = flagGradient;
      context.shadowColor = "rgba(0,0,0,0.45)";
      context.shadowBlur = 8;
      context.beginPath();
      context.moveTo(holeX + 2, holeY - 86);
      context.quadraticCurveTo(
        holeX + 30,
        holeY - 76 + flagWave,
        holeX + 58,
        holeY - 66,
      );
      context.lineTo(holeX + 2, holeY - 50);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = "#ffffff";
      context.font = "bold 14px system-ui";
      context.textAlign = "center";
      context.fillText(
        String(currentCourse.id),
        holeX + 22,
        holeY - 63,
      );

      const startX = currentCourse.start.x * CANVAS_WIDTH;
      const startY = currentCourse.start.y * CANVAS_HEIGHT;
      context.beginPath();
      context.arc(
        startX,
        startY,
        21 + Math.sin(time / 420) * 2,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = `${colors.glow}bb`;
      context.lineWidth = 3;
      context.setLineDash([6, 6]);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.arc(startX, startY, 27, 0, Math.PI * 2);
      context.strokeStyle = "rgba(255,255,255,0.14)";
      context.lineWidth = 2;
      context.stroke();
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const enableLegacyRenderer = false;

    let animationFrame = 0;
    let previousTime = performance.now();

    const render = (time: number) => {
      const deltaSeconds = clamp(
        (time - previousTime) / 1000,
        0,
        0.033,
      );
      previousTime = time;
      const ball = ballRef.current;
      const sinkProgress = ball.sinking
        ? clamp((time - ball.sinkStartedAt) / 720, 0, 1)
        : 0;

      if (
        ball.sinking &&
        sinkProgress >= 1 &&
        !shotResolvingRef.current
      ) {
        ball.sinking = false;
        setBallIsSinking(false);
        void recordShot(
          course.hole.x,
          course.hole.y,
          true,
          false,
        );
      }

      if (ball.moving && !shotResolvingRef.current) {
        updateBallPhysics(ball, course, deltaSeconds);

        const inWater = course.water.some((rect) =>
          pointInRect(ball.x, ball.y, rect),
        );
        const distanceToHole = pixelDistance(
          ball.x,
          ball.y,
          course.hole.x,
          course.hole.y,
        );
        const speed = ballPixelSpeed(ball);

        if (inWater) {
          ball.x = ball.lastSafeX;
          ball.y = ball.lastSafeY;
          ball.vx = 0;
          ball.vy = 0;
          ball.moving = false;
          setBallIsSinking(false);
          void recordShot(ball.x, ball.y, false, true);
        } else if (distanceToHole < 20 && speed < 175) {
          ball.x = course.hole.x;
          ball.y = course.hole.y;
          ball.vx = 0;
          ball.vy = 0;
          ball.moving = false;
          ball.sinking = true;
          ball.sinkStartedAt = time;
          setBallIsSinking(true);
          setNoticeMessage("⛳ Bóng đang rơi xuống lỗ...");
        } else {
          const inSand = course.sand.some((rect) =>
            pointInRect(ball.x, ball.y, rect),
          );
          if (!inSand) {
            ball.lastSafeX = ball.x;
            ball.lastSafeY = ball.y;
          }

          if (
            speed < 8 &&
            time - shotStartedAtRef.current > 300
          ) {
            ball.vx = 0;
            ball.vy = 0;
            ball.moving = false;
            void recordShot(ball.x, ball.y, false, false);
          }
        }
      }

      if (enableLegacyRenderer) {
        drawCourse(context, course, time);

      const sameHolePlayers = players.filter(
        (player) =>
          player.id !== currentUserId &&
          player.player_status === "playing" &&
          player.current_hole === viewedHole &&
          !player.hole_completed,
      );
      for (const player of sameHolePlayers) {
        drawPlayerBall(
          context,
          player.ball_x ?? course.start.x,
          player.ball_y ?? course.start.y,
          PLAYER_COLORS[
            player.seat_index % PLAYER_COLORS.length
          ],
          player.username.slice(0, 10),
          false,
        );
      }

      if (
        currentPlayer?.player_status === "playing" &&
        currentPlayer.current_hole === viewedHole &&
        !currentPlayer.hole_completed &&
        (!shotResolvingRef.current || ball.sinking)
      ) {
        if (ball.moving) {
          const speed = ballPixelSpeed(ball);
          const directionLength = Math.max(
            0.001,
            Math.hypot(ball.vx, ball.vy),
          );
          const directionX = ball.vx / directionLength;
          const directionY = ball.vy / directionLength;
          const trailStrength = clamp(speed / 850, 0.1, 0.75);
          context.save();
          for (let index = 3; index >= 1; index -= 1) {
            const trailX =
              ball.x * CANVAS_WIDTH -
              directionX * index * (7 + trailStrength * 9);
            const trailY =
              ball.y * CANVAS_HEIGHT -
              directionY * index * (7 + trailStrength * 9);
            context.beginPath();
            context.ellipse(
              trailX,
              trailY,
              7 - index * 1.1,
              3.5 - index * 0.45,
              Math.atan2(directionY, directionX),
              0,
              Math.PI * 2,
            );
            context.fillStyle = `rgba(255,255,255,${
              trailStrength * (0.22 - index * 0.035)
            })`;
            context.fill();
          }
          context.restore();
        }

        if (ball.sinking) {
          const rippleRadius = 18 + sinkProgress * 26;
          context.save();
          context.strokeStyle = `rgba(255,255,255,${
            0.65 * (1 - sinkProgress)
          })`;
          context.lineWidth = 3;
          context.beginPath();
          context.ellipse(
            course.hole.x * CANVAS_WIDTH,
            course.hole.y * CANVAS_HEIGHT,
            rippleRadius,
            rippleRadius * 0.5,
            0,
            0,
            Math.PI * 2,
          );
          context.stroke();
          context.restore();
        }

        drawPlayerBall(
          context,
          ball.x,
          ball.y + sinkProgress * 0.012,
          PLAYER_COLORS[
            currentPlayer.seat_index % PLAYER_COLORS.length
          ],
          "Bạn",
          true,
          ball.rotation,
          1 - sinkProgress * 0.82,
          1 - sinkProgress * 0.92,
        );

        if (
          isAiming &&
          aimPoint &&
          !ball.moving &&
          !ball.sinking &&
          !currentPlayer.hole_completed
        ) {
          const ballX = ball.x * CANVAS_WIDTH;
          const ballY = ball.y * CANVAS_HEIGHT;
          const aimX = aimPoint.x * CANVAS_WIDTH;
          const aimY = aimPoint.y * CANVAS_HEIGHT;
          const directionX = ballX - aimX;
          const directionY = ballY - aimY;
          const dragDistance = Math.hypot(
            directionX,
            directionY,
          );
          const power = clamp(
            dragDistance / MAX_DRAG_DISTANCE,
            0,
            1,
          );
          const unitX =
            dragDistance > 0 ? directionX / dragDistance : 0;
          const unitY =
            dragDistance > 0 ? directionY / dragDistance : 0;

          const aimColor =
            power > 0.75
              ? "#ef4444"
              : power > 0.4
                ? "#facc15"
                : "#ffffff";
          const guideLength = 115 + power * 190;
          const guideEndX = ballX + unitX * guideLength;
          const guideEndY = ballY + unitY * guideLength;

          context.save();
          context.shadowColor = aimColor;
          context.shadowBlur = 13;
          context.strokeStyle = aimColor;
          context.lineWidth = 7;
          context.setLineDash([16, 9]);
          context.beginPath();
          context.moveTo(ballX, ballY);
          context.lineTo(guideEndX, guideEndY);
          context.stroke();
          context.setLineDash([]);
          const sideX = -unitY;
          const sideY = unitX;
          context.fillStyle = aimColor;
          context.beginPath();
          context.moveTo(guideEndX, guideEndY);
          context.lineTo(
            guideEndX - unitX * 26 + sideX * 14,
            guideEndY - unitY * 26 + sideY * 14,
          );
          context.lineTo(
            guideEndX - unitX * 26 - sideX * 14,
            guideEndY - unitY * 26 - sideY * 14,
          );
          context.closePath();
          context.fill();
          context.restore();

          context.fillStyle = "rgba(3,7,18,0.9)";
          drawRoundedRect(context, 346, 492, 308, 52, 20);
          context.strokeStyle = "rgba(255,255,255,0.18)";
          context.lineWidth = 2;
          context.beginPath();
          context.roundRect(346, 492, 308, 52, 20);
          context.stroke();
          const powerGradient = context.createLinearGradient(
            362,
            0,
            638,
            0,
          );
          powerGradient.addColorStop(0, "#22c55e");
          powerGradient.addColorStop(0.55, "#facc15");
          powerGradient.addColorStop(1, "#ef4444");
          context.fillStyle = powerGradient;
          drawRoundedRect(
            context,
            362,
            514,
            276 * power,
            18,
            9,
          );
          context.fillStyle = "#ffffff";
          context.font = "bold 12px system-ui";
          context.textAlign = "center";
          context.fillText(
            `LỰC ${Math.round(power * 100)}%`,
            500,
            507,
          );
        }
      }

      context.fillStyle = "rgba(3,7,18,0.78)";
      drawRoundedRect(context, 18, 16, 220, 70, 16);
      context.fillStyle = "#ffffff";
      context.textAlign = "left";
      context.font = "bold 22px system-ui";
      context.fillText(
        `Hố ${viewedHole}/${match?.hole_count ?? 9}`,
        34,
        47,
      );
      context.font = "bold 14px system-ui";
      context.fillStyle = "#cbd5e1";
        context.fillText(
          `${course.name} · Par ${course.par}`,
          34,
          71,
        );
      }

      animationFrame = window.requestAnimationFrame(render);
    };

    animationFrame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    aimPoint,
    course,
    currentPlayer,
    currentUserId,
    drawCourse,
    isAiming,
    match?.hole_count,
    players,
    recordShot,
    viewedHole,
  ]);

  function beginAimAt(point: AimPoint) {
    if (
      working ||
      match?.status !== "playing" ||
      currentPlayer?.player_status !== "playing" ||
      currentPlayer.hole_completed ||
      ballRef.current.moving ||
      ballRef.current.sinking ||
      remainingSeconds <= 0
    ) {
      return;
    }

    if (
      pixelDistance(
        point.x,
        point.y,
        ballRef.current.x,
        ballRef.current.y,
      ) > 58
    ) {
      setNoticeMessage(
        "Hãy nhấn gần quả bóng rồi kéo ngược hướng muốn đánh.",
      );
      return;
    }

    setIsAiming(true);
    setAimOrigin({
      x: ballRef.current.x,
      y: ballRef.current.y,
    });
    setAimPoint(point);
    setNoticeMessage("Kéo xa hơn để tăng lực, thả tay để đánh.");
  }

  function moveAimAt(point: AimPoint) {
    if (!isAiming) return;
    setAimPoint(point);
  }

  function releaseAimAt(point: AimPoint) {
    if (!isAiming || !aimOrigin) return;
    setIsAiming(false);

    const ball = ballRef.current;
    const ballX = ball.x * CANVAS_WIDTH;
    const ballY = ball.y * CANVAS_HEIGHT;
    const aimX = point.x * CANVAS_WIDTH;
    const aimY = point.y * CANVAS_HEIGHT;
    const directionX = ballX - aimX;
    const directionY = ballY - aimY;
    const dragDistance = Math.hypot(directionX, directionY);
    setAimPoint(null);
    setAimOrigin(null);

    if (dragDistance < MIN_DRAG_DISTANCE) {
      setNoticeMessage("Lực quá nhẹ. Hãy kéo xa hơn một chút.");
      return;
    }

    const rawPower = clamp(
      dragDistance / MAX_DRAG_DISTANCE,
      0.03,
      1,
    );
    const responsivePower =
      rawPower * rawPower * (3 - 2 * rawPower);
    const pixelSpeed = MAX_SHOT_SPEED * responsivePower;
    ball.vx =
      (directionX / dragDistance) *
      (pixelSpeed / CANVAS_WIDTH);
    ball.vy =
      (directionY / dragDistance) *
      (pixelSpeed / CANVAS_HEIGHT);
    ball.moving = true;
    ball.sinking = false;
    setBallIsSinking(false);
    ball.lastSafeX = ball.x;
    ball.lastSafeY = ball.y;
    shotStartedAtRef.current = performance.now();
    setNoticeMessage(
      `Bóng đang lăn với lực ${Math.round(rawPower * 100)}%...`,
    );
  }

  function cancelAim() {
    setIsAiming(false);
    setAimOrigin(null);
    setAimPoint(null);
  }

  async function enterFullscreen() {
    if (!gameSurfaceRef.current) return;
    try {
      await gameSurfaceRef.current.requestFullscreen();
    } catch {
      setErrorMessage(
        "Trình duyệt không cho phép mở toàn màn hình.",
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

  const podiumPlayers = rankedPlayers
    .filter((player) => player.player_status === "finished")
    .slice(0, 3);
  const aimPower =
    aimOrigin && aimPoint
      ? clamp(
          Math.hypot(
            (aimOrigin.x - aimPoint.x) * CANVAS_WIDTH,
            (aimOrigin.y - aimPoint.y) * CANVAS_HEIGHT,
          ) / MAX_DRAG_DISTANCE,
          0,
          1,
        )
      : 0;
  const canControlBall = Boolean(
    match?.status === "playing" &&
      currentPlayer?.player_status === "playing" &&
      !currentPlayer.hole_completed &&
      !ballIsSinking &&
      !working &&
      remainingSeconds > 0,
  );

  if (loading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center bg-gradient-to-br from-emerald-700 to-cyan-950 text-emerald-100">
        Đang tải sân Mini Golf...
      </div>
    );
  }

  if (!match) {
    return (
      <div className="relative flex min-h-[520px] items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-400 via-green-700 to-cyan-950 p-8 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.55)_100%)]" />
        <div className="relative z-10 max-w-xl">
          <div className="text-8xl">⛳</div>
          <h2 className="mt-5 text-4xl font-black">
            Mini Golf 16 người
          </h2>
          <p className="mt-3 text-white/80">
            9 hố với nước, cát và chướng ngại vật. Ít gậy
            nhất sẽ chiến thắng và bước lên bục Top 1–2–3.
          </p>
          <div className="mt-6 rounded-2xl bg-black/30 p-4 text-sm font-semibold backdrop-blur-sm">
            Khách vào ô chờ và bấm Sẵn sàng. Chủ phòng có thể
            chơi một mình hoặc bấm “Bắt đầu trò chơi” khi các
            khách đã sẵn sàng.
          </div>
        </div>
      </div>
    );
  }

  if (match.status === "cancelled") {
    return (
      <div className="flex min-h-[520px] items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-8 text-center">
        <div className="max-w-xl rounded-3xl border border-white/10 bg-black/25 p-8 shadow-2xl backdrop-blur">
          <div className="text-7xl">⏹️</div>
          <h2 className="mt-4 text-3xl font-black">
            Trận đấu đã dừng
          </h2>
          <p className="mt-3 text-gray-300">
            Chủ phòng đã dừng ván Mini Golf. Phòng chờ đã mở
            lại; mọi người có thể sắp xếp đội hình và bắt đầu
            trận mới.
          </p>
        </div>
      </div>
    );
  }

  if (match.status === "finished") {
    return (
      <div className="min-h-[520px] bg-gradient-to-br from-slate-950 via-indigo-950 to-emerald-950 p-5 sm:p-8">
        <div className="text-center">
          <span className="text-6xl">🏆</span>
          <h2 className="mt-3 text-3xl font-black">
            Kết quả Mini Golf
          </h2>
          <p className="mt-2 text-sm text-gray-300">
            Hoàn thành 9 hố · Ít gậy nhất chiến thắng
          </p>
        </div>

        {podiumPlayers.length > 0 && (
          <div className="mx-auto mt-8 grid max-w-3xl grid-cols-3 items-end gap-3">
            {[podiumPlayers[1], podiumPlayers[0], podiumPlayers[2]].map(
              (player, podiumIndex) => {
                const place = [2, 1, 3][podiumIndex];
                if (!player) return <span key={place} />;
                return (
                  <div
                    key={player.id}
                    className={`rounded-t-2xl border border-white/10 bg-white/10 p-3 text-center backdrop-blur-sm ${
                      place === 1
                        ? "min-h-48 pb-8"
                        : place === 2
                          ? "min-h-40 pb-5"
                          : "min-h-32"
                    }`}
                  >
                    <div className="text-3xl">
                      {place === 1
                        ? "🥇"
                        : place === 2
                          ? "🥈"
                          : "🥉"}
                    </div>
                    {player.avatar_url ? (
                      <img
                        src={player.avatar_url}
                        alt={player.username}
                        className="mx-auto mt-2 h-12 w-12 rounded-full object-cover"
                      />
                    ) : (
                      <span className="mx-auto mt-2 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500 text-lg font-black">
                        {player.username.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <p className="mt-2 truncate text-sm font-black">
                      {player.username}
                    </p>
                    <p className="text-xl font-black text-amber-300">
                      {player.total_strokes} gậy
                    </p>
                  </div>
                );
              },
            )}
          </div>
        )}

        <div className="mx-auto mt-6 max-w-3xl space-y-2">
          {rankedPlayers.map((player) => (
            <div
              key={player.id}
              className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-black/25 px-4 py-3"
            >
              <span className="text-center font-black text-gray-300">
                {player.player_status === "dnf"
                  ? "—"
                  : `#${player.rank_position}`}
              </span>
              <span className="truncate font-bold">
                {player.username}
              </span>
              <span
                className={`font-black ${
                  player.player_status === "dnf"
                    ? "text-red-300"
                    : "text-emerald-300"
                }`}
              >
                {player.player_status === "dnf"
                  ? "Bỏ cuộc"
                  : `${player.total_strokes} gậy`}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={gameSurfaceRef}
      className="w-full min-w-0 overflow-hidden bg-[#111827] text-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0f172a] px-4 py-3">
        <div>
          <h2 className="font-black">
            ⛳ {course.name}
          </h2>
          <p className="text-xs text-gray-400">
            Hố {viewedHole}/{match.hole_count} · Par{" "}
            {course.par}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {currentPlayer?.player_status === "playing" && (
            <>
              {currentPlayerWaiting ? (
                <span className="rounded-xl bg-emerald-500/20 px-3 py-2 text-sm font-black text-emerald-300">
                  ✓ Đã vào lỗ · Chờ{" "}
                  {waitingForPlayers.length} người
                </span>
              ) : (
                <span
                  className={`rounded-xl px-3 py-2 text-sm font-black ${
                    remainingSeconds <= 10
                      ? "bg-red-500 text-white"
                      : "bg-white/10 text-amber-300"
                  }`}
                >
                  ⏱ {remainingSeconds}s
                </span>
              )}
              <span className="rounded-xl bg-white/10 px-3 py-2 text-sm font-black">
                {currentPlayer.hole_strokes}/
                {MAX_HOLE_STROKES} gậy
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => void enterFullscreen()}
            title="Toàn màn hình"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/15"
          >
            ⛶
          </button>
        </div>
      </div>

      {errorMessage && (
        <p className="bg-red-500/15 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </p>
      )}

      <div className="relative bg-black">
        <MiniGolf3DView
          course={course}
          viewedHole={viewedHole}
          players={players}
          currentPlayer={currentPlayer}
          ballRef={ballRef}
          isAiming={isAiming}
          aimOrigin={aimOrigin}
          aimPoint={aimPoint}
          interactive={canControlBall}
          maxDragDistance={MAX_DRAG_DISTANCE}
          onAimStart={beginAimAt}
          onAimMove={moveAimAt}
          onAimEnd={releaseAimAt}
          onAimCancel={cancelAim}
        />
        <canvas
          ref={canvasRef}
          width={1}
          height={1}
          className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
          aria-hidden="true"
        />
        {isAiming && aimOrigin && aimPoint && (
          <div className="pointer-events-none absolute bottom-3 right-3 z-20 w-36 rounded-xl border border-white/15 bg-slate-950/90 px-3 py-2 shadow-2xl backdrop-blur">
            <div className="mb-1 flex items-center justify-between text-[11px] font-black">
              <span className="text-gray-300">LỰC</span>
              <span
                className={
                  aimPower > 0.75
                    ? "text-red-400"
                    : aimPower > 0.4
                      ? "text-amber-300"
                      : "text-emerald-300"
                }
              >
                {Math.round(aimPower * 100)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-yellow-300 to-red-500 transition-[width] duration-75"
                style={{ width: `${aimPower * 100}%` }}
              />
            </div>
          </div>
        )}
        {!currentPlayer && (
          <div className="absolute inset-x-4 bottom-4 rounded-xl bg-black/75 px-4 py-3 text-center text-sm font-bold backdrop-blur">
            Bạn đang xem trận đấu. Chỉ những người có mặt trong
            phòng chờ lúc chủ phòng bấm bắt đầu mới được đánh.
          </div>
        )}
        {currentPlayer?.player_status === "finished" && (
          <div className="absolute inset-x-4 bottom-4 rounded-xl bg-emerald-950/90 px-4 py-3 text-center text-sm font-bold">
            Bạn đã hoàn thành 9 hố. Hãy chờ những người còn lại.
          </div>
        )}
        {showWaitingOverlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/25 p-5 backdrop-blur-[1px]">
            <div className="relative max-w-md rounded-3xl border border-emerald-300/25 bg-slate-950/88 px-6 py-5 text-center shadow-2xl">
              <button
                type="button"
                onClick={() =>
                  setDismissedWaitingOverlayKey(waitingOverlayKey)
                }
                aria-label="Đóng thông báo để xem người chơi khác"
                title="Đóng để xem người chơi khác"
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl font-black text-gray-200 transition hover:bg-white/20 hover:text-white"
              >
                ×
              </button>
              <div className="text-4xl">⛳</div>
              <p className="mt-2 text-xl font-black text-emerald-300">
                Bạn đã hoàn thành hố {viewedHole}
              </p>
              <p className="mt-2 text-sm text-gray-300">
                Cả phòng sẽ sang hố tiếp theo khi tất cả người
                chơi hoàn thành. Còn{" "}
                <strong>{waitingForPlayers.length}</strong> người
                đang đánh.
              </p>
              <div className="mt-4 flex justify-center -space-x-2">
                {waitingForPlayers.slice(0, 8).map((player) =>
                  player.avatar_url ? (
                    <img
                      key={player.id}
                      src={player.avatar_url}
                      alt={player.username}
                      title={player.username}
                      className="h-9 w-9 rounded-full border-2 border-slate-950 object-cover"
                    />
                  ) : (
                    <span
                      key={player.id}
                      title={player.username}
                      className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-950 bg-indigo-500 text-xs font-black"
                    >
                      {player.username.charAt(0).toUpperCase()}
                    </span>
                  ),
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  setDismissedWaitingOverlayKey(waitingOverlayKey)
                }
                className="mt-5 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-emerald-950 transition hover:bg-emerald-400"
              >
                Xem người chơi khác
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-white/10 bg-[#0f172a] px-4 py-3">
        <p className="text-center text-xs font-semibold text-gray-300">
          {working ? "Đang lưu kết quả..." : noticeMessage}
        </p>

        {currentPlayer && (
          <div className="mt-3 grid grid-cols-9 gap-1">
            {Array.from(
              { length: match.hole_count },
              (_, index) => {
                const score = currentPlayer.hole_scores[index];
                const active =
                  currentPlayer.player_status === "playing" &&
                  currentPlayer.current_hole === index + 1;
                return (
                  <div
                    key={index}
                    className={`rounded-lg border px-1 py-2 text-center ${
                      active
                        ? "border-amber-400 bg-amber-500/15"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <span className="block text-[9px] text-gray-500">
                      H{index + 1}
                    </span>
                    <span className="block text-xs font-black">
                      {score ?? (active ? currentPlayer.hole_strokes : "—")}
                    </span>
                  </div>
                );
              },
            )}
          </div>
        )}

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {rankedPlayers.map((player) => (
            <div
              key={player.id}
              className={`flex min-w-[150px] items-center gap-2 rounded-xl border p-2 ${
                player.id === currentUserId
                  ? "border-indigo-400 bg-indigo-500/15"
                  : "border-white/10 bg-white/5"
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-black">
                {player.avatar_url ? (
                  <img
                    src={player.avatar_url}
                    alt={player.username}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  player.username.charAt(0).toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-black">
                  {player.username}
                </span>
                <span className="block text-[9px] text-gray-400">
                  {player.player_status === "dnf"
                    ? "Bỏ cuộc"
                    : player.player_status === "finished"
                      ? `${player.total_strokes} gậy · Xong`
                      : player.hole_completed
                        ? `Hố ${player.current_hole} · Đã xong, đang chờ`
                        : `Hố ${player.current_hole} · Đang đánh · ${player.total_strokes} gậy`}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
