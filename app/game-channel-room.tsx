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
  created_at: string;
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

type GamePickerTabId =
  | "all"
  | "new"
  | "hot"
  | `players-${number}`;

type GamePickerTab = {
  id: GamePickerTabId;
  label: string;
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

const GAME_CATEGORY_LABELS: Record<string, string> = {
  action: "Hành động",
  arcade: "Giải trí",
  racing: "Đua xe",
  sports: "Thể thao",
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
  const [showGamePicker, setShowGamePicker] =
    useState(false);
  const [gamePickerTab, setGamePickerTab] =
    useState<GamePickerTabId>("all");
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
          "game_key, name, icon, description, max_players, category, sort_order, created_at",
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
    if (nextSummary.status === "playing") {
      setSelectedSeatIndex(null);
      setShowFriendPicker(false);
      setShowGamePicker(false);
    }
    setPlayers((playerRows ?? []) as GamePlayer[]);
    setSeatInvites(
      inviteError
        ? []
        : ((inviteRows ?? []) as GameSeatInvite[]),
    );
    setInvitableFriends(
      friendError
        ? []
        : ((friendRows ?? []) as InvitableFriend[]),
    );
    setLoading(false);
    const optionalError = inviteError || friendError;
    setErrorMessage(
      optionalError
        ? `Một phần dữ liệu mời bạn chưa tải được: ${optionalError.message}`
        : "",
    );
    onSummaryChange?.(nextSummary);
  }, [channelId, onSummaryChange, serverId]);

  const restoreLobbySession = useCallback(async () => {
    const { error: restoreError } = await supabase.rpc(
      "resume_game_channel_session",
      {
        p_channel_id: channelId,
      },
    );

    await loadLobby();

    if (restoreError) {
      setErrorMessage(
        `Không thể khôi phục phiên phòng game: ${restoreError.message}`,
      );
    }
  }, [channelId, loadLobby]);

  useEffect(() => {
    const initialTimer = window.setTimeout(
      () => void restoreLobbySession(),
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

    const refreshTimer = window.setInterval(() => {
      void restoreLobbySession();
    }, 10_000);
    const handlePageShow = () => {
      void restoreLobbySession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void restoreLobbySession();
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
  }, [channelId, loadLobby, restoreLobbySession]);

  const currentPlayer = useMemo(
    () =>
      players.find((player) => player.id === currentUserId) ??
      null,
    [currentUserId, players],
  );

  const selectedGame = useMemo(
    () =>
      catalog.find(
        (game) => game.game_key === summary?.game_key,
      ) ?? null,
    [catalog, summary?.game_key],
  );

  const orderedCatalog = useMemo(
    () =>
      [...catalog].sort(
        (first, second) =>
          Number(first.sort_order) -
          Number(second.sort_order),
      ),
    [catalog],
  );

  const gamePickerTabs = useMemo<GamePickerTab[]>(() => {
    const playerCounts = Array.from(
      new Set([
        2,
        4,
        8,
        16,
        ...catalog.map((game) => Number(game.max_players)),
      ]),
    )
      .filter((count) => Number.isFinite(count) && count >= 2)
      .sort((first, second) => first - second);

    return [
      { id: "all", label: "Tất cả game" },
      { id: "new", label: "Game mới nhất" },
      { id: "hot", label: "Game hot" },
      ...playerCounts.map((count) => ({
        id: `players-${count}` as const,
        label: `Game ${count} người`,
      })),
    ];
  }, [catalog]);

  const filteredGames = useMemo(() => {
    if (gamePickerTab === "new") {
      return [...orderedCatalog]
        .sort(
          (first, second) =>
            new Date(second.created_at).getTime() -
              new Date(first.created_at).getTime() ||
            Number(second.sort_order) -
              Number(first.sort_order),
        )
        .slice(0, 6);
    }

    if (gamePickerTab === "hot") {
      return orderedCatalog.slice(0, 4);
    }

    if (gamePickerTab.startsWith("players-")) {
      const playerCount = Number(
        gamePickerTab.replace("players-", ""),
      );
      return orderedCatalog.filter(
        (game) => Number(game.max_players) === playerCount,
      );
    }

    return orderedCatalog;
  }, [gamePickerTab, orderedCatalog]);

  useEffect(() => {
    if (!showGamePicker) return;

    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowGamePicker(false);
      }
    }

    window.addEventListener("keydown", closeWithEscape);
    return () =>
      window.removeEventListener("keydown", closeWithEscape);
  }, [showGamePicker]);

  async function chooseGame(gameKey: string) {
    if (
      !canManage ||
      working ||
      summary?.status === "playing"
    ) {
      return;
    }

    const game = catalog.find(
      (item) => item.game_key === gameKey,
    );
    if (!game) return;

    if (summary?.game_key === gameKey) {
      setShowGamePicker(false);
      return;
    }

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
    else {
      await loadLobby();
      setShowGamePicker(false);
    }
    setWorking(false);
  }

  async function joinGame(seatIndex?: number) {
    if (
      working ||
      !selectedGame ||
      summary?.status === "playing"
    ) {
      return;
    }
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
    if (
      !currentPlayer ||
      working ||
      summary?.status === "playing"
    ) {
      return;
    }
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
    if (
      selectedSeatIndex === null ||
      working ||
      summary?.status === "playing"
    ) {
      return;
    }
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

  async function stopGame() {
    if (
      !currentPlayer ||
      currentPlayer.seat_index !== 0 ||
      working ||
      summary?.status !== "playing"
    ) {
      return;
    }

    const confirmed = window.confirm(
      "Dừng trận đang chơi? Kết quả hiện tại sẽ bị hủy và phòng chờ sẽ mở lại.",
    );
    if (!confirmed) return;

    setWorking(true);
    setErrorMessage("");
    const { error } = await supabase.rpc(
      "stop_game_channel",
      { p_channel_id: channelId },
    );

    if (error) setErrorMessage(error.message);
    else await loadLobby();
    setWorking(false);
  }

  async function leaveGame() {
    if (working || summary?.status === "playing") return;
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
    if (
      !currentPlayer ||
      currentPlayer.seat_index === 0 ||
      working ||
      summary?.status === "playing"
    ) {
      return;
    }
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
  const isRoomLocked = summary?.status === "playing";
  const guestPlayers = players.filter(
    (player) => player.seat_index !== 0,
  );
  const canStartGame =
    isRoomHost &&
    players.length >= 1 &&
    guestPlayers.every((player) => player.is_ready) &&
    !isRoomLocked;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {errorMessage && (
        <p className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </p>
      )}

      <div className="w-full min-w-0">
        <section className="w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#202225]">
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
                  className={`relative flex min-h-[520px] items-center justify-center overflow-hidden bg-gradient-to-br p-8 text-center ${gameBackground(
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
                      Khung trò chơi đã sẵn sàng để tích hợp
                      game nhiều người
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
            <div className="flex min-h-[560px] items-center justify-center p-8 text-center">
              <div>
                <div className="text-7xl">🎮</div>
                <h2 className="mt-5 text-3xl font-black">
                  Chưa chọn game
                </h2>
                <p className="mx-auto mt-3 max-w-md text-gray-400">
                  {canManage
                    ? "Bấm Chọn game ở thanh bên dưới để mở thư viện."
                    : "Bạn có thể xem thư viện game; chủ server hoặc quản lý sẽ chọn game cho kênh."}
                </p>
              </div>
            </div>
          )}
        </section>

      </div>

      <section
        aria-label="Điều khiển phòng game"
        className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#202225] px-3 py-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-lg">
            {summary?.game_icon ?? "🎮"}
          </span>
          <h1 className="truncate text-sm font-black">
            {summary?.game_name ?? channelName}
          </h1>
          <span className="truncate text-[11px] text-gray-400">
            {channelName}
          </span>
          <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-1 text-[10px] font-black text-green-300">
            {playerCount}/{maximumPlayers ?? "—"} người
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setShowGamePicker(true)}
            disabled={working || isRoomLocked}
            title={
              isRoomLocked
                ? "Không thể đổi game khi trận đang diễn ra"
                : "Mở thư viện game"
            }
            className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-black text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            🎮 Chọn game
          </button>

          {currentPlayer && (
            <>
              {isRoomHost &&
                (isRoomLocked ? (
                  <button
                    type="button"
                    onClick={() => void stopGame()}
                    disabled={working}
                    title="Dừng trận và mở lại phòng chờ"
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {working ? "Đang dừng..." : "■ Dừng game"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startGame()}
                    disabled={working || !canStartGame}
                    title={
                      !guestPlayers.every(
                        (player) => player.is_ready,
                      )
                        ? "Tất cả người chơi khác phải sẵn sàng"
                        : "Bắt đầu trò chơi"
                    }
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-black text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    ▶ Bắt đầu
                  </button>
                ))}
              {!isRoomHost && !isRoomLocked && (
                <button
                  type="button"
                  onClick={() => void toggleReady()}
                  disabled={working}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black disabled:opacity-50 ${
                    currentPlayer.is_ready
                      ? "bg-green-600 hover:bg-green-500"
                      : "bg-indigo-500 hover:bg-indigo-400"
                  }`}
                >
                  {currentPlayer.is_ready
                    ? "✓ Đã sẵn sàng"
                    : "Sẵn sàng"}
                </button>
              )}
              {isRoomLocked ? (
                <span className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-1.5 text-xs font-black text-amber-200">
                  🔒 Phòng đã khóa
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void leaveGame()}
                  disabled={working}
                  className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                >
                  Rời phòng
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {selectedGame && maximumPlayers !== null && (
        <section className="rounded-xl border border-white/10 bg-[#202225] p-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 text-sm font-black">
              {selectedGame.icon} Phòng chờ
            </h2>
            <p className="min-w-0 flex-1 truncate text-[10px] text-gray-400">
              {isRoomLocked
                ? "🔒 Đang thi đấu · Giữ nguyên người chơi"
                : "Ô 1 là chủ phòng · Bấm + để vào hoặc mời bạn"}
            </p>
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${
                isRoomLocked
                  ? "bg-amber-500/15 text-amber-200"
                  : "bg-green-500/15 text-green-300"
              }`}
            >
              {isRoomLocked ? "🔒 " : ""}
              {players.length}/{maximumPlayers} người
            </span>
          </div>

          <div className="mt-2 grid auto-cols-[74px] grid-flow-col gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
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
                      title={`${player.username} · ${
                        isRoomLocked
                          ? "Đang thi đấu"
                          : seatIndex === 0
                            ? "Chủ phòng"
                            : player.is_ready
                              ? "Đã sẵn sàng"
                              : "Chưa sẵn sàng"
                      }`}
                      className={`relative flex h-[78px] flex-col items-center justify-center rounded-xl border p-1 text-center ${
                        seatIndex === 0
                          ? "border-amber-400/70 bg-amber-500/10"
                          : "border-white/10 bg-[#2b2d31]"
                      }`}
                    >
                      {seatIndex === 0 && (
                        <span
                          title="Chủ phòng"
                          className="absolute left-1 top-1 text-[10px]"
                        >
                          👑
                        </span>
                      )}
                      <span className="absolute right-1 top-1 text-[8px] font-black text-gray-500">
                        {seatIndex + 1}
                      </span>

                      {player.avatar_url ? (
                        <img
                          src={player.avatar_url}
                          alt={player.username}
                          className="h-8 w-8 rounded-full object-cover ring-2 ring-white/10"
                        />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-xs font-black">
                          {player.username
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      )}

                      <span className="mt-1 w-full truncate px-0.5 text-[9px] font-black">
                        {player.username}
                      </span>
                      <span
                        className={`text-[8px] font-bold ${
                          isRoomLocked || player.is_ready
                            ? "text-green-300"
                            : "text-gray-500"
                        }`}
                      >
                        {isRoomLocked
                          ? "Thi đấu"
                          : seatIndex === 0
                            ? "Chủ phòng"
                          : player.is_ready
                            ? "Sẵn sàng"
                            : "Chờ"}
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
                      title={`${invite.username} · Đã được mời`}
                      className="relative flex h-[78px] flex-col items-center justify-center rounded-xl border border-dashed border-indigo-400/50 bg-indigo-500/10 p-1 text-center"
                    >
                      <span className="absolute right-1 top-1 text-[8px] font-black text-gray-500">
                        {seatIndex + 1}
                      </span>
                      {invite.avatar_url ? (
                        <img
                          src={invite.avatar_url}
                          alt={invite.username}
                          className="h-7 w-7 rounded-full object-cover opacity-70"
                        />
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/60 text-[10px] font-black">
                          {invite.username
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      )}
                      <span className="mt-1 w-full truncate px-0.5 text-[8px] font-bold text-indigo-200">
                        {invite.username}
                      </span>
                      <span className="text-[7px] text-gray-400">Đã mời</span>

                      {isMyInvite && !isRoomLocked && (
                        <span className="mt-0.5 flex gap-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              void respondToInvite(
                                invite.invite_id,
                                true,
                            )
                            }
                            disabled={working}
                            className="rounded bg-green-600 px-1 py-0.5 text-[7px] font-black hover:bg-green-500"
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
                            className="rounded bg-white/10 px-1 py-0.5 text-[7px] font-black hover:bg-white/15"
                          >
                            Bỏ
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
                    disabled={working || isRoomLocked}
                    title={`Ô chờ ${seatIndex + 1}`}
                    className="group relative flex h-[78px] flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#2b2d31]/60 p-1 transition hover:border-indigo-400 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="absolute right-1 top-1 text-[8px] font-black text-gray-600">
                      {seatIndex + 1}
                    </span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-lg text-gray-500 transition group-hover:bg-indigo-500 group-hover:text-white">
                      {isRoomLocked ? "🔒" : "+"}
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

      {showGamePicker && !isRoomLocked && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6">
          <button
            type="button"
            aria-label="Đóng thư viện game"
            onClick={() => setShowGamePicker(false)}
            className="absolute inset-0"
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-picker-title"
            className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#202225] shadow-2xl"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <h2
                  id="game-picker-title"
                  className="text-2xl font-black"
                >
                  🎮 Chọn game
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  {canManage
                    ? "Chọn trò chơi sẽ mở trong kênh game này."
                    : "Bạn có thể xem thư viện; chỉ chủ hoặc quản lý server được đổi game."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGamePicker(false)}
                aria-label="Đóng"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-2xl transition hover:bg-white/15"
              >
                ×
              </button>
            </header>

            <div
              role="tablist"
              aria-label="Thể loại game"
              className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/10 px-4 py-3 [scrollbar-width:thin] sm:px-6"
            >
              {gamePickerTabs.map((tab) => {
                const active = gamePickerTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setGamePickerTab(tab.id)}
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-black transition ${
                      active
                        ? "bg-indigo-500 text-white"
                        : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {filteredGames.length === 0 ? (
                <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 p-8 text-center text-gray-400">
                  Chưa có game trong thể loại này.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredGames.map((game) => {
                    const active =
                      summary?.game_key === game.game_key;
                    return (
                      <button
                        key={game.game_key}
                        type="button"
                        onClick={() =>
                          void chooseGame(game.game_key)
                        }
                        disabled={
                          !canManage || working || isRoomLocked
                        }
                        title={
                          canManage
                            ? active
                              ? `${game.name} đang được chọn`
                              : `Chọn ${game.name}`
                            : "Chỉ chủ hoặc quản lý server được chọn game"
                        }
                        className={`group overflow-hidden rounded-2xl border text-left transition ${
                          active
                            ? "border-indigo-400 bg-indigo-500/10 ring-2 ring-indigo-400/25"
                            : "border-white/10 bg-[#2b2d31] hover:-translate-y-0.5 hover:border-white/25"
                        } disabled:cursor-default disabled:hover:translate-y-0`}
                      >
                        <span
                          className={`relative flex h-32 items-center justify-center bg-gradient-to-br text-6xl ${gameBackground(
                            game.game_key,
                          )}`}
                        >
                          {game.icon}
                          {active && (
                            <span className="absolute right-3 top-3 rounded-full bg-indigo-500 px-2.5 py-1 text-[10px] font-black text-white shadow-lg">
                              Đang chọn
                            </span>
                          )}
                        </span>

                        <span className="block p-4">
                          <span className="flex items-start justify-between gap-3">
                            <span className="truncate text-base font-black">
                              {game.name}
                            </span>
                            <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-1 text-[10px] font-black text-green-300">
                              {game.max_players} người
                            </span>
                          </span>
                          <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-indigo-300">
                            {GAME_CATEGORY_LABELS[game.category] ??
                              game.category}
                          </span>
                          <span className="mt-2 block min-h-10 text-xs leading-5 text-gray-400">
                            {game.description}
                          </span>
                          <span
                            className={`mt-4 block rounded-xl px-3 py-2 text-center text-xs font-black ${
                              active
                                ? "bg-indigo-500 text-white"
                                : canManage
                                  ? "bg-white/10 text-gray-100 group-hover:bg-indigo-500"
                                  : "bg-white/5 text-gray-500"
                            }`}
                          >
                            {active
                              ? "✓ Đang chọn"
                              : canManage
                                ? "Chọn game"
                                : "Chỉ xem"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {selectedSeatIndex !== null && !isRoomLocked && (
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
