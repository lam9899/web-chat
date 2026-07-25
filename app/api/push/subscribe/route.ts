import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  authenticatePushRequest,
  getSupabaseAdmin,
} from "@/utils/push-server";

export const runtime = "nodejs";

type SubscriptionBody = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

export async function POST(
  request: NextRequest,
) {
  try {
    const { user } =
      await authenticatePushRequest(request);
    const body =
      (await request.json()) as SubscriptionBody;

    const endpoint = body.endpoint?.trim();
    const p256dh = body.keys?.p256dh?.trim();
    const authKey = body.keys?.auth?.trim();

    if (!endpoint || !p256dh || !authKey) {
      return NextResponse.json(
        {
          error:
            "Dữ liệu đăng ký thông báo không hợp lệ.",
        },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();

    const { error } = await admin
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth_key: authKey,
          expiration_time:
            body.expirationTime ?? null,
          user_agent:
            request.headers.get("user-agent"),
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "endpoint",
        },
      );

    if (error) {
      return NextResponse.json(
        {
          error: `Không thể lưu thiết bị: ${error.message}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không thể đăng ký thông báo.";

    return NextResponse.json(
      {
        error:
          message === "UNAUTHORIZED"
            ? "Bạn chưa đăng nhập."
            : message,
      },
      {
        status:
          message === "UNAUTHORIZED"
            ? 401
            : 500,
      },
    );
  }
}

export async function DELETE(
  request: NextRequest,
) {
  try {
    const { user } =
      await authenticatePushRequest(request);
    const body = (await request.json()) as {
      endpoint?: string;
    };

    const endpoint = body.endpoint?.trim();

    if (!endpoint) {
      return NextResponse.json(
        {
          error: "Thiếu endpoint.",
        },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();

    const { error } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);

    if (error) {
      return NextResponse.json(
        {
          error: `Không thể xóa thiết bị: ${error.message}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không thể hủy đăng ký.";

    return NextResponse.json(
      {
        error:
          message === "UNAUTHORIZED"
            ? "Bạn chưa đăng nhập."
            : message,
      },
      {
        status:
          message === "UNAUTHORIZED"
            ? 401
            : 500,
      },
    );
  }
}
