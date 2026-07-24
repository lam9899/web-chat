"use client";

import {
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

type ReportStatus =
  | "pending"
  | "reviewing"
  | "resolved"
  | "dismissed";

type MessageReportRow = {
  report_id: number;
  message_id: number | null;
  reporter_id: string;
  reporter_username: string;
  reporter_public_id: number;
  reported_user_id: string;
  reported_username: string;
  reported_public_id: number;
  reported_role: MemberRole;
  category:
    | "profanity"
    | "sexual_content"
    | "illegal_content"
    | "spam_scam"
    | "other";
  details: string | null;
  message_content: string;
  attachment_url: string | null;
  channel: string;
  status: ReportStatus;
  created_at: string;
  handled_by: string | null;
  handled_at: string | null;
};

const categoryLabels: Record<
  MessageReportRow["category"],
  {
    label: string;
    icon: string;
    className: string;
  }
> = {
  profanity: {
    label: "Chửi bậy / xúc phạm",
    icon: "🤬",
    className:
      "bg-orange-500/15 text-orange-300",
  },
  sexual_content: {
    label: "Nội dung đồi trụy",
    icon: "🔞",
    className: "bg-pink-500/15 text-pink-300",
  },
  illegal_content: {
    label: "Nội dung phạm pháp",
    icon: "⚠️",
    className: "bg-red-500/15 text-red-300",
  },
  spam_scam: {
    label: "Spam / lừa đảo",
    icon: "🚫",
    className:
      "bg-yellow-500/15 text-yellow-300",
  },
  other: {
    label: "Lý do khác",
    icon: "📝",
    className: "bg-white/10 text-gray-300",
  },
};

const statusLabels: Record<
  ReportStatus,
  {
    label: string;
    className: string;
  }
> = {
  pending: {
    label: "Chờ xử lý",
    className: "bg-red-500/15 text-red-300",
  },
  reviewing: {
    label: "Đang kiểm tra",
    className:
      "bg-yellow-500/15 text-yellow-300",
  },
  resolved: {
    label: "Đã xử lý",
    className:
      "bg-green-500/15 text-green-300",
  },
  dismissed: {
    label: "Đã bỏ qua",
    className: "bg-white/10 text-gray-400",
  },
};

export default function AdminReportsPage() {
  const [currentRole, setCurrentRole] =
    useState<MemberRole>("member");
  const [reports, setReports] = useState<
    MessageReportRow[]
  >([]);
  const [statusFilter, setStatusFilter] =
    useState<ReportStatus | "all">("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] =
    useState(false);
  const [workingReportId, setWorkingReportId] =
    useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadReports() {
    const { data, error } = await supabase.rpc(
      "staff_list_message_reports",
    );

    if (error) {
      setErrorMessage(
        `Không thể tải báo cáo: ${error.message}`,
      );
      return;
    }

    setReports((data ?? []) as MessageReportRow[]);
  }

  useEffect(() => {
    let active = true;
    let realtimeChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function initialize() {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = "/login";
        return;
      }

      const { data: roleData, error: roleError } =
        await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();

      if (!active) return;

      const role =
        roleData?.role as MemberRole | undefined;

      if (
        roleError ||
        !role ||
        !["admin", "moderator"].includes(role)
      ) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setCurrentRole(role);
      await loadReports();

      if (!active) return;

      realtimeChannel = supabase
        .channel(`admin-message-reports-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "public_message_reports",
          },
          () => {
            void loadReports();
          },
        )
        .subscribe();

      setLoading(false);
    }

    void initialize();

    return () => {
      active = false;

      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, []);

  const filteredReports = useMemo(() => {
    const query = searchQuery
      .trim()
      .toLocaleLowerCase("vi");

    return reports.filter((report) => {
      if (
        statusFilter !== "all" &&
        report.status !== statusFilter
      ) {
        return false;
      }

      if (!query) return true;

      return [
        report.reported_username,
        report.reporter_username,
        report.message_content,
        report.details ?? "",
        report.channel,
        formatPublicId(report.reported_public_id),
      ].some((value) =>
        value
          .toLocaleLowerCase("vi")
          .includes(query),
      );
    });
  }, [reports, searchQuery, statusFilter]);

  const pendingCount = useMemo(
    () =>
      reports.filter(
        (report) => report.status === "pending",
      ).length,
    [reports],
  );

  function formatDate(value: string) {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  }

  async function updateReportStatus(
    reportId: number,
    nextStatus: ReportStatus,
  ) {
    if (workingReportId !== null) return;

    setWorkingReportId(reportId);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "staff_update_message_report",
      {
        p_report_id: reportId,
        p_status: nextStatus,
      },
    );

    if (error) {
      setErrorMessage(
        `Không thể cập nhật báo cáo: ${error.message}`,
      );
    } else {
      await loadReports();
    }

    setWorkingReportId(null);
  }

  async function deleteReportedMessage(
    report: MessageReportRow,
  ) {
    if (
      !report.message_id ||
      workingReportId !== null ||
      !window.confirm(
        "Xóa tin nhắn gốc và đánh dấu báo cáo đã xử lý?",
      )
    ) {
      return;
    }

    setWorkingReportId(report.report_id);
    setErrorMessage("");

    const { error: deleteError } = await supabase
      .from("messages")
      .delete()
      .eq("id", report.message_id);

    if (deleteError) {
      setErrorMessage(
        `Không thể xóa tin nhắn: ${deleteError.message}`,
      );
      setWorkingReportId(null);
      return;
    }

    const { error: reportError } = await supabase.rpc(
      "staff_update_message_report",
      {
        p_report_id: report.report_id,
        p_status: "resolved",
      },
    );

    if (reportError) {
      setErrorMessage(
        `Tin đã xóa nhưng không thể cập nhật báo cáo: ${reportError.message}`,
      );
    }

    await loadReports();
    setWorkingReportId(null);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] text-white">
        <p>Đang tải báo cáo...</p>
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] px-4 text-white">
        <section className="w-full max-w-md rounded-2xl bg-[#313338] p-6 text-center shadow-xl">
          <h1 className="text-2xl font-bold">
            Không có quyền truy cập
          </h1>
          <p className="mt-3 text-gray-400">
            Trang này chỉ dành cho AD và QT.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="mt-6 rounded-xl bg-indigo-500 px-5 py-3 font-bold hover:bg-indigo-400"
          >
            Quay lại phòng chat
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#1e1f22] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div
              className={`mb-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                currentRole === "admin"
                  ? "bg-red-500/15 text-red-300"
                  : "bg-green-500/15 text-green-300"
              }`}
            >
              {currentRole === "admin"
                ? "AD"
                : "QT"}
            </div>
            <h1 className="text-3xl font-bold">
              Báo cáo cộng đồng
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              Kiểm tra tin nhắn bị báo cáo, xóa nội
              dung vi phạm hoặc bỏ qua báo cáo sai.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/admin";
              }}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/15"
            >
              Quản trị
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold hover:bg-indigo-400"
            >
              Phòng chat
            </button>
          </div>
        </header>

        {errorMessage && (
          <div className="mb-5 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        <section className="mb-5 rounded-2xl bg-[#313338] p-4 shadow">
          <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <input
              value={searchQuery}
              onChange={(event) =>
                setSearchQuery(event.target.value)
              }
              placeholder="Tìm tên, ID, nội dung..."
              className="rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
            />

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as
                    | ReportStatus
                    | "all",
                )
              }
              className="rounded-xl bg-[#1e1f22] px-4 py-3 outline-none"
            >
              <option value="pending">
                Chờ xử lý ({pendingCount})
              </option>
              <option value="reviewing">
                Đang kiểm tra
              </option>
              <option value="resolved">
                Đã xử lý
              </option>
              <option value="dismissed">
                Đã bỏ qua
              </option>
              <option value="all">Tất cả</option>
            </select>

            <div className="flex items-center justify-center rounded-xl bg-[#1e1f22] px-4 py-3 text-sm font-bold">
              {filteredReports.length} báo cáo
            </div>
          </div>
        </section>

        <div className="space-y-4">
          {filteredReports.length === 0 ? (
            <section className="rounded-2xl bg-[#313338] p-12 text-center text-gray-400">
              <div className="text-5xl">✅</div>
              <p className="mt-3">
                Không có báo cáo phù hợp.
              </p>
            </section>
          ) : (
            filteredReports.map((report) => {
              const category =
                categoryLabels[report.category];
              const status = statusLabels[report.status];
              const working =
                workingReportId === report.report_id;

              return (
                <article
                  key={report.report_id}
                  className="rounded-2xl border border-white/10 bg-[#313338] p-5 shadow"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${category.className}`}
                        >
                          {category.icon} {category.label}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}
                        >
                          {status.label}
                        </span>
                        <span className="text-xs text-gray-500">
                          #{report.report_id} ·{" "}
                          {formatDate(report.created_at)}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl bg-[#1e1f22] p-3">
                          <p className="text-xs uppercase text-gray-500">
                            Người bị báo cáo
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <strong>
                              {report.reported_username}
                            </strong>
                            <MemberBadge
                              role={report.reported_role}
                            />
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {formatPublicId(
                              report.reported_public_id,
                            )}
                          </p>
                        </div>

                        <div className="rounded-xl bg-[#1e1f22] p-3">
                          <p className="text-xs uppercase text-gray-500">
                            Người báo cáo
                          </p>
                          <strong className="mt-1 block">
                            {report.reporter_username}
                          </strong>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {formatPublicId(
                              report.reporter_public_id,
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border border-white/10 bg-black/15 p-4">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                          <span>#{report.channel}</span>
                          <span>
                            Tin nhắn{" "}
                            {report.message_id
                              ? `#${report.message_id}`
                              : "đã bị xóa"}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm text-gray-200">
                          {report.message_content ||
                            "[Tin nhắn chỉ có tệp đính kèm]"}
                        </p>

                        {report.attachment_url && (
                          <a
                            href={report.attachment_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15"
                          >
                            Mở tệp đính kèm
                          </a>
                        )}
                      </div>

                      {report.details && (
                        <div className="mt-3 rounded-xl bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
                          <strong>Mô tả:</strong>{" "}
                          {report.details}
                        </div>
                      )}
                    </div>

                    <div className="grid shrink-0 gap-2 sm:grid-cols-2 lg:w-48 lg:grid-cols-1">
                      {report.status === "pending" && (
                        <button
                          type="button"
                          onClick={() =>
                            void updateReportStatus(
                              report.report_id,
                              "reviewing",
                            )
                          }
                          disabled={working}
                          className="rounded-xl bg-yellow-500/15 px-4 py-2.5 text-sm font-bold text-yellow-300 hover:bg-yellow-500/25 disabled:opacity-50"
                        >
                          Đang kiểm tra
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          void deleteReportedMessage(report)
                        }
                        disabled={
                          working || !report.message_id
                        }
                        className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold hover:bg-red-500 disabled:opacity-40"
                      >
                        Xóa tin + xử lý
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void updateReportStatus(
                            report.report_id,
                            "resolved",
                          )
                        }
                        disabled={working}
                        className="rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold hover:bg-green-500 disabled:opacity-50"
                      >
                        Đánh dấu xử lý
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void updateReportStatus(
                            report.report_id,
                            "dismissed",
                          )
                        }
                        disabled={working}
                        className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/15 disabled:opacity-50"
                      >
                        Bỏ qua báo cáo
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
