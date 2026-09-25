import { ActionIcon, Slider, Text, Tooltip } from "@mantine/core";
import {
  IconArrowsShuffle,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRepeat,
  IconRepeatOff,
  IconRepeatOnce,
  IconVolume,
  IconVolume2,
  IconVolume3,
} from "@tabler/icons-react";
import { nameOf, parentOf } from "../../core/paths";
import { maxVolume, useSettings, type RepeatMode } from "../../core/settingsStore";
import { useT, type Messages } from "../../core/i18n";
import { usePlayer } from "./playerStore";
import { Waveform } from "./Waveform";
import classes from "./PlayerBar.module.css";

interface PlayerBarProps {
  active: boolean;
  onActivate: () => void;
  /** Play/pause; with nothing loaded it starts what the list has focused (decided by the app). */
  onTogglePlay: () => void;
}

export function PlayerBar({ active, onActivate, onTogglePlay }: PlayerBarProps) {
  const player = usePlayer();
  const settings = useSettings();
  const t = useT();
  const { status, track, error } = player;
  const playing = status.state === "playing";
  const onCurrentVoice = track !== null && status.voiceId === track.voiceId;
  // The device reports position per audio block; a track that played out shows as fully played.
  const ended = track !== null && status.endedVoiceId === track.voiceId && status.state === "idle";
  const enginePosition = onCurrentVoice ? (ended ? status.duration : status.position) : 0;
  const position = player.seekTarget ?? enginePosition;
  const duration = onCurrentVoice ? status.duration : 0;

  return (
    <footer
      className={classes.root}
      data-active={active || undefined}
      onPointerDown={(event) => {
        // Transport buttons and the volume slider are a remote control: they act without taking
        // over the arrow keys, which stay with the file list.
        if (!(event.target as Element).closest("button, .mantine-Slider-root")) {
          onActivate();
        }
      }}
      onWheel={(event) => {
        event.stopPropagation();
        player.stepVolume(event.deltaY < 0 ? 1 : -1);
      }}
    >
      <div className={classes.wave}>
        <Waveform path={track?.path ?? null} position={position} duration={duration} onSeek={player.seekTo} />
      </div>

      <div className={classes.controls}>
        <div className={classes.info}>
          {error ? (
            <Text className={classes.error} truncate="end">
              {error}
            </Text>
          ) : (
            <>
              <Text className={classes.title} truncate="end">
                {track ? nameOf(track.path) : t.nothingPlaying}
              </Text>
              <Text className={classes.meta} truncate="end">
                {track ? `${formatTime(position, duration)} / ${formatTime(duration, duration)} · ${parentOf(track.path) ?? ""}` : t.spaceHint}
              </Text>
            </>
          )}
        </div>

        <div className={classes.transport}>
          <Tooltip label={settings.shuffle ? t.shuffleOn : t.shuffleOff}>
            <ActionIcon
              variant="subtle"
              size="lg"
              radius="xl"
              className={classes.toggle}
              data-on={settings.shuffle || undefined}
              onClick={player.toggleShuffle}
            >
              <IconArrowsShuffle size={20} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon variant="subtle" size="xl" radius="xl" color="gray" onClick={player.previous}>
            <IconPlayerSkipBackFilled size={22} />
          </ActionIcon>
          <ActionIcon size={56} radius="xl" className={classes.play} onClick={onTogglePlay}>
            {playing ? <IconPlayerPauseFilled size={26} /> : <IconPlayerPlayFilled size={26} />}
          </ActionIcon>
          <ActionIcon variant="subtle" size="xl" radius="xl" color="gray" onClick={player.next}>
            <IconPlayerSkipForwardFilled size={22} />
          </ActionIcon>
          <Tooltip label={`${repeatLabel(settings.repeat, t)} · Ctrl+R`}>
            <ActionIcon
              variant="subtle"
              size="lg"
              radius="xl"
              className={classes.toggle}
              data-on={settings.repeat !== "off" || undefined}
              onClick={player.cycleRepeat}
            >
              <RepeatIcon mode={settings.repeat} />
            </ActionIcon>
          </Tooltip>
        </div>

        <div className={classes.volume}>
          <VolumeIcon volume={settings.volume} />
          <Slider
            className={classes.slider}
            min={0}
            max={maxVolume}
            step={0.01}
            value={settings.volume}
            onChange={(volume) => settings.update({ volume })}
            label={(value) => `${Math.round(value * 100)}%`}
            marks={[{ value: 1 }]}
            size="sm"
          />
          <Text className={classes.percent} data-boost={settings.volume > 1 || undefined}>
            {Math.round(settings.volume * 100)}%
          </Text>
        </div>
      </div>
    </footer>
  );
}

function repeatLabel(mode: RepeatMode, t: Messages): string {
  if (mode === "current") {
    return t.repeatCurrent;
  }
  if (mode === "group") {
    return t.repeatGroup;
  }

  return t.repeatOff;
}

function RepeatIcon({ mode }: { mode: RepeatMode }) {
  if (mode === "current") {
    return <IconRepeatOnce size={20} />;
  }
  if (mode === "group") {
    return <IconRepeat size={20} />;
  }

  return <IconRepeatOff size={20} />;
}

function VolumeIcon({ volume }: { volume: number }) {
  if (volume === 0) {
    return <IconVolume3 size={20} className={classes.volumeIcon} />;
  }
  if (volume < 0.5) {
    return <IconVolume2 size={20} className={classes.volumeIcon} />;
  }

  return <IconVolume size={20} className={classes.volumeIcon} />;
}

/** Units follow the track length, so position and duration read alike: "12 ms / 40 ms", "1:05 / 3:20". */
function formatTime(seconds: number, trackLength: number): string {
  const value = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0;
  // Sound effects live below a second: milliseconds there, tenths up to ten seconds.
  if (trackLength < 1) {
    return `${Math.round(value * 1000)} ms`;
  }
  if (trackLength < 10) {
    return `${value.toFixed(1)} s`;
  }
  const whole = Math.floor(value);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
  }

  return `${minutes}:${rest}`;
}
