import type { PointerEvent } from "react";
import { maxVolume } from "../../core/settingsStore";
import classes from "./VolumeSlider.module.css";

interface VolumeSliderProps {
  value: number;
  onChange: (volume: number) => void;
}

/** A rising wedge, like VLC's: its height tells loudness at a glance. 100% sits at the middle mark. */
export function VolumeSlider({ value, onChange }: VolumeSliderProps) {
  const filledPercent = (value / maxVolume) * 100;

  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    onChange(Math.round(fraction * maxVolume * 100) / 100);
  };

  return (
    // The whole box takes the pointer, not only the wedge: at low volume there is almost nothing to hit.
    <div
      role="slider"
      aria-valuemin={0}
      aria-valuemax={maxVolume * 100}
      aria-valuenow={Math.round(value * 100)}
      className={classes.root}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        setFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          setFromPointer(event);
        }
      }}
    >
      <div className={classes.wedge}>
        <div className={classes.fill} style={{ clipPath: `inset(0 ${100 - filledPercent}% 0 0)` }} />
      </div>
      <div className={classes.unityMark} />
    </div>
  );
}
