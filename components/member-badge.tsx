export type MemberRole = "admin" | "moderator" | "member";

const roleConfig: Record<
  MemberRole,
  {
    label: string;
    title: string;
    className: string;
  }
> = {
  admin: {
    label: "AD",
    title: "Quản trị viên cao nhất",
    className:
      "border-red-400/40 bg-red-500/15 text-red-300",
  },
  moderator: {
    label: "QT",
    title: "Quản trị cộng đồng",
    className:
      "border-green-400/40 bg-green-500/15 text-green-300",
  },
  member: {
    label: "TV",
    title: "Thành viên",
    className:
      "border-white/20 bg-white/10 text-white",
  },
};

export function formatPublicId(publicId: number | null | undefined) {
  if (
    typeof publicId !== "number" ||
    !Number.isFinite(publicId)
  ) {
    return "#------";
  }

  return `#${Math.max(0, Math.trunc(publicId))
    .toString()
    .padStart(6, "0")}`;
}

export default function MemberBadge({
  role,
  className = "",
}: {
  role: MemberRole | null | undefined;
  className?: string;
}) {
  const normalizedRole: MemberRole =
    role === "admin" || role === "moderator"
      ? role
      : "member";
  const config = roleConfig[normalizedRole];

  return (
    <span
      title={config.title}
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-black leading-none tracking-wide ${config.className} ${className}`}
    >
      {config.label}
    </span>
  );
}
