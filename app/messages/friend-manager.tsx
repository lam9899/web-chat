"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";
import MemberBadge, {
  formatPublicId,
  type MemberRole,
} from "@/components/member-badge";

const supabase = createClient();

type FriendProfile = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: MemberRole;
};

type FriendRow = FriendProfile & {
  created_at: string;
};

type FriendRequestRow = FriendProfile & {
  request_id: number;
  direction: "incoming" | "outgoing";
  created_at: string;
};

type SearchResult = FriendProfile & {
  relationship_state:
    | "self"
    | "friends"
    | "incoming"
    | "outgoing"
    | "none";
  request_id: number | null;
};

type TabId = "friends" | "requests" | "add";

function Avatar({ profile }: { profile: FriendProfile }) {
  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt={profile.username}
        className="h-11 w-11 rounded-full object-cover"
      />
    );
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold text-white">
      {profile.username.charAt(0).toUpperCase()}
    </div>
  );
}

function ProfileIdentity({ profile }: { profile: FriendProfile }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2">
        <strong className="truncate">{profile.username}</strong>
        <MemberBadge role={profile.role} />
      </div>
      <div className="mt-0.5 text-xs text-gray-500">
        {formatPublicId(profile.public_id)}
      </div>
    </div>
  );
}

export default function FriendManager({
  onFriendsChanged,
}: {
  onFriendsChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("friends");
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [requests, setRequests] = useState<FriendRequestRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [workingKey, setWorkingKey] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const incomingCount = useMemo(
    () =>
      requests.filter((request) => request.direction === "incoming")
        .length,
    [requests],
  );

  async function loadData() {
    setLoading(true);
    setErrorMessage("");

    const [friendsResponse, requestsResponse] = await Promise.all([
      supabase.rpc("get_my_friends"),
      supabase.rpc("get_friend_requests"),
    ]);

    if (friendsResponse.error) {
      setErrorMessage(
        `Không thể tải bạn bè: ${friendsResponse.error.message}`,
      );
    } else {
      setFriends((friendsResponse.data ?? []) as FriendRow[]);
    }

    if (requestsResponse.error) {
      setErrorMessage(
        `Không thể tải lời mời kết bạn: ${requestsResponse.error.message}`,
      );
    } else {
      setRequests(
        (requestsResponse.data ?? []) as FriendRequestRow[],
      );
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadData();

    const channel = supabase
      .channel(`friend-manager-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
        },
        () => void loadData(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
        },
        () => void loadData(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  async function searchPeople(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query || searching) return;

    setSearching(true);
    setErrorMessage("");

    const { data, error } = await supabase.rpc(
      "search_people_for_friendship",
      { p_query: query },
    );

    if (error) {
      setErrorMessage(`Không thể tìm thành viên: ${error.message}`);
      setResults([]);
    } else {
      setResults((data ?? []) as SearchResult[]);
    }

    setSearching(false);
  }

  async function runAction(
    key: string,
    action: () => Promise<{ error: { message: string } | null }>,
    changedFriends = false,
  ) {
    if (workingKey) return;
    setWorkingKey(key);
    setErrorMessage("");

    const { error } = await action();
    if (error) {
      setErrorMessage(error.message);
    } else {
      await loadData();
      if (searchQuery.trim()) {
        const response = await supabase.rpc(
          "search_people_for_friendship",
          { p_query: searchQuery.trim() },
        );
        if (!response.error) {
          setResults((response.data ?? []) as SearchResult[]);
        }
      }
      if (changedFriends) onFriendsChanged?.();
    }

    setWorkingKey("");
  }

  function requestButton(result: SearchResult) {
    if (result.relationship_state === "self") {
      return <span className="text-xs text-gray-500">Tài khoản của bạn</span>;
    }

    if (result.relationship_state === "friends") {
      return (
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(`Hủy kết bạn với ${result.username}?`)) return;
            void runAction(
              `remove-${result.id}`,
              async () => {
                const response = await supabase.rpc("remove_friend", {
                  p_friend_id: result.id,
                });
                return { error: response.error };
              },
              true,
            );
          }}
          className="rounded-lg bg-red-500/15 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/25"
        >
          Hủy bạn bè
        </button>
      );
    }

    if (result.relationship_state === "outgoing") {
      return (
        <button
          type="button"
          onClick={() =>
            void runAction(`cancel-${result.request_id}`, async () => {
              const response = await supabase.rpc(
                "cancel_friend_request",
                { p_request_id: result.request_id },
              );
              return { error: response.error };
            })
          }
          className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15"
        >
          Hủy lời mời
        </button>
      );
    }

    if (result.relationship_state === "incoming") {
      return (
        <button
          type="button"
          onClick={() =>
            void runAction(
              `accept-${result.request_id}`,
              async () => {
                const response = await supabase.rpc(
                  "respond_friend_request",
                  {
                    p_request_id: result.request_id,
                    p_response: "accepted",
                  },
                );
                return { error: response.error };
              },
              true,
            )
          }
          className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold hover:bg-green-500"
        >
          Chấp nhận
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() =>
          void runAction(`send-${result.id}`, async () => {
            const response = await supabase.rpc("send_friend_request", {
              p_receiver_id: result.id,
            });
            return { error: response.error };
          })
        }
        className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-bold hover:bg-indigo-400"
      >
        Kết bạn
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void loadData();
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-lg hover:bg-white/15"
        title="Bạn bè"
        aria-label="Quản lý bạn bè"
      >
        👥
        {incomingCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[10px] font-black leading-5 text-white">
            {incomingCount > 9 ? "9+" : incomingCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#24262b] text-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/10 p-5">
              <div>
                <h2 className="text-xl font-bold">Bạn bè</h2>
                <p className="text-sm text-gray-400">
                  Chỉ bạn bè mới thấy nhau online, nhắn tin và gọi điện.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/15"
              >
                ×
              </button>
            </header>

            <nav className="grid grid-cols-3 border-b border-white/10 p-2">
              {([
                ["friends", `Bạn bè (${friends.length})`],
                ["requests", `Lời mời (${incomingCount})`],
                ["add", "Thêm bạn"],
              ] as Array<[TabId, string]>).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`rounded-xl px-3 py-2 text-sm font-bold ${
                    tab === id
                      ? "bg-indigo-500 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {errorMessage && (
                <div className="mb-4 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
                  {errorMessage}
                </div>
              )}

              {loading ? (
                <p className="text-sm text-gray-400">Đang tải...</p>
              ) : tab === "friends" ? (
                friends.length === 0 ? (
                  <div className="py-12 text-center text-gray-400">
                    <div className="text-5xl">👥</div>
                    <p className="mt-3">Bạn chưa kết bạn với ai.</p>
                    <button
                      type="button"
                      onClick={() => setTab("add")}
                      className="mt-4 rounded-lg bg-indigo-500 px-4 py-2 font-bold text-white"
                    >
                      Tìm bạn bè
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {friends.map((friend) => (
                      <article
                        key={friend.id}
                        className="flex items-center gap-3 rounded-2xl bg-black/15 p-3"
                      >
                        <Avatar profile={friend} />
                        <ProfileIdentity profile={friend} />
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            window.location.href = `/messages?user=${encodeURIComponent(
                              friend.id,
                            )}`;
                          }}
                          className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-bold hover:bg-indigo-400"
                        >
                          Nhắn tin
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`Hủy kết bạn với ${friend.username}?`)) return;
                            void runAction(
                              `remove-${friend.id}`,
                              async () => {
                                const response = await supabase.rpc(
                                  "remove_friend",
                                  { p_friend_id: friend.id },
                                );
                                return { error: response.error };
                              },
                              true,
                            );
                          }}
                          className="rounded-lg bg-red-500/15 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/25"
                        >
                          Hủy
                        </button>
                      </article>
                    ))}
                  </div>
                )
              ) : tab === "requests" ? (
                requests.length === 0 ? (
                  <p className="py-12 text-center text-gray-400">
                    Không có lời mời kết bạn đang chờ.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {requests.map((request) => (
                      <article
                        key={request.request_id}
                        className="flex items-center gap-3 rounded-2xl bg-black/15 p-3"
                      >
                        <Avatar profile={request} />
                        <ProfileIdentity profile={request} />
                        {request.direction === "incoming" ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void runAction(
                                  `accept-${request.request_id}`,
                                  async () => {
                                    const response = await supabase.rpc(
                                      "respond_friend_request",
                                      {
                                        p_request_id: request.request_id,
                                        p_response: "accepted",
                                      },
                                    );
                                    return { error: response.error };
                                  },
                                  true,
                                )
                              }
                              className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold hover:bg-green-500"
                            >
                              Đồng ý
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void runAction(
                                  `decline-${request.request_id}`,
                                  async () => {
                                    const response = await supabase.rpc(
                                      "respond_friend_request",
                                      {
                                        p_request_id: request.request_id,
                                        p_response: "declined",
                                      },
                                    );
                                    return { error: response.error };
                                  },
                                )
                              }
                              className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15"
                            >
                              Xóa
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void runAction(
                                `cancel-${request.request_id}`,
                                async () => {
                                  const response = await supabase.rpc(
                                    "cancel_friend_request",
                                    { p_request_id: request.request_id },
                                  );
                                  return { error: response.error };
                                },
                              )
                            }
                            className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15"
                          >
                            Hủy lời mời
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )
              ) : (
                <div>
                  <form onSubmit={searchPeople} className="flex gap-2">
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Nhập Gmail, #000000 hoặc tên..."
                      className="min-w-0 flex-1 rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
                    />
                    <button
                      type="submit"
                      disabled={searching || !searchQuery.trim()}
                      className="rounded-xl bg-indigo-500 px-5 py-3 font-bold disabled:opacity-50"
                    >
                      {searching ? "Đang tìm..." : "Tìm"}
                    </button>
                  </form>
                  <p className="mt-2 text-xs text-gray-500">
                    Gmail phải nhập đầy đủ. ID có dạng #000000.
                  </p>

                  <div className="mt-5 space-y-2">
                    {results.map((result) => (
                      <article
                        key={result.id}
                        className="flex items-center gap-3 rounded-2xl bg-black/15 p-3"
                      >
                        <Avatar profile={result} />
                        <ProfileIdentity profile={result} />
                        {requestButton(result)}
                      </article>
                    ))}
                    {!searching && searchQuery.trim() && results.length === 0 && (
                      <p className="py-8 text-center text-gray-400">
                        Không tìm thấy thành viên phù hợp.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
