"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import MemberBadge, {
  formatPublicId,
} from "@/components/member-badge";
import { createClient } from "@/utils/supabase/client";
import ChannelVoiceRoom from "./channel-voice-room";

const supabase = createClient();

export type GameChannelSummary = {
  channel_id: string;
  game_key: string | null;
  game_name: string | null;
  game_icon: string | null;
  max_players: number | null;
  player_count: number;
  status: "waiting" | "playing";
};

type GameCatalogItem = {
  game_key: string;
  name: string;
  icon: string;
  description: string;
  max_players: number;
  category: string;
  sort_order: number;
};

type GamePlayer = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: "admin" | "moderator" | "member";
  is_ready: boolean;
  joined_at: string;
};

const GAME_BACKGROUNDS: Record<string, string> = {
  racing:
    "from-orange-500 via-red-500 to-fuchsia-700",
  "mini-golf":
    "from-emerald-400 via-green-600 to-cyan-800",
  "eight-ball":
    "from-sky-400 via-blue-700 to-indigo-950",
  fighting:
    "from-rose-500 via-purple-700 to-slate-950",
  football:
    "from-lime-400 via-emerald-600 to-green-950",
  archery:
    "from-amber-400 via-orange-600 to-stone-900",
};

function gameBackground(gameKey: string | null | undefined) {
  return (
    GAME_BACKGROUNDS[gameKey ?? ""] ??
    "from-indigo-500 via-purple-700 to-slate-950"
  );
}

export default function GameChannelRoom({
  serverId,
  channelId,
  channelName,
  currentUserId,
  canManage,
  onSummaryChange,
}: {
  serverId: string;
  channelId: string;
  channelName: string;
  currentUserId: string;
  canManage: boolean;
  onSummaryChange?: (summary: GameChannelSummary) => void;
}) {
  const [catalog, setCatalog] = useState<GameCatalogItem[]>(
    [],
  );
  const [summary, setSummary] =
    useState<GameChannelSummary | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadLobby = useCallback(async () => {
    const [
      { data: catalogRows, error: catalogError },
      { data: summaryRows, error: summaryError },
      { data: playerRows, error: playerError },
    ] = await Promise.all([
      supabase
        .from("game_catalog")
        .select(
          "game_key, name, icon, description, max_players, category, sort_order",
        )
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase.rpc("get_server_game_summaries", {
        p_server_id: serverId,
      }),
      supabase.rpc("get_game_channel_players", {
        p_channel_id: channelId,
      }),
    ]);

    const firstError =
      catalogError || summaryError || playerError;

    if (firstError) {
      setErrorMessage(firstError.message);
      setLoading(false);
      return;
    }

    const nextCatalog =
      (catalogRows ?? []) as GameCatalogItem[];
    const nextSummary = (
      (summaryRows ?? []) as GameChannelSummary[]
    ).find((item) => item.channel_id === channelId) ?? {
      channel_id: channelId,
      game_key: null,
      game_name: null,
      game_icon: null,
      max_players: null,
      player_count: 0,
      status: "waiting" as const,
    };

    setCatalog(nextCatalog);
    setSummary(nextSummary);
    setPlayers((playerRows ?? []) as GamePlayer[]);
    setLoading(false);
    setErrorMessage("");
    onSummaryChange?.(nextSummary);
  }, [channelId, onSummaryChange, serverId]);

  useEffect(() => {
    const initialTimer = window.setTimeout(
      () => void loadLobby(),
      0,
    );

    const realtime = supabase
      .channel(`game-room-ui-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_channel_states",
          filter: `channel_id=eq.${channelId}`,
        },
        () => void loadLobby(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_channel_players",
          filter: `channel_id=eq.${channelId}`,
        },
        () => void loadLobby(),
      )
      .subscribe();

    const refreshTimer = window.setInterval(
      () => void loadLobby(),
      20_000,
    );

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
      void supabase.removeChannel(realtime);
    };
  }, [channelId, loadLobby]);

  const currentPlayer = useMemo(
    () =>
      players.find((player) => player.id === currentUserId) ??
      null,
    [currentUserId, players],
  );

  useEffect(() => {
    if (!currentPlayer) return;

    const heartbeatTimer = window.setInterval(() => {
      void supabase.rpc("heartbeat_game_channel", {
        p_channel_id: channelId,
      });
    }, 30_000);

    return () => window.clearInterval(heartbeatTimer);
  }, [channelId, currentPlayer]);

  const selectedGame = useMemo(
    () =>
      catalog.find(
        (game) => game.game_key === summary?.game_key,
      ) ?? null,
    [catalog, summary?.game_key],
  );

  async function chooseGame(gameKey: string) {
    if (!canManage || working) return;

    const game = catalog.find(
      (item) => item.game_key === gameKey,
    );
    if (!game) return;

    if (
      summary?.game_key &&
      summary.game_key !== gameKey &&
      players.length > 0 &&
      !window.confirm(
        `Đổi sang "${game.name}" sẽ đưa mọi người ra khỏi phòng chờ hiện tại. Tiếp tục?`,
      )
    ) {
      return;
    }

    setWorking(true);
    setErrorMessage("");
    const { error } = await supabase.rpc(
      "set_game_channel_game",
      {
        p_channel_id: channelId,
        p_game_key: gameKey,
      },
    );

    if (error) setErrorMessage(error.message);
    else await loadLobby();
    setWorking(false);
  }

  async function joinGame() {
    if (working || !selectedGame) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "join_game_channel",
      {
        p_channel_id: channelId,
      },
    );

    if (error) setErrorMessage(error.message);
    else await loadLobby();
    setWorking(false);
  }

  async function leaveGame() {
    if (working) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "leave_game_channel",
      {
        p_channel_id: channelId,
      },
    );

    if (error) setErrorMessage(error.message);
    else await loadLobby();
    setWorking(false);
  }

  async function toggleReady() {
    if (!currentPlayer || working) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "set_game_player_ready",
      {
        p_channel_id: channelId,
        p_is_ready: !currentPlayer.is_ready,
      },
    );

    if (error) setErrorMessage(error.message);
    else await loadLobby();
    setWorking(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        Đang tải phòng game...
      </div>
    );
  }

  const playerCount = Number(
    summary?.player_count ?? players.length,
  );
  const maximumPlayers = summary?.max_players ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#202225] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎮</span>
            <h1 className="truncate text-xl font-black">
              {channelName}
            </h1>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {playerCount}/{maximumPlayers ?? "—"} người ·{" "}
            {summary?.game_name ?? "Chưa chọn game"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {selectedGame && !currentPlayer && (
            <button
              type="button"
              onClick={() => void joinGame()}
              disabled={
                working ||
                (maximumPlayers !== null &&
                  playerCount >= maximumPlayers)
              }
              className="rounded-xl bg-green-600 px-4 py-2.5 font-black hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {maximumPlayers !== null &&
              playerCount >= maximumPlayers
                ? "Phòng đã đầy"
                : "Tham gia chơi"}
            </button>
          )}

          {currentPlayer && (
            <>
              <button
                type="button"
                onClick={() => void toggleReady()}
                disabled={working}
                className={`rounded-xl px-4 py-2.5 font-black disabled:opacity-50 ${
                  currentPlayer.is_ready
                    ? "bg-green-600 hover:bg-green-500"
                    : "bg-indigo-500 hover:bg-indigo-400"
                }`}
              >
                {currentPlayer.is_ready
                  ? "✓ Đã sẵn sàng"
                  : "Sẵn sàng"}
              </button>
              <button
                type="button"
                onClick={() => void leaveGame()}
                disabled={working}
                className="rounded-xl bg-red-500/15 px-4 py-2.5 font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
              >
                Rời phòng
              </button>
            </>
          )}
        </div>
      </header>

      {errorMessage && (
        <p className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[210px_minmax(0,1fr)_240px]">
        <aside className="rounded-2xl bg-[#202225] p-3">
          <h2 className="px-1 text-xs font-black uppercase tracking-wide text-amber-400">
            Game hay nhất
          </h2>
          <div className="mt-3 space-y-2">
            {catalog.slice(0, 4).map((game) => {
              const active =
                summary?.game_key === game.game_key;
              return (
                <button
                  key={game.game_key}
                  type="button"
                  onClick={() => void chooseGame(game.game_key)}
                  disabled={!canManage || working}
                  title={
                    canManage
                      ? `Chọn ${game.name}`
                      : "Chỉ chủ hoặc quản lý server được chọn game"
                  }
                  className={`w-full overflow-hidden rounded-xl border text-left transition ${
                    active
                      ? "border-indigo-400 ring-2 ring-indigo-400/30"
                      : "border-white/10 hover:border-white/25"
                  } disabled:cursor-default`}
                >
                  <span
                    className={`flex h-20 items-center justify-center bg-gradient-to-br text-4xl ${gameBackground(
                      game.game_key,
                    )}`}
                  >
                    {game.icon}
                  </span>
                  <span className="block truncate bg-[#2b2d31] px-2 py-2 text-center text-xs font-bold">
                    {game.name}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#202225]">
          {selectedGame ? (
            <>
              <div
                className={`relative flex min-h-[420px] items-center justify-center overflow-hidden bg-gradient-to-br p-8 text-center ${gameBackground(
                  selectedGame.game_key,
                )}`}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.55)_100%)]" />
                <div className="relative z-10">
                  <div className="text-8xl drop-shadow-2xl">
                    {selectedGame.icon}
                  </div>
                  <h2 className="mt-5 text-4xl font-black drop-shadow-lg">
                    {selectedGame.name}
                  </h2>
                  <p className="mx-auto mt-3 max-w-lg text-white/80">
                    {selectedGame.description}
                  </p>
                  <div className="mx-auto mt-6 inline-flex rounded-full bg-black/35 px-4 py-2 text-sm font-bold backdrop-blur-sm">
                    Khung trò chơi đã sẵn sàng để tích hợp game
                    nhiều người
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-black">
                    {selectedGame.icon} {selectedGame.name}
                  </h3>
                  <p className="text-xs text-gray-400">
                    Tối đa {selectedGame.max_players} người ·
                    Phòng chờ thời gian thực
                  </p>
                </div>
                <button
                  type="button"
                  disabled
                  title="Nút này sẽ hoạt động khi mã game được gắn vào"
                  className="rounded-xl bg-orange-500 px-5 py-2.5 font-black opacity-60"
                >
                  ▶ Game đang được phát triển
                </button>
              </div>
            </>
          ) : (
            <div className="flex min-h-[520px] items-center justify-center p-8 text-center">
              <div>
                <div className="text-7xl">🎮</div>
                <h2 className="mt-5 text-3xl font-black">
                  Chưa chọn game
                </h2>
                <p className="mx-auto mt-3 max-w-md text-gray-400">
                  {canManage
                    ? "Chọn một game ở danh sách bên trái hoặc bên phải để mở phòng chờ."
                    : "Chờ chủ server hoặc quản lý chọn game cho kênh này."}
                </p>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl bg-[#202225] p-3">
            <h2 className="px-1 text-xs font-black uppercase tracking-wide text-amber-400">
              Game mới nhất
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-1">
              {catalog.slice(4).map((game) => (
                <button
                  key={game.game_key}
                  type="button"
                  onClick={() => void chooseGame(game.game_key)}
                  disabled={!canManage || working}
                  title={
                    canManage
                      ? `Chọn ${game.name}`
                      : "Chỉ chủ hoặc quản lý server được chọn game"
                  }
                  className={`flex items-center gap-3 rounded-xl border p-2 text-left ${
                    summary?.game_key === game.game_key
                      ? "border-indigo-400 bg-indigo-500/10"
                      : "border-white/10 bg-[#2b2d31] hover:border-white/25"
                  } disabled:cursor-default`}
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-2xl ${gameBackground(
                      game.game_key,
                    )}`}
                  >
                    {game.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold">
                      {game.name}
                    </span>
                    <span className="block text-[10px] text-gray-500">
                      Tối đa {game.max_players} người
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-[#202225] p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-wide text-gray-400">
                Người chơi
              </h2>
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-black text-green-300">
                {players.length}/{maximumPlayers ?? "—"}
              </span>
            </div>

            {players.length === 0 ? (
              <p className="py-6 text-center text-xs text-gray-500">
                Chưa có người tham gia.
              </p>
            ) : (
              <div className="mt-3 space-y-1">
                {players.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center gap-2 rounded-xl bg-[#2b2d31] p-2"
                  >
                    {player.avatar_url ? (
                      <img
                        src={player.avatar_url}
                        alt={player.username}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-xs font-black">
                        {player.username
                          .charAt(0)
                          .toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <MemberBadge role={player.role} />
                        <span className="truncate text-xs font-bold">
                          {player.username}
                        </span>
                      </span>
                      <span className="block text-[9px] text-gray-500">
                        {formatPublicId(player.public_id)}
                      </span>
                    </span>
                    <span
                      title={
                        player.is_ready
                          ? "Đã sẵn sàng"
                          : "Chưa sẵn sàng"
                      }
                      className={`h-2.5 w-2.5 rounded-full ${
                        player.is_ready
                          ? "bg-green-400"
                          : "bg-gray-600"
                      }`}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <ChannelVoiceRoom
        channelId={channelId}
        channelName={`${channelName} · Trò chuyện khi chơi`}
        voiceOnly
        compact
      />
    </div>
  );
}
