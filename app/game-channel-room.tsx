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
import MiniGolfGame from "./mini-golf-game";

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
  seat_index: number;
};

type GameSeatInvite = {
  invite_id: number;
  seat_index: number;
  invitee_id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: "admin" | "moderator" | "member";
  inviter_username: string;
  created_at: string;
};

type InvitableFriend = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: "admin" | "moderator" | "member";
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
  const [seatInvites, setSeatInvites] = useState<
    GameSeatInvite[]
  >([]);
  const [invitableFriends, setInvitableFriends] = useState<
    InvitableFriend[]
  >([]);
  const [selectedSeatIndex, setSelectedSeatIndex] =
    useState<number | null>(null);
  const [showFriendPicker, setShowFriendPicker] =
    useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadLobby = useCallback(async () => {
    const [
      { data: catalogRows, error: catalogError },
      { data: summaryRows, error: summaryError },
      { data: playerRows, error: playerError },
      { data: inviteRows, error: inviteError },
      { data: friendRows, error: friendError },
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
      supabase.rpc("get_game_channel_invites", {
        p_channel_id: channelId,
      }),
      supabase.rpc("get_invitable_game_friends", {
        p_channel_id: channelId,
      }),
    ]);

    const firstError =
      catalogError ||
      summaryError ||
      playerError ||
      inviteError ||
      friendError;

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
    setSeatInvites((inviteRows ?? []) as GameSeatInvite[]);
    setInvitableFriends(
      (friendRows ?? []) as InvitableFriend[],
    );
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_channel_invites",
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

  async function joinGame(seatIndex?: number) {
    if (working || !selectedGame) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "join_game_channel",
      {
        p_channel_id: channelId,
        p_seat_index: seatIndex ?? null,
      },
    );

    if (error) setErrorMessage(error.message);
    else {
      setSelectedSeatIndex(null);
      await loadLobby();
    }
    setWorking(false);
  }

  async function moveToSeat(seatIndex: number) {
    if (!currentPlayer || working) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "move_game_channel_seat",
      {
        p_channel_id: channelId,
        p_seat_index: seatIndex,
      },
    );

    if (error) setErrorMessage(error.message);
    else {
      setSelectedSeatIndex(null);
      await loadLobby();
    }
    setWorking(false);
  }

  async function inviteFriend(friendId: string) {
    if (selectedSeatIndex === null || working) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "invite_friend_to_game_channel",
      {
        p_channel_id: channelId,
        p_friend_id: friendId,
        p_seat_index: selectedSeatIndex,
      },
    );

    if (error) setErrorMessage(error.message);
    else {
      setSelectedSeatIndex(null);
      setShowFriendPicker(false);
      await loadLobby();
    }
    setWorking(false);
  }

  async function respondToInvite(
    inviteId: number,
    accept: boolean,
  ) {
    if (working) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "respond_game_channel_invite",
      {
        p_invite_id: inviteId,
        p_accept: accept,
      },
    );

    if (error) setErrorMessage(error.message);
    else await loadLobby();
    setWorking(false);
  }

  async function startGame() {
    if (!currentPlayer || currentPlayer.seat_index !== 0 || working) {
      return;
    }

    setWorking(true);
    setErrorMessage("");
    const { error } = await supabase.rpc(
      "start_game_channel",
      { p_channel_id: channelId },
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
  const isRoomHost = currentPlayer?.seat_index === 0;
  const canStartGame =
    isRoomHost &&
    players.length >= 2 &&
    players.every((player) => player.is_ready) &&
    summary?.status !== "playing";

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#202225] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">
              {summary?.game_icon ?? "🎮"}
            </span>
            <h1 className="truncate text-xl font-black">
              {summary?.game_name ?? channelName}
            </h1>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {channelName} · {playerCount}/
            {maximumPlayers ?? "—"} người
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {currentPlayer && (
            <>
              {isRoomHost && (
                <button
                  type="button"
                  onClick={() => void startGame()}
                  disabled={working || !canStartGame}
                  title={
                    players.length < 2
                      ? "Cần ít nhất 2 người"
                      : !players.every(
                            (player) => player.is_ready,
                          )
                        ? "Tất cả người chơi phải sẵn sàng"
                        : "Bắt đầu trò chơi"
                  }
                  className="rounded-xl bg-amber-500 px-4 py-2.5 font-black text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {summary?.status === "playing"
                    ? "Đang chơi"
                    : "▶ Bắt đầu trò chơi"}
                </button>
              )}
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
            selectedGame.game_key === "mini-golf" ? (
              <MiniGolfGame
                channelId={channelId}
                currentUserId={currentUserId}
                onMatchChange={loadLobby}
              />
            ) : (
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
            )
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

      {selectedGame && maximumPlayers !== null && (
        <section className="rounded-2xl border border-white/10 bg-[#202225] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">
                {selectedGame.icon} Phòng chờ{" "}
                {selectedGame.name}
              </h2>
              <p className="mt-1 text-xs text-gray-400">
                Ô số 1 là chủ phòng · Bấm dấu + để tham gia
                hoặc mời bạn bè
              </p>
            </div>
            <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-black text-green-300">
              {players.length}/{maximumPlayers} người
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {Array.from(
              { length: maximumPlayers },
              (_, seatIndex) => {
                const player = players.find(
                  (item) => item.seat_index === seatIndex,
                );
                const invite = seatInvites.find(
                  (item) => item.seat_index === seatIndex,
                );

                if (player) {
                  return (
                    <div
                      key={seatIndex}
                      className={`relative flex min-h-32 flex-col items-center justify-center rounded-2xl border p-3 text-center ${
                        seatIndex === 0
                          ? "border-amber-400/70 bg-amber-500/10"
                          : "border-white/10 bg-[#2b2d31]"
                      }`}
                    >
                      {seatIndex === 0 && (
                        <span
                          title="Chủ phòng"
                          className="absolute left-2 top-2 text-lg"
                        >
                          👑
                        </span>
                      )}
                      <span className="absolute right-2 top-2 text-[10px] font-black text-gray-500">
                        {seatIndex + 1}
                      </span>

                      {player.avatar_url ? (
                        <img
                          src={player.avatar_url}
                          alt={player.username}
                          className="h-12 w-12 rounded-full object-cover ring-2 ring-white/10"
                        />
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500 text-lg font-black">
                          {player.username
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      )}

                      <span className="mt-2 max-w-full truncate text-xs font-black">
                        {player.username}
                      </span>
                      <span
                        className={`mt-1 text-[10px] font-bold ${
                          player.is_ready
                            ? "text-green-300"
                            : "text-gray-500"
                        }`}
                      >
                        {seatIndex === 0
                          ? player.is_ready
                            ? "Chủ phòng · Sẵn sàng"
                            : "Chủ phòng · Chưa sẵn sàng"
                          : player.is_ready
                            ? "Đã sẵn sàng"
                            : "Chưa sẵn sàng"}
                      </span>
                    </div>
                  );
                }

                if (invite) {
                  const isMyInvite =
                    invite.invitee_id === currentUserId;

                  return (
                    <div
                      key={seatIndex}
                      className="relative flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-400/50 bg-indigo-500/10 p-3 text-center"
                    >
                      <span className="absolute right-2 top-2 text-[10px] font-black text-gray-500">
                        {seatIndex + 1}
                      </span>
                      {invite.avatar_url ? (
                        <img
                          src={invite.avatar_url}
                          alt={invite.username}
                          className="h-10 w-10 rounded-full object-cover opacity-70"
                        />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/60 text-sm font-black">
                          {invite.username
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      )}
                      <span className="mt-2 max-w-full truncate text-[11px] font-bold text-indigo-200">
                        {invite.username}
                      </span>
                      <span className="mt-1 text-[9px] text-gray-400">
                        Đã được mời
                      </span>

                      {isMyInvite && (
                        <span className="mt-2 flex gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              void respondToInvite(
                                invite.invite_id,
                                true,
                              )
                            }
                            disabled={working}
                            className="rounded-lg bg-green-600 px-2 py-1 text-[9px] font-black hover:bg-green-500"
                          >
                            Vào
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void respondToInvite(
                                invite.invite_id,
                                false,
                              )
                            }
                            disabled={working}
                            className="rounded-lg bg-white/10 px-2 py-1 text-[9px] font-black hover:bg-white/15"
                          >
                            Từ chối
                          </button>
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <button
                    key={seatIndex}
                    type="button"
                    onClick={() => {
                      setSelectedSeatIndex(seatIndex);
                      setShowFriendPicker(false);
                      setErrorMessage("");
                    }}
                    disabled={working}
                    title={`Ô chờ ${seatIndex + 1}`}
                    className="group relative flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-[#2b2d31]/60 p-3 transition hover:border-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50"
                  >
                    <span className="absolute right-2 top-2 text-[10px] font-black text-gray-600">
                      {seatIndex + 1}
                    </span>
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-3xl text-gray-500 transition group-hover:bg-indigo-500 group-hover:text-white">
                      +
                    </span>
                    <span className="mt-2 text-[10px] font-bold text-gray-500 group-hover:text-indigo-200">
                      Ô trống
                    </span>
                  </button>
                );
              },
            )}
          </div>
        </section>
      )}

      <ChannelVoiceRoom
        channelId={channelId}
        channelName={`${channelName} · Trò chuyện khi chơi`}
        voiceOnly
        compact
      />

      {selectedSeatIndex !== null && (
        <div className="fixed inset-0 z-[280] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Đóng lựa chọn ô chờ"
            onClick={() => {
              setSelectedSeatIndex(null);
              setShowFriendPicker(false);
            }}
            className="absolute inset-0"
          />

          <section
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-[#202225] p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black">
                  Ô chờ số {selectedSeatIndex + 1}
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  {showFriendPicker
                    ? "Chọn một người bạn đang ở trong server."
                    : "Bạn muốn làm gì với ô chờ này?"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedSeatIndex(null);
                  setShowFriendPicker(false);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-2xl"
              >
                ×
              </button>
            </div>

            {showFriendPicker ? (
              <div className="mt-5 max-h-80 space-y-2 overflow-y-auto">
                {invitableFriends.length === 0 ? (
                  <p className="rounded-xl bg-[#2b2d31] px-4 py-6 text-center text-sm text-gray-400">
                    Không có bạn bè phù hợp để mời. Người được
                    mời phải là thành viên của server và chưa ở
                    trong phòng chờ.
                  </p>
                ) : (
                  invitableFriends.map((friend) => (
                    <button
                      key={friend.id}
                      type="button"
                      onClick={() =>
                        void inviteFriend(friend.id)
                      }
                      disabled={working}
                      className="flex w-full items-center gap-3 rounded-xl bg-[#2b2d31] p-3 text-left hover:bg-[#35373c] disabled:opacity-50"
                    >
                      {friend.avatar_url ? (
                        <img
                          src={friend.avatar_url}
                          alt={friend.username}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 font-black">
                          {friend.username
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <MemberBadge role={friend.role} />
                          <span className="truncate text-sm font-bold">
                            {friend.username}
                          </span>
                        </span>
                        <span className="text-[10px] text-gray-500">
                          {formatPublicId(friend.public_id)}
                        </span>
                      </span>
                      <span className="text-indigo-300">Mời</span>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {!currentPlayer && (
                  <button
                    type="button"
                    onClick={() =>
                      void joinGame(selectedSeatIndex)
                    }
                    disabled={working}
                    className="w-full rounded-xl bg-green-600 px-4 py-3 font-black hover:bg-green-500 disabled:opacity-50"
                  >
                    🎮 Tham gia tại ô này
                  </button>
                )}

                {currentPlayer &&
                  currentPlayer.seat_index !==
                    selectedSeatIndex &&
                  currentPlayer.seat_index !== 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        void moveToSeat(selectedSeatIndex)
                      }
                      disabled={working}
                      className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-black hover:bg-indigo-400 disabled:opacity-50"
                    >
                      ↔ Chuyển sang vị trí này
                    </button>
                  )}

                {currentPlayer?.seat_index === 0 && (
                  <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                    Chủ phòng phải ở ô số 1 nên không thể chuyển
                    vị trí.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setShowFriendPicker(true)}
                  disabled={working}
                  className="w-full rounded-xl bg-white/10 px-4 py-3 font-black hover:bg-white/15 disabled:opacity-50"
                >
                  📨 Mời bạn bè vào ô này
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
