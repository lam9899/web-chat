import { createClient } from "@supabase/supabase-js";
import {
  NextRequest,
  NextResponse,
} from "next/server";

export const runtime = "nodejs";

type EndCallBody = {
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

    const body = (await request.json()) as EndCallBody;
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

    if (!supabaseUrl || !supabaseKey) {
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

    const { error } = await supabase.rpc(
      "end_private_call",
      {
        p_call_id: callId,
      },
    );

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("End call error:", error);

    return NextResponse.json(
      { error: "Failed to end call" },
      { status: 500 },
    );
  }
}
