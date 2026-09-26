import type { CheckboxIconProps } from "@mantine/core";
import classes from "./controls.module.css";

/** The checkbox mark app-wide (set in theme.ts): a small rounded square echoing the box, not a tick. */
export function CheckboxMark({ className }: CheckboxIconProps) {
  return <span className={`${className} ${classes.checkboxMark}`} />;
}
