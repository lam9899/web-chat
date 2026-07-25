"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

type ConnectionDetails = {
  server_url: string;
  participant_token: string;
  room_name: string;
  channel_name: string;
};

type ChannelVoiceRoomProps = {
  channelId: string;
  channelName: string;
  voiceOnly?: boolean;
};

type ChannelVoiceStageProps = {
  channelName: string;
  voiceOnly: boolean;
  onLeave: () => void;
};

function ChannelVoiceStage({
  channelName,
  voiceOnly,
  onLeave,
}: ChannelVoiceStageProps) {
  const [speakerMuted, setSpeakerMuted] =
    useState(false);
  const [
    showDeviceSettings,
    setShowDeviceSettings,
  ] = useState(false);

  useEffect(() => {
    if (!showDeviceSettings) return;

    function closeOnEscape(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        setShowDeviceSettings(false);
      }
    }

    window.addEventListener(
      "keydown",
      closeOnEscape,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        closeOnEscape,
      );
    };
  }, [showDeviceSettings]);

  const tracks = useTracks([
    {
      source: Track.Source.Camera,
      withPlaceholder: true,
    },
    {
      source: Track.Source.ScreenShare,
      withPlaceholder: false,
    },
  ]);

  const participantCount = useMemo(
    () =>
      tracks.filter(
        (track) =>
          track.source === Track.Source.Camera,
      ).length,
    [tracks],
  );

  return (
    <section
      className={`channel-voice-stage overflow-hidden rounded-3xl border border-indigo-400/20 bg-[#17181c] shadow-2xl ${
        voiceOnly ? "min-h-[68vh]" : "h-[430px]"
      }`}
    >
      <header className="flex h-14 items-center gap-3 border-b border-white/10 bg-[#202126] px-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-lg">
          🔊
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-black sm:text-base">
            {channelName}
          </h2>
          <p className="text-[11px] text-gray-400">
            Đàm thoại chung · tự kết nối lại khi mạng gián đoạn
          </p>
        </div>

        <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold text-green-300">
          {participantCount} người
        </span>
      </header>

      <div className="flex h-[calc(100%-112px)] min-h-0 flex-col p-2 sm:p-3">
        {tracks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-indigo-500/15 text-4xl">
                🎙️
              </div>
              <p className="mt-4 font-bold">
                Đang kết nối phòng thoại...
              </p>
            </div>
          </div>
        ) : (
          <GridLayout
            tracks={tracks}
            className="h-full w-full gap-2 sm:gap-3"
          >
            <ParticipantTile className="overflow-hidden rounded-2xl border border-white/10 bg-[#26272c] shadow-lg" />
          </GridLayout>
        )}
      </div>

      <footer className="relative z-40 flex h-14 items-center justify-center border-t border-white/10 bg-[#202126] px-2">
        <div className="flex max-w-full items-center justify-center gap-1.5 [&_.lk-button]:!h-10 [&_.lk-button]:!min-w-10 [&_.lk-button]:!rounded-xl [&_.lk-button]:!border-white/10 [&_.lk-button]:!bg-white/10 [&_.lk-button]:!px-3 [&_.lk-button]:!text-white [&_.lk-button:hover]:!bg-white/15 [&_.lk-button-group-menu]:!hidden [&_.lk-control-bar]:!gap-1 [&_.lk-control-bar]:!border-0 [&_.lk-control-bar]:!bg-transparent [&_.lk-control-bar]:!p-0">
          <ControlBar
            variation="minimal"
            saveUserChoices
            controls={{
              microphone: true,
              camera: true,
              screenShare: true,
              chat: false,
              leave: false,
            }}
          />

          <button
            type="button"
            onClick={() =>
              setSpeakerMuted(
                (current) => !current,
              )
            }
            title={
              speakerMuted
                ? "Bật loa"
                : "Tắt loa"
            }
            aria-pressed={speakerMuted}
            className={`flex h-10 min-w-10 items-center justify-center rounded-xl border px-3 transition ${
              speakerMuted
                ? "border-red-400/30 bg-red-500/20"
                : "border-white/10 bg-white/10 hover:bg-white/15"
            }`}
          >
            {speakerMuted ? "🔇" : "🔊"}
          </button>

          <button
            type="button"
            onClick={() =>
              setShowDeviceSettings(true)
            }
            title="Cài đặt thiết bị"
            className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-white/10 bg-white/10 px-3 hover:bg-white/15"
          >
            ⚙️
          </button>

          <button
            type="button"
            onClick={onLeave}
            className="h-10 rounded-xl bg-red-600 px-4 text-sm font-black hover:bg-red-500"
          >
            📵 Rời phòng
          </button>
        </div>
      </footer>

      {showDeviceSettings && (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Cài đặt thiết bị phòng thoại"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget
            ) {
              setShowDeviceSettings(false);
            }
          }}
        >
          <section className="w-full max-w-md overflow-visible rounded-3xl border border-white/10 bg-[#1b1c21] p-5 text-white shadow-2xl [&_.lk-button]:!flex [&_.lk-button]:!h-12 [&_.lk-button]:!w-full [&_.lk-button]:!items-center [&_.lk-button]:!justify-between [&_.lk-button]:!rounded-xl [&_.lk-button]:!border-white/10 [&_.lk-button]:!bg-white/10 [&_.lk-button]:!px-4 [&_.lk-button]:!text-left [&_.lk-button]:!text-white [&_.lk-button:hover]:!bg-white/15 [&_.lk-device-menu]:!z-[400] [&_.lk-device-menu]:!max-h-[45vh] [&_.lk-device-menu]:!overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-black">
                  Cài đặt thiết bị
                </h3>
                <p className="mt-1 text-sm text-gray-400">
                  Chọn micro, loa và camera.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowDeviceSettings(false)
                }
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-xl hover:bg-white/15"
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-black uppercase text-gray-400">
                  Microphone
                </label>
                <MediaDeviceMenu kind="audioinput">
                  🎙 Chọn microphone
                </MediaDeviceMenu>
              </div>

              <div>
                <label className="mb-2 block text-xs font-black uppercase text-gray-400">
                  Loa
                </label>
                <MediaDeviceMenu kind="audiooutput">
                  🔊 Chọn loa
                </MediaDeviceMenu>
              </div>

              <div>
                <label className="mb-2 block text-xs font-black uppercase text-gray-400">
                  Camera
                </label>
                <MediaDeviceMenu kind="videoinput">
                  📷 Chọn camera
                </MediaDeviceMenu>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setShowDeviceSettings(false)
              }
              className="mt-6 h-11 w-full rounded-xl bg-indigo-500 font-black hover:bg-indigo-400"
            >
              Xong
            </button>
          </section>
        </div>
      )}

      <RoomAudioRenderer muted={speakerMuted} />

      <style jsx global>{`
        .channel-voice-stage
          .lk-participant-tile[data-lk-speaking="true"] {
          outline: 3px solid rgb(34 197 94);
          outline-offset: -3px;
          box-shadow: 0 0 0 4px
            rgb(34 197 94 / 0.16);
        }

        .channel-voice-stage
          .lk-participant-tile {
          transition:
            outline-color 160ms ease,
            box-shadow 160ms ease;
        }
      `}</style>
    </section>
  );
}

export default function ChannelVoiceRoom({
  channelId,
  channelName,
  voiceOnly = false,
}: ChannelVoiceRoomProps) {
  const [connection, setConnection] =
    useState<ConnectionDetails | null>(null);
  const [joining, setJoining] = useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");

  async function joinRoom() {
    if (joining || connection) return;

    setJoining(true);
    setErrorMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error(
          "Bạn cần đăng nhập lại.",
        );
      }

      const response = await fetch(
        "/api/channel-livekit-token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            channel_id: channelId,
          }),
        },
      );

      const result = (await response.json()) as
        | ConnectionDetails
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in result && result.error
            ? result.error
            : "Không thể tham gia phòng thoại.",
        );
      }

      setConnection(
        result as ConnectionDetails,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Không thể tham gia phòng thoại.",
      );
    } finally {
      setJoining(false);
    }
  }

  if (!connection) {
    return (
      <section className="mb-5 rounded-3xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/15 to-cyan-500/10 p-5 shadow-xl sm:p-6">
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-indigo-500/20 text-4xl shadow-inner">
            🎙️
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-black">
              Đàm thoại chung
            </h2>
            <p className="mt-2 text-sm leading-6 text-indigo-100/75">
              Cùng nói chuyện, bật camera hoặc chia sẻ màn hình với các thành viên đang ở trong kênh.
            </p>

            {errorMessage && (
              <p className="mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">
                {errorMessage}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void joinRoom()}
            disabled={joining}
            className="h-12 shrink-0 rounded-2xl bg-green-600 px-6 font-black text-white shadow-lg hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {joining
              ? "Đang kết nối..."
              : "🎙 Tham gia"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="mb-5">
      <LiveKitRoom
        serverUrl={connection.server_url}
        token={connection.participant_token}
        connect
        audio
        video={false}
        onDisconnected={() =>
          setConnection(null)
        }
        onError={(error) =>
          setErrorMessage(error.message)
        }
        data-lk-theme="default"
      >
        <ChannelVoiceStage
          channelName={channelName}
          voiceOnly={voiceOnly}
          onLeave={() => setConnection(null)}
        />
      </LiveKitRoom>

      {errorMessage && (
        <p className="mt-2 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
