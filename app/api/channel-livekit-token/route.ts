import "server-only";

import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RequestBody = {
  channel_id?: string;
};

type ChannelRow = {
  id: string;
  name: string;
  channel_type: "text" | "voice" | "both";
};

export async function POST(request: NextRequest) {
  try {
    const authorization =
      request.headers.get("authorization");
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
    const channelId = body.channel_id?.trim();

    if (!channelId) {
      return NextResponse.json(
        { error: "Thiếu mã kênh." },
        { status: 400 },
      );
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabasePublishableKey =
      process.env
        .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const liveKitUrl = process.env.LIVEKIT_URL;
    const liveKitApiKey =
      process.env.LIVEKIT_API_KEY;
    const liveKitApiSecret =
      process.env.LIVEKIT_API_SECRET;

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
    } = await supabase.auth.getUser(
      userAccessToken,
    );

    if (userError || !user) {
      return NextResponse.json(
        { error: "Phiên đăng nhập không hợp lệ." },
        { status: 401 },
      );
    }

    const {
      data: channelRows,
      error: channelError,
    } = await supabase.rpc(
      "get_channel_detail",
      {
        p_channel_id: channelId,
      },
    );

    const channel = (
      Array.isArray(channelRows)
        ? channelRows[0]
        : null
    ) as ChannelRow | null;

    if (channelError || !channel) {
      return NextResponse.json(
        {
          error:
            "Kênh không tồn tại hoặc bạn không có quyền tham gia.",
        },
        { status: 403 },
      );
    }

    if (
      channel.channel_type !== "voice" &&
      channel.channel_type !== "both"
    ) {
      return NextResponse.json(
        {
          error:
            "Kênh này không hỗ trợ đàm thoại.",
        },
        { status: 409 },
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    const roomName = `talk-channel-${channel.id}`;

    const token = new AccessToken(
      liveKitApiKey,
      liveKitApiSecret,
      {
        identity: user.id,
        name:
          profile?.username ??
          user.email?.split("@")[0] ??
          "Thành viên",
        metadata: JSON.stringify({
          avatar_url: profile?.avatar_url ?? "",
        }),
        ttl: "2h",
      },
    );

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return NextResponse.json({
      server_url: liveKitUrl,
      participant_token: await token.toJwt(),
      room_name: roomName,
      channel_name: channel.name,
    });
  } catch (error) {
    console.error(
      "Channel LiveKit token error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Không thể tạo kết nối đàm thoại.",
      },
      { status: 500 },
    );
  }
}
