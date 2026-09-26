// UI text in English and Russian. English is the reference: `ru` must provide every key with the
// same shape, which TypeScript enforces. Messages with numbers are functions, so each language
// words its own plurals.

import { useSettings } from "./settingsStore";

export type LanguageSetting = "auto" | Language;
export type Language = "en" | "ru";

export const languages: Language[] = ["en", "ru"];

const en = {
  searchPlaceholder: "Search in folder",
  indexing: "Indexing folder…",
  noMatches: "No matches",
  noAudio: "No audio files here",
  results: (count: number) => (count === 1 ? "1 result" : `${count} results`),
  partialResults: "folder too large, partial results",
  selected: (count: number) => `${count} selected · Esc to clear`,
  escToClose: "Esc to close",
  parentFolder: "Parent folder · Left",
  back: "Back · Alt+Left",
  forward: "Forward · Alt+Right",
  openTrackFolder: "Show in the list",
  clickToTypePath: "Click to type a path",
  notSupported: "not supported",
  playFile: (name: string) => `Play ${name}`,

  nothingPlaying: "Nothing playing",
  spaceHint: "Space plays the focused file",
  shuffleOn: "Shuffle on",
  shuffleOff: "Shuffle off",
  mute: "Mute",
  unmute: "Unmute",
  repeatOff: "Repeat off",
  repeatCurrent: "Repeat current",
  repeatGroup: "Repeat group: selection, or the folder",

  menuPlay: "Play",
  menuOpen: "Open",
  menuCut: "Cut",
  menuCopy: "Copy",
  menuPaste: "Paste",
  menuCopyPath: (count: number) => (count === 1 ? "Copy path" : "Copy paths"),
  menuRename: "Rename",
  menuDelete: (count: number) => (count === 1 ? "Delete" : `Delete ${count} items`),
  menuReveal: "Show in Explorer",

  items: (count: number) => (count === 1 ? "1 item" : `${count} items`),
  noticeCut: (count: number) => `Cut ${en.items(count)}`,
  noticeCopied: (count: number) => `Copied ${en.items(count)}`,
  noticeMoved: (count: number) => `Moved ${en.items(count)}`,
  noticePasted: (count: number) => `Pasted ${en.items(count)}`,
  noticeTrashed: (count: number) => `${en.items(count)} moved to the Recycle Bin`,
  noticePathsCopied: (count: number) => (count === 1 ? "Path copied" : `${count} paths copied`),

  settings: "Settings",
  tabPlayback: "Playback",
  tabLook: "Look",
  tabGeneral: "General",
  playOnFocus: "Play on focus",
  playOnFocusHint: "Selecting an audio file plays it",
  closeToTray: "Keep running in the tray",
  closeToTrayHint: "Closing the window hides it; quit from the tray icon",
  rowPulse: "Pulse in the list",
  rowPulseHint: "The playing file glows with the music",
  waveformPulse: "Pulse on the waveform",
  waveformPulseHint: "The waveform brightens with the music",
  reopenLastFolder: "Reopen last folder",
  reopenLastFolderHint: "Start where the last session ended",
  resume: "Resume where you left off",
  resumeHint: "Tracks at least this long continue where they stopped",
  off: "Off",
  secondsShort: (value: number) => `${value} s`,
  minutesShort: (value: number) => `${value} min`,
  trackGap: "Pause between tracks",
  trackGapHint: "Before a repeat or the next file in the group",
  none: "None",
  seconds: (value: string) => `${value} s`,
  accentColour: "Accent colour",
  customColour: "Custom colour",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  language: "Language",
  languageSystem: "System",

  trayShow: "Show",
  trayQuit: "Quit",
};

/** The shape of `en` with literal types widened: every language returns its own strings. */
export type Messages = {
  [K in keyof typeof en]: (typeof en)[K] extends (...args: infer A) => unknown ? (...args: A) => string : string;
};

const ruPlural = new Intl.PluralRules("ru");

/** Russian noun forms for 1 / 2-4 / 5+: "файл", "файла", "файлов". */
function ruNoun(count: number, one: string, few: string, many: string): string {
  const form = ruPlural.select(count);

  return form === "one" ? one : form === "few" ? few : many;
}

const ru: Messages = {
  searchPlaceholder: "Поиск в папке",
  indexing: "Индексирую папку…",
  noMatches: "Ничего не найдено",
  noAudio: "Здесь нет аудиофайлов",
  results: (count) => `${count} ${ruNoun(count, "результат", "результата", "результатов")}`,
  partialResults: "папка слишком большая, результаты неполные",
  selected: (count) => `Выбрано: ${count} · Esc — снять`,
  escToClose: "Esc — закрыть",
  parentFolder: "Папка выше · Влево",
  back: "Назад · Alt+Влево",
  forward: "Вперёд · Alt+Вправо",
  openTrackFolder: "Показать в списке",
  clickToTypePath: "Нажмите, чтобы ввести путь",
  notSupported: "не поддерживается",
  playFile: (name) => `Воспроизвести ${name}`,

  nothingPlaying: "Ничего не играет",
  spaceHint: "Пробел — воспроизвести выбранный файл",
  shuffleOn: "Перемешивание вкл.",
  shuffleOff: "Перемешивание выкл.",
  mute: "Выключить звук",
  unmute: "Включить звук",
  repeatOff: "Повтор выкл.",
  repeatCurrent: "Повтор текущего",
  repeatGroup: "Повтор группы: выделение или папка",

  menuPlay: "Воспроизвести",
  menuOpen: "Открыть",
  menuCut: "Вырезать",
  menuCopy: "Копировать",
  menuPaste: "Вставить",
  menuCopyPath: (count) => (count === 1 ? "Копировать путь" : "Копировать пути"),
  menuRename: "Переименовать",
  menuDelete: (count) => (count === 1 ? "Удалить" : `Удалить (${count})`),
  menuReveal: "Показать в проводнике",

  items: (count) => `${count} ${ruNoun(count, "объект", "объекта", "объектов")}`,
  noticeCut: (count) => `Вырезано: ${ru.items(count)}`,
  noticeCopied: (count) => `Скопировано: ${ru.items(count)}`,
  noticeMoved: (count) => `Перемещено: ${ru.items(count)}`,
  noticePasted: (count) => `Вставлено: ${ru.items(count)}`,
  noticeTrashed: (count) => `В корзину: ${ru.items(count)}`,
  noticePathsCopied: (count) => (count === 1 ? "Путь скопирован" : `Скопировано путей: ${count}`),

  settings: "Настройки",
  tabPlayback: "Звук",
  tabLook: "Вид",
  tabGeneral: "Общие",
  playOnFocus: "Играть при выборе",
  playOnFocusHint: "Выбор аудиофайла сразу его воспроизводит",
  closeToTray: "Работать в трее",
  closeToTrayHint: "Закрытие окна прячет его; выход — через значок в трее",
  rowPulse: "Пульс в списке",
  rowPulseHint: "Играющий файл светится в такт музыке",
  waveformPulse: "Пульс на волне",
  waveformPulseHint: "Волна светлеет в такт музыке",
  reopenLastFolder: "Открывать последнюю папку",
  reopenLastFolderHint: "Начинать там, где закончилась прошлая сессия",
  resume: "Продолжать с места остановки",
  resumeHint: "Треки не короче выбранного продолжаются с места остановки",
  off: "Выкл.",
  secondsShort: (value) => `${value} с`,
  minutesShort: (value) => `${value} мин`,
  trackGap: "Пауза между треками",
  trackGapHint: "Перед повтором или следующим файлом группы",
  none: "Нет",
  seconds: (value) => `${value} с`,
  accentColour: "Цвет акцента",
  customColour: "Свой цвет",
  theme: "Тема",
  themeSystem: "Системная",
  themeLight: "Светлая",
  themeDark: "Тёмная",
  language: "Язык",
  languageSystem: "Системный",

  trayShow: "Показать",
  trayQuit: "Выход",
};

const dictionaries: Record<Language, Messages> = { en, ru };

/** The system language if we have it, English otherwise. */
export function systemLanguage(): Language {
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function resolveLanguage(setting: LanguageSetting): Language {
  return setting === "auto" ? systemLanguage() : setting;
}

/** Messages for React components; re-renders when the language setting changes. */
export function useT(): Messages {
  const setting = useSettings((state) => state.language);

  return dictionaries[resolveLanguage(setting)];
}

/** Messages for code outside React (notices, the tray). */
export function t(): Messages {
  return dictionaries[resolveLanguage(useSettings.getState().language)];
}
