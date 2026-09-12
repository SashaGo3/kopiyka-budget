import { Alert } from "react-native";

/**
 * Multi-step flows (adding a recurring rule) answer one question per sheet, so a stray swipe
 * on step five throws away four answers with nothing to show for it. Screens that are part of
 * such a flow take a `guard` param naming what is being built, turn the dismiss gesture off,
 * and route their Cancel through here.
 */
export function confirmDiscard(what: string, onDiscard: () => void): void {
  Alert.alert(`Discard this ${what}?`, "Nothing has been saved yet.", [
    { text: "Keep going", style: "cancel" },
    { text: "Discard", style: "destructive", onPress: onDiscard },
  ]);
}

/** Screen options for a guarded step: no swipe-to-dismiss, so Cancel is the only way out. */
export function guardOptions(guard?: string) {
  return { gestureEnabled: !guard };
}
