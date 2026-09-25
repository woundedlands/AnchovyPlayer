import { useEffect, useRef, useState } from "react";
import { useComputedColorScheme } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { useSettings } from "../../core/settingsStore";
import { loadWaveform, type Waveform as WaveformData } from "./api";
import classes from "./Waveform.module.css";

interface WaveformProps {
  path: string | null;
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
}

const laneGap = 6;

export function Waveform({ path, position, duration, onSeek }: WaveformProps) {
  const [data, setData] = useState<WaveformData | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { ref: frame, width, height } = useElementSize();
  const scheme = useComputedColorScheme("dark");
  // Canvas colours come from CSS variables, which a canvas does not follow: redraw on theme changes.
  const accentColor = useSettings((state) => state.accentColor);
  const dragging = useRef(false);

  useEffect(() => {
    setData(null);
    if (path === null) {
      return;
    }
    let cancelled = false;
    loadWaveform(path)
      .then((loaded) => {
        if (!cancelled) {
          setData(loaded);
        }
      })
      .catch(() => {
        // The player bar already reports files that cannot be decoded; an empty waveform is enough here.
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  const total = duration > 0 ? duration : (data?.duration ?? 0);
  const progress = total > 0 ? Math.min(position / total, 1) : 0;

  useEffect(() => {
    const element = canvas.current;
    if (!element || width === 0 || height === 0) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    // Assigning a canvas size reallocates and clears it even when unchanged; this runs every frame
    // while the playhead moves, so only resize when the size really changed.
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (element.width !== pixelWidth || element.height !== pixelHeight) {
      element.width = pixelWidth;
      element.height = pixelHeight;
    }
    const context = element.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(element);
    const waveColor = styles.getPropertyValue("--app-wave").trim();
    const playedColor = styles.getPropertyValue("--app-wave-played").trim();
    // The played part runs through the accent's shades left to right, a subtle sheen along time.
    const played = context.createLinearGradient(0, 0, width, 0);
    played.addColorStop(0, styles.getPropertyValue("--app-wave-played-start").trim() || playedColor);
    played.addColorStop(1, styles.getPropertyValue("--app-wave-played-end").trim() || playedColor);
    if (!data) {
      context.fillStyle = waveColor;
      context.fillRect(0, height / 2 - 0.5, width, 1);
      return;
    }

    const laneHeight = (height - laneGap * (data.channels - 1)) / data.channels;
    const playedX = progress * width;
    for (let channel = 0; channel < data.channels; channel++) {
      const top = channel * (laneHeight + laneGap);
      const center = top + laneHeight / 2;
      const half = laneHeight / 2;
      // One column per device pixel column; each takes the extremes of the bins it covers.
      const columns = Math.max(1, Math.floor(width));
      for (let column = 0; column < columns; column++) {
        const fromBin = Math.floor((column / columns) * data.bins);
        const toBin = Math.max(fromBin + 1, Math.floor(((column + 1) / columns) * data.bins));
        let min = 0;
        let max = 0;
        for (let bin = fromBin; bin < toBin; bin++) {
          const at = (channel * data.bins + bin) * 2;
          min = Math.min(min, data.peaks[at]);
          max = Math.max(max, data.peaks[at + 1]);
        }
        const y1 = center - Math.min(max, 1) * half;
        const y2 = center - Math.max(min, -1) * half;
        context.fillStyle = column < playedX ? played : waveColor;
        context.fillRect(column, y1, 1, Math.max(1, y2 - y1));
      }
    }
    if (total > 0) {
      context.fillStyle = playedColor;
      context.fillRect(Math.min(playedX, width - 2), 0, 2, height);
    }
  }, [data, width, height, progress, total, scheme, accentColor]);

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (total <= 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    onSeek(fraction * total);
  };

  return (
    <div
      ref={frame}
      className={classes.root}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) {
          seekFromPointer(event);
        }
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      <canvas ref={canvas} className={classes.canvas} />
    </div>
  );
}
