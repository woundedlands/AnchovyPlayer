import {
  ActionIcon,
  ColorInput,
  ColorSwatch,
  Group,
  Menu,
  SegmentedControl,
  Slider,
  Switch,
  Text,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import { IconCheck, IconSettings } from "@tabler/icons-react";
import { useT, type LanguageSetting, type Messages } from "./i18n";
import { accentPresets } from "./palette";
import { maxTrackGapMs, resumeThresholds, trackGapStepMs, useSettings } from "./settingsStore";
import classes from "./SettingsMenu.module.css";

export function SettingsMenu() {
  const settings = useSettings();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const t = useT();
  const formatGap = (ms: number) => gapLabel(ms, t);

  return (
    <Menu position="bottom-end" width={320} shadow="md" closeOnItemClick={false}>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label={t.settings}>
          <IconSettings size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown className={classes.dropdown}>
        <Switch
          label={t.playOnFocus}
          description={t.playOnFocusHint}
          checked={settings.playOnFocus}
          onChange={(event) => settings.update({ playOnFocus: event.currentTarget.checked })}
        />
        <Switch
          label={t.closeToTray}
          description={t.closeToTrayHint}
          checked={settings.closeToTray}
          onChange={(event) => settings.update({ closeToTray: event.currentTarget.checked })}
        />
        <Switch
          label={t.reopenLastFolder}
          description={t.reopenLastFolderHint}
          checked={settings.reopenLastFolder}
          onChange={(event) => settings.update({ reopenLastFolder: event.currentTarget.checked })}
        />
        <div>
          <Group justify="space-between">
            <Text size="sm">{t.resume}</Text>
            <Text size="sm" c="dimmed">
              {resumeLabel(settings.resumeMinSeconds, t)}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" mb={10}>
            {t.resumeHint}
          </Text>
          {/* Steps, not seconds: the thresholds are far apart (10 s ... 10 min). */}
          <Slider
            min={0}
            max={resumeThresholds.length - 1}
            step={1}
            value={Math.max(0, resumeThresholds.indexOf(settings.resumeMinSeconds))}
            onChange={(index) => settings.update({ resumeMinSeconds: resumeThresholds[index] })}
            label={(index) => resumeLabel(resumeThresholds[index], t)}
            marks={resumeThresholds.map((_, index) => ({ value: index }))}
          />
        </div>
        <div>
          <Group justify="space-between">
            <Text size="sm">{t.trackGap}</Text>
            <Text size="sm" c="dimmed">
              {formatGap(settings.trackGapMs)}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" mb={10}>
            {t.trackGapHint}
          </Text>
          <Slider
            min={0}
            max={maxTrackGapMs}
            step={trackGapStepMs}
            value={settings.trackGapMs}
            onChange={(trackGapMs) => settings.update({ trackGapMs })}
            label={formatGap}
          />
        </div>
        <div>
          <Text size="sm" mb={8}>
            {t.accentColour}
          </Text>
          <Group gap={8}>
            {accentPresets.map((preset) => (
              <Tooltip key={preset.color} label={preset.name}>
                <ColorSwatch
                  component="button"
                  color={preset.color}
                  size={26}
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => settings.update({ accentColor: preset.color })}
                >
                  {settings.accentColor === preset.color && <IconCheck size={14} color="white" />}
                </ColorSwatch>
              </Tooltip>
            ))}
          </Group>
          <ColorInput
            mt={10}
            size="xs"
            format="hex"
            // Inside the menu: a portal would count as a click outside and close it.
            popoverProps={{ withinPortal: false }}
            // Uncontrolled, re-created when a swatch changes the colour.
            key={settings.accentColor}
            defaultValue={settings.accentColor}
            onChangeEnd={(color) => {
              // The palette clamps chroma, so any colour works; only malformed input is ignored.
              if (/^#[0-9a-f]{6}$/i.test(color)) {
                settings.update({ accentColor: color.toLowerCase() });
              }
            }}
          />
        </div>
        <div>
          <Text size="sm" mb={6}>
            {t.theme}
          </Text>
          <SegmentedControl
            fullWidth
            value={colorScheme}
            onChange={(value) => setColorScheme(value as "auto" | "light" | "dark")}
            data={[
              { value: "auto", label: t.themeSystem },
              { value: "light", label: t.themeLight },
              { value: "dark", label: t.themeDark },
            ]}
          />
        </div>
        <div>
          <Text size="sm" mb={6}>
            {t.language}
          </Text>
          <SegmentedControl
            fullWidth
            value={settings.language}
            onChange={(value) => settings.update({ language: value as LanguageSetting })}
            data={[
              { value: "auto", label: t.languageSystem },
              { value: "en", label: "English" },
              { value: "ru", label: "Русский" },
            ]}
          />
        </div>
      </Menu.Dropdown>
    </Menu>
  );
}

function resumeLabel(seconds: number, t: Messages): string {
  if (seconds === 0) {
    return t.resumeOff;
  }

  return t.resumeFrom(seconds < 60 ? t.secondsShort(seconds) : t.minutesShort(seconds / 60));
}

function gapLabel(ms: number, t: Messages): string {
  return ms === 0 ? t.none : t.seconds((ms / 1000).toFixed(2));
}
