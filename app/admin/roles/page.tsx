"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import MemberBadge, {
  formatPublicId,
  type MemberRole,
} from "@/components/member-badge";

const supabase = createClient();

type MemberRow = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  email: string;
  role: MemberRole;
  created_at: string;
};

export default function RolesPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadMembers() {
    const { data, error } = await supabase.rpc(
      "staff_list_members",
    );
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setMembers((data ?? []) as MemberRow[]);
  }

  useEffect(() => {
    let active = true;

    async function initialize() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }

      const { data: role } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!active) return;
      if (role?.role !== "admin") {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setCurrentUserId(user.id);
      await loadMembers();
      if (active) setLoading(false);
    }

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    if (!query) return members;
    return members.filter(
      (member) =>
        member.username.toLocaleLowerCase("vi").includes(query) ||
        member.email.toLocaleLowerCase("vi").includes(query) ||
        formatPublicId(member.public_id).includes(query),
    );
  }, [members, search]);

  async function changeRole(member: MemberRow, role: MemberRole) {
    if (member.role === role || workingId) return;
    if (
      member.id === currentUserId &&
      member.role === "admin" &&
      role !== "admin" &&
      !window.confirm(
        "Bạn đang đổi quyền của chính mình. Hãy chắc chắn vẫn còn một AD khác.",
      )
    ) {
      return;
    }

    setWorkingId(member.id);
    setErrorMessage("");
    const { error } = await supabase.rpc("admin_set_user_role", {
      p_user_id: member.id,
      p_role: role,
    });

    if (error) {
      setErrorMessage(error.message);
    } else {
      await loadMembers();
    }
    setWorkingId("");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] text-white">
        Đang tải phân quyền...
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] p-5 text-white">
        <section className="rounded-2xl bg-[#313338] p-6 text-center">
          <h1 className="text-xl font-bold">Không có quyền truy cập</h1>
          <p className="mt-2 text-gray-400">Chỉ AD được thay đổi phân quyền.</p>
          <button
            type="button"
            onClick={() => (window.location.href = "/")}
            className="mt-4 rounded-lg bg-indigo-500 px-4 py-2 font-bold"
          >
            Quay lại
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#1e1f22] p-4 text-white md:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-red-500/15 px-3 py-1 text-xs font-black text-red-300">
              AD
            </div>
            <h1 className="mt-2 text-3xl font-bold">Phân quyền thành viên</h1>
            <p className="mt-1 text-gray-400">
              AD: toàn quyền · QT: kiểm duyệt TV · TV: thành viên bình thường.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => (window.location.href = "/admin")}
              className="rounded-lg bg-white/10 px-4 py-2 font-bold hover:bg-white/15"
            >
              Quản trị
            </button>
            <button
              type="button"
              onClick={() => (window.location.href = "/")}
              className="rounded-lg bg-indigo-500 px-4 py-2 font-bold"
            >
              Phòng chat
            </button>
          </div>
        </header>

        {errorMessage && (
          <div className="mb-4 rounded-xl bg-red-500/15 px-4 py-3 text-red-300">
            {errorMessage}
          </div>
        )}

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm theo tên, Gmail hoặc #000000..."
          className="mb-4 w-full rounded-xl bg-[#313338] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
        />

        <section className="grid gap-3 md:grid-cols-2">
          {filtered.map((member) => (
            <article
              key={member.id}
              className="flex items-center gap-3 rounded-2xl bg-[#313338] p-4"
            >
              {member.avatar_url ? (
                <img
                  src={member.avatar_url}
                  alt={member.username}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                  {member.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <strong className="truncate">{member.username}</strong>
                  <MemberBadge role={member.role} />
                </div>
                <p className="mt-1 truncate text-xs text-gray-400">
                  {formatPublicId(member.public_id)} · {member.email}
                </p>
              </div>
              <select
                value={member.role}
                onChange={(event) =>
                  void changeRole(
                    member,
                    event.target.value as MemberRole,
                  )
                }
                disabled={workingId === member.id}
                className="rounded-lg bg-[#1e1f22] px-3 py-2 text-sm outline-none disabled:opacity-50"
              >
                <option value="member">TV</option>
                <option value="moderator">QT</option>
                <option value="admin">AD</option>
              </select>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
