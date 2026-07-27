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
  MINI_GOLF_COURSES,
  type MiniGolfCourse,
  type MiniGolfRect,
} from "./mini-golf-courses";

const supabase = createClient();
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 560;
const BALL_RADIUS = 0.014;
const HOLE_SECONDS = 60;
const MAX_HOLE_STROKES = 12;

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
  lastSafeX: number;
  lastSafeY: number;
};

type AimPoint = {
  x: number;
  y: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
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
  ball.x += ball.vx * deltaSeconds;
  ball.y += ball.vy * deltaSeconds;

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
  const friction = inSand ? 0.9 : 0.975;
  const frictionByTime = Math.pow(friction, deltaSeconds * 60);
  ball.vx *= frictionByTime;
  ball.vy *= frictionByTime;
}

function themeColors(course: MiniGolfCourse) {
  switch (course.theme) {
    case "coast":
      return {
        sky: "#38bdf8",
        green: "#22c55e",
        darkGreen: "#15803d",
        border: "#d6d3d1",
      };
    case "desert":
      return {
        sky: "#f59e0b",
        green: "#84cc16",
        darkGreen: "#4d7c0f",
        border: "#a16207",
      };
    case "night":
      return {
        sky: "#312e81",
        green: "#059669",
        darkGreen: "#065f46",
        border: "#67e8f9",
      };
    default:
      return {
        sky: "#166534",
        green: "#22c55e",
        darkGreen: "#15803d",
        border: "#92400e",
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
) {
  const pixelX = x * CANVAS_WIDTH;
  const pixelY = y * CANVAS_HEIGHT;
  const radius = emphasized ? 13 : 10;

  context.save();
  context.shadowColor = "rgba(0,0,0,0.45)";
  context.shadowBlur = 10;
  context.shadowOffsetY = 5;
  context.beginPath();
  context.arc(pixelX, pixelY + 3, radius, 0, Math.PI * 2);
  context.fillStyle = "rgba(0,0,0,0.3)";
  context.fill();

  const gradient = context.createRadialGradient(
    pixelX - 4,
    pixelY - 5,
    2,
    pixelX,
    pixelY,
    radius,
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.22, color);
  gradient.addColorStop(1, "#111827");
  context.beginPath();
  context.arc(pixelX, pixelY, radius, 0, Math.PI * 2);
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = emphasized ? "#ffffff" : color;
  context.lineWidth = emphasized ? 3 : 2;
  context.stroke();
  context.restore();

  context.font = emphasized
    ? "bold 13px system-ui"
    : "bold 11px system-ui";
  context.textAlign = "center";
  context.fillStyle = "#ffffff";
  context.strokeStyle = "rgba(0,0,0,0.75)";
  context.lineWidth = 3;
  context.strokeText(label, pixelX, pixelY - radius - 8);
  context.fillText(label, pixelX, pixelY - radius - 8);
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
    lastSafeX: MINI_GOLF_COURSES[0].start.x,
    lastSafeY: MINI_GOLF_COURSES[0].start.y,
  });
  const shotResolvingRef = useRef(false);
  const shotStartedAtRef = useRef(0);
  const timeoutSubmittedRef = useRef("");
  const [match, setMatch] = useState<MiniGolfMatch | null>(
    null,
  );
  const [players, setPlayers] = useState<MiniGolfPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [isAiming, setIsAiming] = useState(false);
  const [aimPoint, setAimPoint] = useState<AimPoint | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState(
    "Giữ chuột vào bóng, kéo ngược hướng muốn đánh rồi thả.",
  );

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

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
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

  useEffect(() => {
    if (!currentPlayer || ballRef.current.moving || working) {
      return;
    }

    const nextX = currentPlayer.ball_x ?? course.start.x;
    const nextY = currentPlayer.ball_y ?? course.start.y;
    ballRef.current = {
      x: nextX,
      y: nextY,
      vx: 0,
      vy: 0,
      moving: false,
      lastSafeX: nextX,
      lastSafeY: nextY,
    };
  }, [
    course.start.x,
    course.start.y,
    currentPlayer,
    working,
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
        setErrorMessage("");
        setNoticeMessage(
          holed
            ? "⛳ Vào lỗ! Đang chuyển sang màn tiếp theo."
            : penalty
              ? "💦 Bóng xuống nước: cộng một gậy phạt."
              : "Bóng đã dừng. Bạn có thể đánh tiếp.",
        );
        await loadAfterAction();
      }

      shotResolvingRef.current = false;
      setWorking(false);
    },
    [channelId, loadAfterAction],
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
      setNoticeMessage(
        "Hết thời gian: hố được tính 12 gậy.",
      );
      await loadAfterAction();
    }
    setWorking(false);
  }, [channelId, loadAfterAction]);

  useEffect(() => {
    if (
      !match ||
      match.status !== "playing" ||
      !currentPlayer ||
      currentPlayer.player_status !== "playing" ||
      remainingSeconds > 0 ||
      working ||
      ballRef.current.moving
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
    ) => {
      const colors = themeColors(currentCourse);
      const background = context.createLinearGradient(
        0,
        0,
        0,
        CANVAS_HEIGHT,
      );
      background.addColorStop(0, colors.sky);
      background.addColorStop(1, "#082f49");
      context.fillStyle = background;
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      context.save();
      context.shadowColor = "rgba(0,0,0,0.5)";
      context.shadowBlur = 22;
      context.fillStyle = colors.green;
      drawRoundedRect(context, 32, 22, 936, 516, 28);
      context.restore();

      context.save();
      context.beginPath();
      context.roundRect(32, 22, 936, 516, 28);
      context.clip();
      for (let stripe = 0; stripe < 12; stripe += 1) {
        context.fillStyle =
          stripe % 2 === 0
            ? "rgba(255,255,255,0.055)"
            : "rgba(0,0,0,0.035)";
        context.fillRect(
          32 + stripe * 78,
          22,
          78,
          516,
        );
      }
      context.restore();

      context.strokeStyle = colors.border;
      context.lineWidth = 12;
      context.beginPath();
      context.roundRect(32, 22, 936, 516, 28);
      context.stroke();

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
        waterGradient.addColorStop(0, "#38bdf8");
        waterGradient.addColorStop(1, "#0369a1");
        context.fillStyle = waterGradient;
        drawRoundedRect(context, x, y, width, height, 16);
        context.strokeStyle = "rgba(255,255,255,0.3)";
        context.lineWidth = 2;
        for (let waveY = y + 12; waveY < y + height; waveY += 18) {
          context.beginPath();
          for (
            let waveX = x + 6;
            waveX < x + width - 6;
            waveX += 20
          ) {
            context.moveTo(waveX, waveY);
            context.quadraticCurveTo(
              waveX + 5,
              waveY - 4,
              waveX + 10,
              waveY,
            );
          }
          context.stroke();
        }
      }

      for (const sand of currentCourse.sand) {
        const x = sand.x * CANVAS_WIDTH;
        const y = sand.y * CANVAS_HEIGHT;
        const width = sand.width * CANVAS_WIDTH;
        const height = sand.height * CANVAS_HEIGHT;
        context.fillStyle = "#facc6b";
        drawRoundedRect(context, x, y, width, height, 20);
        context.fillStyle = "rgba(146,64,14,0.22)";
        for (let dotX = x + 10; dotX < x + width; dotX += 18) {
          for (
            let dotY = y + 10;
            dotY < y + height;
            dotY += 17
          ) {
            context.beginPath();
            context.arc(dotX, dotY, 1.6, 0, Math.PI * 2);
            context.fill();
          }
        }
      }

      context.fillStyle = "#374151";
      context.strokeStyle = "#9ca3af";
      context.lineWidth = 3;
      for (const obstacle of currentCourse.obstacles) {
        const x = obstacle.x * CANVAS_WIDTH;
        const y = obstacle.y * CANVAS_HEIGHT;
        const width = obstacle.width * CANVAS_WIDTH;
        const height = obstacle.height * CANVAS_HEIGHT;
        drawRoundedRect(context, x, y, width, height, 7);
        context.strokeRect(x, y, width, height);
      }

      for (const obstacle of currentCourse.roundObstacles) {
        context.beginPath();
        context.arc(
          obstacle.x * CANVAS_WIDTH,
          obstacle.y * CANVAS_HEIGHT,
          obstacle.radius * CANVAS_WIDTH,
          0,
          Math.PI * 2,
        );
        context.fillStyle = "#4b5563";
        context.fill();
        context.strokeStyle = "#9ca3af";
        context.lineWidth = 4;
        context.stroke();
      }

      const holeX = currentCourse.hole.x * CANVAS_WIDTH;
      const holeY = currentCourse.hole.y * CANVAS_HEIGHT;
      context.beginPath();
      context.ellipse(
        holeX,
        holeY,
        17,
        10,
        0,
        0,
        Math.PI * 2,
      );
      context.fillStyle = "#030712";
      context.fill();
      context.strokeStyle = "rgba(255,255,255,0.6)";
      context.lineWidth = 2;
      context.stroke();
      context.strokeStyle = "#f8fafc";
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(holeX, holeY);
      context.lineTo(holeX, holeY - 86);
      context.stroke();
      context.fillStyle = "#ef4444";
      context.beginPath();
      context.moveTo(holeX + 2, holeY - 86);
      context.lineTo(holeX + 55, holeY - 67);
      context.lineTo(holeX + 2, holeY - 50);
      context.closePath();
      context.fill();

      context.beginPath();
      context.arc(
        currentCourse.start.x * CANVAS_WIDTH,
        currentCourse.start.y * CANVAS_HEIGHT,
        19,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = "rgba(255,255,255,0.45)";
      context.lineWidth = 3;
      context.setLineDash([6, 6]);
      context.stroke();
      context.setLineDash([]);
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

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
          void recordShot(ball.x, ball.y, false, true);
        } else if (distanceToHole < 20 && speed < 175) {
          ball.x = course.hole.x;
          ball.y = course.hole.y;
          ball.vx = 0;
          ball.vy = 0;
          ball.moving = false;
          void recordShot(ball.x, ball.y, true, false);
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

      drawCourse(context, course);

      const sameHolePlayers = players.filter(
        (player) =>
          player.id !== currentUserId &&
          player.player_status === "playing" &&
          player.current_hole === viewedHole,
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
        currentPlayer.current_hole === viewedHole
      ) {
        drawPlayerBall(
          context,
          ball.x,
          ball.y,
          PLAYER_COLORS[
            currentPlayer.seat_index % PLAYER_COLORS.length
          ],
          "Bạn",
          true,
        );

        if (isAiming && aimPoint && !ball.moving) {
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
          const power = clamp(dragDistance / 180, 0, 1);
          const unitX =
            dragDistance > 0 ? directionX / dragDistance : 0;
          const unitY =
            dragDistance > 0 ? directionY / dragDistance : 0;

          context.strokeStyle =
            power > 0.75
              ? "#ef4444"
              : power > 0.4
                ? "#facc15"
                : "#ffffff";
          context.lineWidth = 6;
          context.setLineDash([13, 9]);
          context.beginPath();
          context.moveTo(ballX, ballY);
          context.lineTo(
            ballX + unitX * (90 + power * 150),
            ballY + unitY * (90 + power * 150),
          );
          context.stroke();
          context.setLineDash([]);

          context.fillStyle = "rgba(3,7,18,0.8)";
          drawRoundedRect(context, 370, 505, 260, 32, 16);
          const powerGradient = context.createLinearGradient(
            382,
            0,
            618,
            0,
          );
          powerGradient.addColorStop(0, "#22c55e");
          powerGradient.addColorStop(0.55, "#facc15");
          powerGradient.addColorStop(1, "#ef4444");
          context.fillStyle = powerGradient;
          drawRoundedRect(
            context,
            382,
            513,
            236 * power,
            16,
            8,
          );
          context.fillStyle = "#ffffff";
          context.font = "bold 13px system-ui";
          context.textAlign = "center";
          context.fillText(
            `${Math.round(power * 100)}%`,
            500,
            498,
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

  function pointerPosition(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(
        (event.clientX - bounds.left) / bounds.width,
        0,
        1,
      ),
      y: clamp(
        (event.clientY - bounds.top) / bounds.height,
        0,
        1,
      ),
    };
  }

  function beginAim(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    if (
      working ||
      match?.status !== "playing" ||
      currentPlayer?.player_status !== "playing" ||
      ballRef.current.moving ||
      remainingSeconds <= 0
    ) {
      return;
    }

    const point = pointerPosition(event);
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

    event.currentTarget.setPointerCapture(event.pointerId);
    setIsAiming(true);
    setAimPoint(point);
    setNoticeMessage("Kéo xa hơn để tăng lực, thả tay để đánh.");
  }

  function moveAim(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    if (!isAiming) return;
    setAimPoint(pointerPosition(event));
  }

  function releaseAim(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    if (!isAiming || !aimPoint) return;
    setIsAiming(false);
    event.currentTarget.releasePointerCapture(event.pointerId);

    const ball = ballRef.current;
    const ballX = ball.x * CANVAS_WIDTH;
    const ballY = ball.y * CANVAS_HEIGHT;
    const aimX = aimPoint.x * CANVAS_WIDTH;
    const aimY = aimPoint.y * CANVAS_HEIGHT;
    const directionX = ballX - aimX;
    const directionY = ballY - aimY;
    const dragDistance = Math.hypot(directionX, directionY);
    setAimPoint(null);

    if (dragDistance < 12) {
      setNoticeMessage("Lực quá nhẹ. Hãy kéo xa hơn một chút.");
      return;
    }

    const power = clamp(dragDistance / 180, 0.08, 1);
    const pixelSpeed = 780 * power;
    ball.vx =
      (directionX / dragDistance) *
      (pixelSpeed / CANVAS_WIDTH);
    ball.vy =
      (directionY / dragDistance) *
      (pixelSpeed / CANVAS_HEIGHT);
    ball.moving = true;
    ball.lastSafeX = ball.x;
    ball.lastSafeY = ball.y;
    shotStartedAtRef.current = performance.now();
    setNoticeMessage("Bóng đang lăn...");
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
            Vào một ô chờ, bấm Sẵn sàng và chờ chủ phòng
            bấm “Bắt đầu trò chơi”.
          </div>
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
              <span
                className={`rounded-xl px-3 py-2 text-sm font-black ${
                  remainingSeconds <= 10
                    ? "bg-red-500 text-white"
                    : "bg-white/10 text-amber-300"
                }`}
              >
                ⏱ {remainingSeconds}s
              </span>
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
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onPointerDown={beginAim}
          onPointerMove={moveAim}
          onPointerUp={releaseAim}
          onPointerCancel={() => {
            setIsAiming(false);
            setAimPoint(null);
          }}
          className={`block aspect-[25/14] w-full touch-none ${
            currentPlayer?.player_status === "playing" &&
            !working
              ? "cursor-crosshair"
              : "cursor-default"
          }`}
          aria-label={`Sân Mini Golf hố ${viewedHole}: ${course.name}`}
        />
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
                      : `Hố ${player.current_hole} · ${player.total_strokes} gậy`}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
