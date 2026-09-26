import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import {
  ActionIcon,
  Checkbox,
  ColorPicker,
  ColorSwatch,
  FloatingIndicator,
  Menu,
  Popover,
  SegmentedControl,
  Slider,
  Tabs,
  TextInput,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconColorPicker,
  IconDeviceDesktop,
  IconHeadphones,
  IconMoon,
  IconPalette,
  IconSettings,
  IconSun,
  IconWorld,
} from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT, type LanguageSetting, type Messages } from "./i18n";
import { accentPresets } from "./palette";
import { maxTrackGapMs, pulseIntensityStep, resumeThresholds, trackGapStepMs, useSettings } from "./settingsStore";
import flagGb from "./flags/gb.svg";
import flagRu from "./flags/ru.svg";
import classes from "./SettingsMenu.module.css";

const hexColor = /^#[0-9a-f]{6}$/i;
/** Must match the opener:allow-open-url scope in src-tauri/capabilities/default.json. */
const repositoryUrl = "https://github.com/woundedlands/AnchovyPlayer";

const tabs = ["general", "playback", "look"] as const;
type Tab = (typeof tabs)[number];

export function SettingsMenu() {
  const t = useT();

  return (
    <Menu position="bottom-end" width={360} shadow="md" closeOnItemClick={false}>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label={t.settings}>
          <IconSettings size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown className={classes.dropdown}>
        <SettingsTabs />
        <UnstyledButton className={classes.version} onClick={() => void openUrl(repositoryUrl)}>
          {t.version(__APP_VERSION__)}
        </UnstyledButton>
      </Menu.Dropdown>
    </Menu>
  );
}

/** Mounted with the dropdown, so every opening starts on the first tab with fresh measurements. */
function SettingsTabs() {
  const settings = useSettings();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const t = useT();
  const customAccent = !accentPresets.some((preset) => preset.color === settings.accentColor);
  const [tab, setTab] = useState<Tab>("general");
  const [tabList, setTabList] = useState<HTMLDivElement | null>(null);
  const [tabButtons, setTabButtons] = useState<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const panels = useRef<Partial<Record<Tab, HTMLDivElement | null>>>({});
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  // The carousel viewport takes the current panel's height, so the menu grows and shrinks with the
  // slide instead of keeping the tallest panel's empty space. Measured before paint: no jump on open.
  useLayoutEffect(() => {
    const panel = panels.current[tab];
    if (!panel) {
      throw new Error(`Settings panel "${tab}" is not mounted`);
    }
    setPanelHeight(panel.offsetHeight);
    const observer = new ResizeObserver(() => setPanelHeight(panel.offsetHeight));
    observer.observe(panel);

    return () => observer.disconnect();
  }, [tab]);

  const selectTab = (value: string | null) => {
    const next = tabs.find((candidate) => candidate === value);
    if (next) {
      setTab(next);
    }
  };

  // Created once: inline ref callbacks would re-attach, and set state, on every render.
  const [tabRefs] = useState(() => {
    const refFor = (value: Tab) => (node: HTMLButtonElement | null) =>
      setTabButtons((buttons) => (buttons[value] === node ? buttons : { ...buttons, [value]: node }));

    return {
      general: refFor("general"),
      playback: refFor("playback"),
      look: refFor("look"),
    };
  });
  const panelProps = (value: Tab) => ({
    current: value === tab,
    ref: (node: HTMLDivElement | null) => {
      panels.current[value] = node;
    },
  });

  return (
    <Tabs variant="none" value={tab} onChange={selectTab}>
      <Tabs.List ref={setTabList} className={classes.tabList} grow>
        <Tabs.Tab
          value="general"
          ref={tabRefs.general}
          className={classes.tab}
          leftSection={<IconSettings size={16} />}
        >
          {t.tabGeneral}
        </Tabs.Tab>
        <Tabs.Tab
          value="playback"
          ref={tabRefs.playback}
          className={classes.tab}
          leftSection={<IconHeadphones size={16} />}
        >
          {t.tabPlayback}
        </Tabs.Tab>
        <Tabs.Tab value="look" ref={tabRefs.look} className={classes.tab} leftSection={<IconPalette size={16} />}>
          {t.tabLook}
        </Tabs.Tab>
        {/* Same duration and easing as the slides (--settings-slide in the CSS). */}
        <FloatingIndicator
          target={tabButtons[tab] ?? null}
          parent={tabList}
          transitionDuration={220}
          className={classes.tabIndicator}
        />
      </Tabs.List>

      <div className={classes.viewport} style={{ height: panelHeight ?? undefined }}>
        <div className={classes.track} style={{ transform: `translateX(${-tabs.indexOf(tab) * 100}%)` }}>
          <Panel {...panelProps("general")}>
            <Row label={t.language}>
              <Cycler<LanguageSetting>
                value={settings.language}
                onChange={(language) => settings.update({ language })}
                options={[
                  {
                    value: "auto",
                    label: t.languageSystem,
                    icon: <IconWorld size={16} />,
                  },
                  {
                    value: "en",
                    label: "English",
                    icon: <Flag src={flagGb} />,
                  },
                  {
                    value: "ru",
                    label: "Русский",
                    icon: <Flag src={flagRu} />,
                  },
                ]}
              />
            </Row>
            <Toggle
              label={t.closeToTray}
              hint={t.closeToTrayHint}
              checked={settings.closeToTray}
              onChange={(closeToTray) => settings.update({ closeToTray })}
            />
            <Toggle
              label={t.reopenLastFolder}
              hint={t.reopenLastFolderHint}
              checked={settings.reopenLastFolder}
              onChange={(reopenLastFolder) => settings.update({ reopenLastFolder })}
            />
          </Panel>
          <Panel {...panelProps("playback")}>
            <Toggle
              label={t.playOnFocus}
              hint={t.playOnFocusHint}
              checked={settings.playOnFocus}
              onChange={(playOnFocus) => settings.update({ playOnFocus })}
            />
            <div>
              <div className={classes.valueHeader}>
                <span>{t.trackGap}</span>
                <span className={classes.value}>{gapLabel(settings.trackGapMs, t)}</span>
              </div>
              <div className={classes.hint}>{t.trackGapHint}</div>
              <Slider
                className={classes.slider}
                min={0}
                max={maxTrackGapMs}
                step={trackGapStepMs}
                value={settings.trackGapMs}
                onChange={(trackGapMs) => settings.update({ trackGapMs })}
                label={null}
              />
            </div>
            <div>
              <div className={classes.valueHeader}>{t.resume}</div>
              <div className={classes.hint}>{t.resumeHint}</div>
              {/* Discrete thresholds far apart (10 s ... 10 min): choices, not a range. */}
              <SegmentedControl
                className={classes.choice}
                fullWidth
                size="xs"
                value={String(settings.resumeMinSeconds)}
                onChange={(value) => settings.update({ resumeMinSeconds: Number(value) })}
                data={resumeThresholds.map((seconds) => ({
                  value: String(seconds),
                  label: resumeLabel(seconds, t),
                }))}
              />
            </div>
          </Panel>

          <Panel {...panelProps("look")}>
            <div>
              <div className={classes.valueHeader}>{t.accentColour}</div>
              <div className={classes.swatches}>
                {accentPresets.map((preset) => (
                  <Tooltip key={preset.color} label={preset.name}>
                    <ColorSwatch
                      component="button"
                      className={classes.swatch}
                      color={preset.color}
                      size={28}
                      onClick={() => settings.update({ accentColor: preset.color })}
                    >
                      {settings.accentColor === preset.color && <IconCheck size={14} className={classes.swatchCheck} />}
                    </ColorSwatch>
                  </Tooltip>
                ))}
                <CustomAccent
                  color={settings.accentColor}
                  active={customAccent}
                  label={t.customColour}
                  onChange={(accentColor) => settings.update({ accentColor })}
                />
              </div>
            </div>
            <Row label={t.theme}>
              <Cycler
                value={colorScheme}
                onChange={setColorScheme}
                options={[
                  {
                    value: "auto",
                    label: t.themeSystem,
                    icon: <IconDeviceDesktop size={16} />,
                  },
                  {
                    value: "light",
                    label: t.themeLight,
                    icon: <IconSun size={16} />,
                  },
                  {
                    value: "dark",
                    label: t.themeDark,
                    icon: <IconMoon size={16} />,
                  },
                ]}
              />
            </Row>
            <Intensity
              label={t.rowPulse}
              hint={t.rowPulseHint}
              value={settings.rowPulseIntensity}
              onChange={(rowPulseIntensity) => settings.update({ rowPulseIntensity })}
            />
            <Intensity
              label={t.waveformPulse}
              hint={t.waveformPulseHint}
              value={settings.waveformPulseIntensity}
              onChange={(waveformPulseIntensity) => settings.update({ waveformPulseIntensity })}
            />
          </Panel>
        </div>
      </div>
    </Tabs>
  );
}

interface PanelProps {
  current: boolean;
  ref: Ref<HTMLDivElement>;
  children: ReactNode;
}

/** One slide of the carousel. Off-screen slides are inert: Tab must not reach their controls. */
function Panel({ current, ref, children }: PanelProps) {
  return (
    <div ref={ref} role="tabpanel" className={classes.panel} inert={!current} aria-hidden={!current}>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={classes.row}>
      <span>{label}</span>
      {children}
    </div>
  );
}

interface ToggleProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** A checkbox whose whole row is one <label>: a click anywhere on it toggles, gaps included. */
function Toggle({ label, hint, checked, onChange }: ToggleProps) {
  return (
    <label className={classes.toggle}>
      <Checkbox checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span className={classes.toggleText}>
        <span>{label}</span>
        <span className={classes.hint}>{hint}</span>
      </span>
    </label>
  );
}

interface IntensityProps {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
}

/** A taste setting: from off to full strength rather than on/off. */
function Intensity({ label, hint, value, onChange }: IntensityProps) {
  const t = useT();

  return (
    <div>
      <div className={classes.valueHeader}>
        <span>{label}</span>
        <span className={classes.value}>{value === 0 ? t.off : `${Math.round(value * 100)}%`}</span>
      </div>
      <div className={classes.hint}>{hint}</div>
      <Slider
        className={classes.slider}
        min={0}
        max={1}
        step={pulseIntensityStep}
        value={value}
        onChange={onChange}
        label={null}
      />
    </div>
  );
}

interface CyclerOption<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
}

interface CyclerProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: CyclerOption<T>[];
}

/** ‹ current ›: one choice shown with its icon; the arrows (or a click on it) step through and wrap. */
function Cycler<T extends string>({ value, onChange, options }: CyclerProps<T>) {
  const index = options.findIndex((option) => option.value === value);
  if (index < 0) {
    throw new Error(`Cycler has no option for value "${value}"`);
  }
  const current = options[index];
  const step = (delta: number) => onChange(options[(index + delta + options.length) % options.length].value);

  return (
    <div className={classes.cycler}>
      <ActionIcon variant="subtle" color="gray" radius="xl" onClick={() => step(-1)}>
        <IconChevronLeft size={16} />
      </ActionIcon>
      <UnstyledButton className={classes.cyclerValue} onClick={() => step(1)}>
        <span className={classes.cyclerIcon}>{current.icon}</span>
        {current.label}
      </UnstyledButton>
      <ActionIcon variant="subtle" color="gray" radius="xl" onClick={() => step(1)}>
        <IconChevronRight size={16} />
      </ActionIcon>
    </div>
  );
}

/** Bundled SVG, not a flag emoji: Windows' emoji font has no flags and shows 🇷🇺 as the letters "RU". */
function Flag({ src }: { src: string }) {
  return <img src={src} alt="" className={classes.flag} />;
}

interface CustomAccentProps {
  color: string;
  /** The accent is not one of the presets: this swatch shows it and carries the check. */
  active: boolean;
  label: string;
  onChange: (color: string) => void;
}

/** Any colour works (the palette clamps chroma); only malformed hex input is ignored. */
function CustomAccent({ color, active, label, onChange }: CustomAccentProps) {
  return (
    // Inside the menu: a portal would count as a click outside and close it.
    <Popover position="bottom-end" withinPortal={false} shadow="md">
      <Popover.Target>
        <Tooltip label={label}>
          <UnstyledButton className={classes.customSwatch} data-active={active || undefined}>
            {active ? (
              <ColorSwatch color={color} size={28}>
                <IconCheck size={14} className={classes.swatchCheck} />
              </ColorSwatch>
            ) : (
              <IconColorPicker size={16} />
            )}
          </UnstyledButton>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className={classes.pickerDropdown}>
        <ColorPicker format="hex" value={color} onChangeEnd={onChange} />
        <TextInput
          size="xs"
          // Uncontrolled, re-created when the colour changes elsewhere.
          key={color}
          defaultValue={color}
          onBlur={(event) => {
            const value = event.currentTarget.value.trim();
            if (hexColor.test(value)) {
              onChange(value.toLowerCase());
            }
          }}
          onKeyDown={(event) => {
            // The app's global keys (letters jump to a file name) must not see typing here.
            event.stopPropagation();
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      </Popover.Dropdown>
    </Popover>
  );
}

function resumeLabel(seconds: number, t: Messages): string {
  if (seconds === 0) {
    return t.off;
  }

  return seconds < 60 ? t.secondsShort(seconds) : t.minutesShort(seconds / 60);
}

function gapLabel(ms: number, t: Messages): string {
  return ms === 0 ? t.none : t.seconds((ms / 1000).toFixed(2));
}
