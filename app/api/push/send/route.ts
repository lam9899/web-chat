import {
  NextRequest,
  NextResponse,
} from "next/server";
import webpush from "web-push";
import {
  authenticatePushRequest,
  getSupabaseAdmin,
} from "@/utils/push-server";

export const runtime = "nodejs";

type PushType =
  | "private_message"
  | "incoming_call"
  | "friend_request";

type SendBody = {
  targetUserId?: string;
  type?: PushType;
  body?: string;
  callId?: string;
  callType?: "audio" | "video";
};

type SubscriptionRow = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};

const allowedTypes = new Set<PushType>([
  "private_message",
  "incoming_call",
  "friend_request",
]);

function cleanBody(value: string | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export async function POST(
  request: NextRequest,
) {
  try {
    const { user, userClient } =
      await authenticatePushRequest(request);
    const body = (await request.json()) as SendBody;

    const targetUserId =
      body.targetUserId?.trim();
    const type = body.type;

    if (
      !targetUserId ||
      !type ||
      !allowedTypes.has(type)
    ) {
      return NextResponse.json(
        {
          error: "Yêu cầu thông báo không hợp lệ.",
        },
        { status: 400 },
      );
    }

    if (targetUserId === user.id) {
      return NextResponse.json(
        {
          error:
            "Không gửi thông báo cho chính tài khoản hiện tại.",
        },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdmin();

    if (
      type === "private_message" ||
      type === "incoming_call"
    ) {
      const {
        data: friendRows,
        error: friendError,
      } = await userClient.rpc("get_my_friends");

      if (friendError) {
        return NextResponse.json(
          {
            error:
              "Không thể xác minh quan hệ bạn bè.",
          },
          { status: 403 },
        );
      }

      const isFriend = (
        (friendRows ?? []) as Array<{
          id?: string;
        }>
      ).some(
        (friend) => friend.id === targetUserId,
      );

      if (!isFriend) {
        return NextResponse.json(
          {
            error:
              "Chỉ có thể thông báo cho bạn bè.",
          },
          { status: 403 },
        );
      }
    }

    if (type === "friend_request") {
      const {
        data: pendingRequest,
        error: requestError,
      } = await admin
        .from("friend_requests")
        .select("id")
        .eq("sender_id", user.id)
        .eq("receiver_id", targetUserId)
        .eq("status", "pending")
        .maybeSingle();

      if (requestError || !pendingRequest) {
        return NextResponse.json(
          {
            error:
              "Không tìm thấy lời mời kết bạn đang chờ.",
          },
          { status: 403 },
        );
      }
    }

    const { data: blockedRows } = await admin
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .or(
        `and(blocker_id.eq.${user.id},blocked_id.eq.${targetUserId}),and(blocker_id.eq.${targetUserId},blocked_id.eq.${user.id})`,
      )
      .limit(1);

    if ((blockedRows ?? []).length > 0) {
      return NextResponse.json({
        ok: true,
        skipped: "blocked",
      });
    }

    if (type === "private_message") {
      const { data: preference } = await admin
        .from("private_chat_preferences")
        .select("notifications_enabled")
        .eq("user_id", targetUserId)
        .eq("other_user_id", user.id)
        .maybeSingle();

      if (
        preference?.notifications_enabled === false
      ) {
        return NextResponse.json({
          ok: true,
          skipped: "muted",
        });
      }
    }

    const [
      { data: senderProfile },
      { data: subscriptions, error: subscriptionError },
    ] = await Promise.all([
      admin
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", user.id)
        .maybeSingle(),
      admin
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth_key")
        .eq("user_id", targetUserId)
        .eq("enabled", true),
    ]);

    if (subscriptionError) {
      return NextResponse.json(
        {
          error: `Không thể tải thiết bị nhận thông báo: ${subscriptionError.message}`,
        },
        { status: 500 },
      );
    }

    const targetSubscriptions =
      (subscriptions ?? []) as SubscriptionRow[];

    if (targetSubscriptions.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
      });
    }

    const senderName =
      senderProfile?.username ?? "Một thành viên";
    const senderAvatar =
      senderProfile?.avatar_url ?? "/icon.png";

    let title = "Talk Cùng Lâm DZ";
    let notificationBody =
      "Bạn có thông báo mới.";
    let url = "/";
    let tag = `talk-${type}-${user.id}`;
    let requireInteraction = false;
    let renotify = false;

    if (type === "private_message") {
      title = senderName;
      notificationBody =
        cleanBody(body.body) ||
        "Bạn có một tin nhắn mới.";
      url = `/messages?user=${user.id}`;
      tag = `private-message-${user.id}`;
    }

    if (type === "incoming_call") {
      const callTypeText =
        body.callType === "video"
          ? "video"
          : "thoại";

      title = `Cuộc gọi ${callTypeText} từ ${senderName}`;
      notificationBody =
        "Bấm vào thông báo để trả lời.";
      url = body.callId
        ? `/call/${encodeURIComponent(body.callId)}`
        : `/messages?user=${user.id}`;
      tag = body.callId
        ? `incoming-call-${body.callId}`
        : `incoming-call-${user.id}`;
      requireInteraction = true;
      renotify = true;
    }

    if (type === "friend_request") {
      title = `${senderName} muốn kết bạn`;
      notificationBody =
        "Mở danh sách lời mời để phản hồi.";
      url = "/messages";
      tag = `friend-request-${user.id}`;
    }

    const publicKey =
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey =
      process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    if (!publicKey || !privateKey || !subject) {
      return NextResponse.json(
        {
          error:
            "Máy chủ chưa cấu hình đủ VAPID.",
        },
        { status: 500 },
      );
    }

    webpush.setVapidDetails(
      subject,
      publicKey,
      privateKey,
    );

    const payload = JSON.stringify({
      title,
      body: notificationBody,
      icon: senderAvatar,
      badge: "/icon.png",
      tag,
      url,
      type,
      timestamp: Date.now(),
      requireInteraction,
      renotify,
      suppressWhenVisible: true,
      vibrate:
        type === "incoming_call"
          ? [250, 100, 250, 100, 350]
          : [180, 80, 180],
    });

    const staleIds: number[] = [];
    let sent = 0;

    await Promise.all(
      targetSubscriptions.map(
        async (subscription) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: {
                  p256dh: subscription.p256dh,
                  auth: subscription.auth_key,
                },
              },
              payload,
              {
                TTL:
                  type === "incoming_call"
                    ? 90
                    : 60 * 60,
                urgency:
                  type === "incoming_call"
                    ? "high"
                    : "normal",
              },
            );

            sent += 1;
          } catch (error) {
            const statusCode = (
              error as {
                statusCode?: number;
              }
            ).statusCode;

            if (
              statusCode === 404 ||
              statusCode === 410
            ) {
              staleIds.push(subscription.id);
              return;
            }

            console.error(
              "Lỗi gửi Web Push:",
              error,
            );
          }
        },
      ),
    );

    if (staleIds.length > 0) {
      await admin
        .from("push_subscriptions")
        .delete()
        .in("id", staleIds);
    }

    return NextResponse.json({
      ok: true,
      sent,
      removed: staleIds.length,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không thể gửi thông báo.";

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
