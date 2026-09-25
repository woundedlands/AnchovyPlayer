import { ActionIcon, Menu, SegmentedControl, Switch, Text, useMantineColorScheme } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { trackGapOptions, useSettings } from "./settingsStore";
import classes from "./SettingsMenu.module.css";

export function SettingsMenu() {
  const settings = useSettings();
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <Menu position="bottom-end" width={300} shadow="md" closeOnItemClick={false}>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label="Settings">
          <IconSettings size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown className={classes.dropdown}>
        <Switch
          label="Play on focus"
          description="Selecting an audio file plays it"
          checked={settings.playOnFocus}
          onChange={(event) => settings.update({ playOnFocus: event.currentTarget.checked })}
        />
        <div>
          <Text size="sm">Pause between tracks</Text>
          <Text size="xs" c="dimmed" mb={6}>
            Before a repeat or the next file in the folder
          </Text>
          <SegmentedControl
            fullWidth
            value={String(settings.trackGapMs)}
            onChange={(value) => settings.update({ trackGapMs: Number(value) })}
            data={trackGapOptions.map((ms) => ({ value: String(ms), label: ms === 0 ? "None" : `${ms / 1000} s` }))}
          />
        </div>
        <div>
          <Text size="sm" mb={6}>
            Theme
          </Text>
          <SegmentedControl
            fullWidth
            value={colorScheme}
            onChange={(value) => setColorScheme(value as "auto" | "light" | "dark")}
            data={[
              { value: "auto", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
      </Menu.Dropdown>
    </Menu>
  );
}
