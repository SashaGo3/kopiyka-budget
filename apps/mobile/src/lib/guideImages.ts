import type { ImageSourcePropType } from "react-native";
import type { LanguageCode } from "@/i18n";

/**
 * Pictures of the notification-automation setup in Apple's Shortcuts app, one list per step of
 * settings/shortcut.tsx (automation.shortcut.step1–9). Made by scripts/screenshots/guide.mjs from
 * iOS 27 simulator captures. The "Describe a shortcut" screen (02) needs Apple Intelligence, which has
 * no Ukrainian, so the Ukrainian set shows the English capture with Edit's Ukrainian name beside it.
 */
const en: ImageSourcePropType[][] = [
  [require("../../assets/guide/en/01.jpg"), require("../../assets/guide/en/02.jpg")],
  [require("../../assets/guide/en/03.jpg"), require("../../assets/guide/en/04.jpg")],
  [require("../../assets/guide/en/05.jpg"), require("../../assets/guide/en/06.jpg")],
  [require("../../assets/guide/en/07.jpg"), require("../../assets/guide/en/08.jpg"), require("../../assets/guide/en/09.jpg")],
  [require("../../assets/guide/en/10.jpg")],
  [require("../../assets/guide/en/11.jpg")],
  [require("../../assets/guide/en/12.jpg"), require("../../assets/guide/en/13.jpg"), require("../../assets/guide/en/14.jpg")],
  [require("../../assets/guide/en/15.jpg"), require("../../assets/guide/en/16.jpg")],
  [require("../../assets/guide/en/17.jpg"), require("../../assets/guide/en/18.jpg")],
];

const uk: ImageSourcePropType[][] = [
  [require("../../assets/guide/uk/01.jpg"), require("../../assets/guide/uk/02.jpg")],
  [require("../../assets/guide/uk/03.jpg"), require("../../assets/guide/uk/04.jpg")],
  [require("../../assets/guide/uk/05.jpg"), require("../../assets/guide/uk/06.jpg")],
  [require("../../assets/guide/uk/07.jpg"), require("../../assets/guide/uk/08.jpg"), require("../../assets/guide/uk/09.jpg")],
  [require("../../assets/guide/uk/10.jpg")],
  [require("../../assets/guide/uk/11.jpg")],
  [require("../../assets/guide/uk/12.jpg"), require("../../assets/guide/uk/13.jpg"), require("../../assets/guide/uk/14.jpg")],
  [require("../../assets/guide/uk/15.jpg"), require("../../assets/guide/uk/16.jpg")],
  [require("../../assets/guide/uk/17.jpg"), require("../../assets/guide/uk/18.jpg")],
];

/** The pictures for each step, in the app's language (English for one with no captures yet). */
export function guideImages(lang: LanguageCode): ImageSourcePropType[][] {
  return lang === "uk" ? uk : en;
}
