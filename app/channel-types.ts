export type DynamicChannel = {
  id: string;
  slug: string;
  name: string;
  description: string;
  avatar_path: string | null;
  owner_id: string;
  visibility: "public" | "private";
  channel_type: "text" | "voice" | "both" | "game";
  is_locked: boolean;
  is_system: boolean;
  created_at: string;
  member_role: "owner" | "moderator" | "member" | "public";
  member_ids: string[];
  member_count: number;
  unread_count: number;
  can_manage: boolean;
  server_id: string | null;
};

export type ServerSummary = {
  id: string;
  name: string;
  description: string;
  avatar_path: string | null;
  owner_id: string;
  invite_code: string;
  max_members: number;
  created_at: string;
  member_role: "owner" | "moderator" | "member";
  member_ids: string[];
  member_count: number;
  can_manage: boolean;
};

export type ServerMember = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: "admin" | "moderator" | "member";
  server_role: "owner" | "moderator" | "member";
  joined_at: string;
  last_seen_at: string | null;
};

export type ServerInvitePreview = {
  id: string;
  name: string;
  description: string;
  avatar_path: string | null;
  member_count: number;
  max_members: number;
  already_member: boolean;
};

export type ChannelMember = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: "admin" | "moderator" | "member";
  channel_role: "owner" | "moderator" | "member";
  joined_at: string;
};

export type ChannelInvite = {
  invite_id: number;
  channel_id: string;
  channel_name: string;
  channel_avatar_path: string | null;
  channel_type: "text" | "voice" | "both" | "game";
  sender_id: string;
  sender_username: string;
  sender_avatar_url: string | null;
  created_at: string;
};

export type ChannelMessage = {
  id: number;
  channel_id: string;
  sender_id: string;
  sender_username: string;
  sender_avatar_url: string | null;
  sender_public_id: number;
  sender_role: "admin" | "moderator" | "member";
  content: string;
  created_at: string;
  edited_at: string | null;
};

type AvatarStorageClient = {
  storage: {
    from: (bucket: string) => {
      getPublicUrl: (path: string) => {
        data: { publicUrl: string };
      };
    };
  };
};

export function channelAvatarUrl(
  supabase: AvatarStorageClient,
  avatarPath: string | null | undefined,
) {
  if (!avatarPath) return "";

  return supabase.storage
    .from("channel-avatars")
    .getPublicUrl(avatarPath).data.publicUrl;
}

export function channelTypeLabel(
  value: DynamicChannel["channel_type"],
) {
  if (value === "voice") return "Kênh thoại";
  if (value === "both") return "Văn bản và thoại";
  if (value === "game") return "Kênh game";
  return "Kênh văn bản";
}
