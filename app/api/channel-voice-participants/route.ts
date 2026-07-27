import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  RoomServiceClient,
  TrackSource,
  type ParticipantInfo,
} from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_CHANNELS_PER_REQUEST = 30;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestBody = {
  channel_ids?: unknown;
};

type VisibleChannel = {
  id: string;
  channel_type: "text" | "voice" | "both";
};

type ProfileRow = {
  id: string;
  username: string;
  avatar_url: string | null;
};

function roomServiceUrl(liveKitUrl: string) {
  if (liveKitUrl.startsWith("wss://")) {
    return `https://${liveKitUrl.slice("wss://".length)}`;
  }

  if (liveKitUrl.startsWith("ws://")) {
    return `http://${liveKitUrl.slice("ws://".length)}`;
  }

  return liveKitUrl;
}

function metadataAvatar(participant: ParticipantInfo) {
  if (!participant.metadata) return "";

  try {
    const metadata = JSON.parse(participant.metadata) as {
      avatar_url?: unknown;
    };

    return typeof metadata.avatar_url === "string"
      ? metadata.avatar_url
      : "";
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const userAccessToken = authorization?.replace(
      /^Bearer\s+/i,
      "",
    );

    if (!userAccessToken) {
      return NextResponse.json(
        { error: "Bạn chưa đăng nhập." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as RequestBody;
    const requestedChannelIds = Array.isArray(body.channel_ids)
      ? Array.from(
          new Set(
            body.channel_ids.filter(
              (value): value is string =>
                typeof value === "string" &&
                UUID_PATTERN.test(value),
            ),
          ),
        ).slice(0, MAX_CHANNELS_PER_REQUEST)
      : [];

    if (requestedChannelIds.length === 0) {
      return NextResponse.json({ channels: {} });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabasePublishableKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const liveKitUrl = process.env.LIVEKIT_URL;
    const liveKitApiKey = process.env.LIVEKIT_API_KEY;
    const liveKitApiSecret = process.env.LIVEKIT_API_SECRET;

    if (
      !supabaseUrl ||
      !supabasePublishableKey ||
      !liveKitUrl ||
      !liveKitApiKey ||
      !liveKitApiSecret
    ) {
      return NextResponse.json(
        {
          error:
            "Máy chủ chưa cấu hình đủ Supabase hoặc LiveKit.",
        },
        { status: 500 },
      );
    }

    const supabase = createClient(
      supabaseUrl,
      supabasePublishableKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${userAccessToken}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(userAccessToken);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Phiên đăng nhập không hợp lệ." },
        { status: 401 },
      );
    }

    const { data: visibleRows, error: channelError } =
      await supabase.rpc("get_visible_channels");

    if (channelError) {
      return NextResponse.json(
        { error: "Không thể kiểm tra quyền xem kênh thoại." },
        { status: 403 },
      );
    }

    const allowedChannelIds = new Set(
      ((visibleRows ?? []) as VisibleChannel[])
        .filter(
          (channel) =>
            requestedChannelIds.includes(channel.id) &&
            (channel.channel_type === "voice" ||
              channel.channel_type === "both"),
        )
        .map((channel) => channel.id),
    );

    const roomClient = new RoomServiceClient(
      roomServiceUrl(liveKitUrl),
      liveKitApiKey,
      liveKitApiSecret,
    );
    const roomNames = Array.from(allowedChannelIds).map(
      (channelId) => `talk-channel-${channelId}`,
    );
    const activeRooms =
      roomNames.length > 0
        ? await roomClient.listRooms(roomNames)
        : [];
    const activeRoomNames = new Set(
      activeRooms.map((room) => room.name),
    );

    const participantEntries = await Promise.all(
      Array.from(allowedChannelIds).map(async (channelId) => {
        const roomName = `talk-channel-${channelId}`;

        if (!activeRoomNames.has(roomName)) {
          return [channelId, []] as const;
        }

        try {
          const participants =
            await roomClient.listParticipants(roomName);
          return [channelId, participants] as const;
        } catch {
          return [channelId, []] as const;
        }
      }),
    );

    const profileIds = Array.from(
      new Set(
        participantEntries
          .flatMap(([, participants]) =>
            participants.map((participant) => participant.identity),
          )
          .filter((identity) => UUID_PATTERN.test(identity)),
      ),
    );
    const profileById = new Map<string, ProfileRow>();

    if (profileIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", profileIds);

      for (const profile of (profiles ?? []) as ProfileRow[]) {
        profileById.set(profile.id, profile);
      }
    }

    const channels = Object.fromEntries(
      participantEntries.map(([channelId, participants]) => [
        channelId,
        participants.map((participant) => {
          const profile = profileById.get(participant.identity);
          const microphoneTrack = participant.tracks.find(
            (track) => track.source === TrackSource.MICROPHONE,
          );

          return {
            user_id: participant.identity,
            username:
              profile?.username ||
              participant.name ||
              participant.identity,
            avatar_url:
              profile?.avatar_url || metadataAvatar(participant),
            is_speaking: false,
            is_muted:
              !microphoneTrack || microphoneTrack.muted,
          };
        }),
      ]),
    );

    return NextResponse.json({ channels });
  } catch (error) {
    console.error("Channel voice participants error:", error);

    return NextResponse.json(
      { error: "Không thể tải người đang trong phòng thoại." },
      { status: 500 },
    );
  }
}
