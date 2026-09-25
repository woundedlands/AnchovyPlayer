import { ActionIcon, Menu, SegmentedControl, Switch, Text, useMantineColorScheme } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import type { Settings } from "./useSettings";
import classes from "./SettingsMenu.module.css";

export function SettingsMenu({ settings }: { settings: Settings }) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <Menu position="bottom-end" width={280} shadow="md" closeOnItemClick={false}>
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
          onChange={(event) => settings.setPlayOnFocus(event.currentTarget.checked)}
        />
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
