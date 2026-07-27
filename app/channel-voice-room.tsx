"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { Participant, Track } from "livekit-client";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

type ConnectionDetails = {
  server_url: string;
  participant_token: string;
  room_name: string;
  channel_name: string;
};

export type VoiceParticipantSnapshot = {
  user_id: string;
  username: string;
  avatar_url: string;
  is_speaking: boolean;
  is_muted: boolean;
};

type Props = {
  channelId: string;
  channelName: string;
  voiceOnly?: boolean;
  joinRequestId?: number;
  onParticipantsChange?: (
    channelId: string,
    participants: VoiceParticipantSnapshot[],
  ) => void;
};

function getAvatar(participant: Participant) {
  if (!participant.metadata) return "";
  try {
    return (JSON.parse(participant.metadata) as { avatar_url?: string }).avatar_url ?? "";
  } catch {
    return "";
  }
}

function VoiceMember({ participant, last }: { participant: Participant; last: boolean }) {
  const avatar = getAvatar(participant);
  const speaking = participant.isSpeaking;
  const muted = !participant.isMicrophoneEnabled;
  const name = participant.name || participant.identity;

  return (
    <div className="relative ml-5 flex min-h-12 items-center gap-3 py-1.5">
      <span
        aria-hidden="true"
        className={`absolute -left-4 top-0 w-3 border-l border-gray-600 ${
          last ? "h-6 rounded-bl-lg border-b" : "h-full"
        }`}
      />

      <span className="relative shrink-0">
        {avatar ? (
          <img
            src={avatar}
            alt={name}
            className={`h-9 w-9 rounded-full object-cover transition ${
              speaking
                ? "ring-3 ring-green-400 ring-offset-2 ring-offset-[#232428]"
                : "ring-1 ring-white/10"
            }`}
          />
        ) : (
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-black ${
              speaking
                ? "ring-3 ring-green-400 ring-offset-2 ring-offset-[#232428]"
                : "ring-1 ring-white/10"
            }`}
          >
            {name.charAt(0).toUpperCase()}
          </span>
        )}

        <span
          className={`absolute -bottom-0.5 -left-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#232428] ${
            speaking ? "bg-green-400" : "bg-gray-400"
          }`}
          title={speaking ? "Đang nói" : "Đang trong phòng"}
        />
      </span>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-bold ${speaking ? "text-green-300" : "text-gray-200"}`}>
          {name}
        </p>
        <p className="text-[11px] text-gray-500">
          {speaking ? "Đang nói" : muted ? "Đã tắt micro" : "Đang nghe"}
        </p>
      </div>

      <span className={muted ? "text-red-300" : "text-gray-500"}>
        {muted ? "🔇" : "🎙️"}
      </span>
    </div>
  );
}

function VoiceStage({
  channelId,
  channelName,
  onLeave,
  onParticipantsChange,
}: {
  channelId: string;
  channelName: string;
  onLeave: () => void;
  onParticipantsChange?: Props["onParticipantsChange"];
}) {
  const participants = useParticipants();
  const [expanded, setExpanded] = useState(true);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const videoTracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: false },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);

  const ordered = useMemo(
    () =>
      [...participants].sort((a, b) => {
        if (a.isSpeaking !== b.isSpeaking) return a.isSpeaking ? -1 : 1;
        return (a.name || a.identity).localeCompare(b.name || b.identity, "vi");
      }),
    [participants],
  );

  const participantSnapshots = useMemo(
    () =>
      ordered.map((participant) => ({
        user_id: participant.identity,
        username:
          participant.name || participant.identity,
        avatar_url: getAvatar(participant),
        is_speaking: participant.isSpeaking,
        is_muted: !participant.isMicrophoneEnabled,
      })),
    [ordered],
  );

  useEffect(() => {
    onParticipantsChange?.(
      channelId,
      participantSnapshots,
    );
  }, [
    channelId,
    onParticipantsChange,
    participantSnapshots,
  ]);

  useEffect(() => {
    if (!showDevices) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowDevices(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [showDevices]);

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-white/10 bg-[#232428] shadow-xl">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 border-b border-white/10 bg-[#1e1f22] px-4 py-3 text-left hover:bg-[#25262b]"
      >
        <span className="text-sm text-gray-400">{expanded ? "▼" : "▶"}</span>
        <span className="text-xs font-black uppercase tracking-wide text-gray-300">Kênh thoại</span>
        <span className="ml-auto rounded-full bg-green-500/15 px-2.5 py-1 text-[11px] font-black text-green-300">
          {participants.length} người
        </span>
      </button>

      {expanded && (
        <>
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-lg">🔊</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-black">{channelName}</p>
                <p className="text-[11px] text-gray-500">Phòng trò chuyện</p>
              </div>
              <span className="h-2.5 w-2.5 rounded-full bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.8)]" />
            </div>

            <div className="mt-2">
              {ordered.map((participant, index) => (
                <VoiceMember
                  key={participant.identity}
                  participant={participant}
                  last={index === ordered.length - 1}
                />
              ))}
            </div>
          </div>

          {videoTracks.length > 0 && (
            <div className="border-t border-white/10 bg-[#17181c] p-3">
              <GridLayout tracks={videoTracks} className="min-h-48 w-full gap-3">
                <ParticipantTile className="overflow-hidden rounded-2xl border border-white/10 bg-[#26272c]" />
              </GridLayout>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-[#1e1f22] px-3 py-3 [&_.lk-button]:!h-10 [&_.lk-button]:!min-w-10 [&_.lk-button]:!rounded-xl [&_.lk-button]:!border-white/10 [&_.lk-button]:!bg-white/10 [&_.lk-button]:!px-3 [&_.lk-button]:!text-white [&_.lk-button-group-menu]:!hidden [&_.lk-control-bar]:!gap-2 [&_.lk-control-bar]:!border-0 [&_.lk-control-bar]:!bg-transparent [&_.lk-control-bar]:!p-0">
            <ControlBar
              variation="minimal"
              saveUserChoices
              controls={{ microphone: true, camera: true, screenShare: true, chat: false, leave: false }}
            />
            <button
              type="button"
              onClick={() => setSpeakerMuted((value) => !value)}
              className={`flex h-10 min-w-10 items-center justify-center rounded-xl border px-3 ${
                speakerMuted ? "border-red-400/30 bg-red-500/20" : "border-white/10 bg-white/10"
              }`}
            >
              {speakerMuted ? "🔇" : "🔊"}
            </button>
            <button
              type="button"
              onClick={() => setShowDevices(true)}
              className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-white/10 bg-white/10 px-3"
            >
              ⚙️
            </button>
            <button type="button" onClick={onLeave} className="ml-auto h-10 rounded-xl bg-red-600 px-4 text-sm font-black hover:bg-red-500">
              📵 Rời phòng
            </button>
          </div>
        </>
      )}

      {showDevices && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#1b1c21] p-5 shadow-2xl [&_.lk-button]:!flex [&_.lk-button]:!h-12 [&_.lk-button]:!w-full [&_.lk-button]:!items-center [&_.lk-button]:!justify-between [&_.lk-button]:!rounded-xl [&_.lk-button]:!border-white/10 [&_.lk-button]:!bg-white/10 [&_.lk-button]:!px-4 [&_.lk-device-menu]:!z-[400]">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black">Cài đặt thiết bị</h3>
                <p className="mt-1 text-sm text-gray-400">Chọn micro, loa và camera.</p>
              </div>
              <button type="button" onClick={() => setShowDevices(false)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-xl">×</button>
            </div>
            <div className="mt-5 space-y-4">
              <div><p className="mb-2 text-xs font-black uppercase text-gray-400">Microphone</p><MediaDeviceMenu kind="audioinput">🎙 Chọn microphone</MediaDeviceMenu></div>
              <div><p className="mb-2 text-xs font-black uppercase text-gray-400">Loa</p><MediaDeviceMenu kind="audiooutput">🔊 Chọn loa</MediaDeviceMenu></div>
              <div><p className="mb-2 text-xs font-black uppercase text-gray-400">Camera</p><MediaDeviceMenu kind="videoinput">📷 Chọn camera</MediaDeviceMenu></div>
            </div>
          </section>
        </div>
      )}

      <RoomAudioRenderer muted={speakerMuted} />
    </section>
  );
}

export default function ChannelVoiceRoom({
  channelId,
  channelName,
  joinRequestId = 0,
  onParticipantsChange,
}: Props) {
  const [connection, setConnection] = useState<ConnectionDetails | null>(null);
  const [joining, setJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const handledJoinRequestRef = useRef(0);

  const joinRoom = useCallback(async () => {
    if (joining || connection) return;
    setJoining(true);
    setErrorMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Bạn cần đăng nhập lại.");

      const response = await fetch("/api/channel-livekit-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ channel_id: channelId }),
      });
      const result = (await response.json()) as ConnectionDetails | { error?: string };
      if (!response.ok) {
        throw new Error("error" in result && result.error ? result.error : "Không thể tham gia phòng thoại.");
      }
      setConnection(result as ConnectionDetails);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể tham gia phòng thoại.");
    } finally {
      setJoining(false);
    }
  }, [channelId, connection, joining]);

  useEffect(() => {
    if (
      joinRequestId <= 0 ||
      handledJoinRequestRef.current === joinRequestId
    ) {
      return;
    }

    handledJoinRequestRef.current = joinRequestId;
    void joinRoom();
  }, [joinRequestId, joinRoom]);

  if (!connection) {
    return (
      <section className="mb-4 overflow-hidden rounded-2xl border border-white/10 bg-[#232428] shadow-xl">
        <div className="flex items-center gap-2 border-b border-white/10 bg-[#1e1f22] px-4 py-3">
          <span className="text-gray-400">▼</span>
          <span className="text-xs font-black uppercase tracking-wide text-gray-300">Kênh thoại</span>
        </div>
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-xl">🔊</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-black">{channelName}</p>
            <p className="text-xs text-gray-500">Chưa tham gia phòng trò chuyện</p>
            {errorMessage && <p className="mt-2 text-sm text-red-300">{errorMessage}</p>}
          </div>
          <button type="button" onClick={() => void joinRoom()} disabled={joining} className="h-10 rounded-xl bg-green-600 px-5 font-black hover:bg-green-500 disabled:opacity-60">
            {joining ? "Đang kết nối..." : "🎙 Tham gia"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={connection.server_url}
      token={connection.participant_token}
      connect
      audio
      video={false}
      onDisconnected={() => setConnection(null)}
      onError={(error) => setErrorMessage(error.message)}
      data-lk-theme="default"
    >
      <VoiceStage
        channelId={channelId}
        channelName={channelName}
        onLeave={() => setConnection(null)}
        onParticipantsChange={onParticipantsChange}
      />
    </LiveKitRoom>
  );
}
