import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RequestBody = {
  call_id?: string;
};

export async function POST(request: NextRequest) {
  try {
    const authorization =
      request.headers.get("authorization");
    const accessToken = authorization?.replace(
      /^Bearer\s+/i,
      "",
    );

    if (!accessToken) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = (await request.json()) as RequestBody;
    const callId = body.call_id?.trim();

    if (!callId) {
      return NextResponse.json(
        { error: "Missing call_id" },
        { status: 400 },
      );
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env
        .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const liveKitUrl = process.env.LIVEKIT_URL;
    const liveKitApiKey =
      process.env.LIVEKIT_API_KEY;
    const liveKitApiSecret =
      process.env.LIVEKIT_API_SECRET;

    if (
      !supabaseUrl ||
      !supabaseKey ||
      !liveKitUrl ||
      !liveKitApiKey ||
      !liveKitApiSecret
    ) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
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
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { data: call, error: callError } =
      await supabase
        .from("call_sessions")
        .select(
          "id, caller_id, receiver_id, call_type, room_name, status",
        )
        .eq("id", callId)
        .maybeSingle();

    if (callError || !call) {
      return NextResponse.json(
        { error: "Call not found" },
        { status: 404 },
      );
    }

    if (
      user.id !== call.caller_id &&
      user.id !== call.receiver_id
    ) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
      );
    }

    if (call.status !== "accepted") {
      return NextResponse.json(
        { error: "Call is not accepted" },
        { status: 409 },
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();

    const token = new AccessToken(
      liveKitApiKey,
      liveKitApiSecret,
      {
        identity: user.id,
        name:
          profile?.username ??
          user.email?.split("@")[0] ??
          "Thành viên",
        ttl: "2h",
      },
    );

    token.addGrant({
      roomJoin: true,
      room: call.room_name,
      canPublish: true,
      canSubscribe: true,
    });

    return NextResponse.json({
      server_url: liveKitUrl,
      participant_token: await token.toJwt(),
    });
  } catch (error) {
    console.error("LiveKit token error:", error);

    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 },
    );
  }
}
