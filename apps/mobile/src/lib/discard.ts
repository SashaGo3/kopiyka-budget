import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";

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

/**
 * Whether anything on an editor has changed since it opened: the values as they were on the first
 * render, compared with what they are now. Plain data only — they are compared as JSON.
 */
export function useDirty(values: unknown[]): boolean {
  const now = JSON.stringify(values);
  const [initial] = useState(now);
  return now !== initial;
}

/**
 * Closing an editor with changes in it — Cancel, a swipe down, a tap outside the sheet — asks first,
 * the way the entry sheet always has; closing one with nothing changed just closes.
 *
 * Every way out that saves or deletes goes through the returned `exit(go)` instead of navigating
 * itself: it switches the question off, and `go` runs only after the render that did so. Navigating
 * in the same tick would still find the screen guarded — and closing two sheets at once (travel
 * mode's name, then its dates) would have each of them ask.
 */
export function useDiscardGuard(dirty: boolean): (go: () => void) => void {
  const navigation = useNavigation();
  const [leaving, setLeaving] = useState<{ go: () => void } | null>(null);
  usePreventRemove(dirty && !leaving, ({ data }) => {
    Alert.alert("Discard your changes?", "What you changed here has not been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useEffect(() => { leaving?.go(); }, [leaving]);
  return useCallback((go: () => void) => setLeaving({ go }), []);
}
