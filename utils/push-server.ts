import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

function requiredEnvironment(
  name: string,
  value: string | undefined,
) {
  if (!value) {
    throw new Error(
      `Thiếu biến môi trường ${name}.`,
    );
  }

  return value;
}

export function getSupabaseAdmin() {
  const url = requiredEnvironment(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  const secretKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey) {
    throw new Error(
      "Thiếu SUPABASE_SECRET_KEY hoặc SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function authenticatePushRequest(
  request: NextRequest,
): Promise<{
  user: User;
  userClient: SupabaseClient;
  token: string;
}> {
  const authorization =
    request.headers.get("authorization") ?? "";

  const token = authorization
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) {
    throw new Error("UNAUTHORIZED");
  }

  const url = requiredEnvironment(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  const publishableKey =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!publishableKey) {
    throw new Error(
      "Thiếu NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  const userClient = createClient(
    url,
    publishableKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
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
    error,
  } = await userClient.auth.getUser(token);

  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }

  return {
    user,
    userClient,
    token,
  };
}
