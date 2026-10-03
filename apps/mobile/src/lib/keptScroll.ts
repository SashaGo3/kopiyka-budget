import { useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";

/**
 * Where each kept list was scrolled to, by slot. Module state, so it outlives the screen: a theme
 * switch re-mounts a screen's content (components/ThemeKeyed.tsx), and a picker that jumps back to
 * the top under the finger that just tapped it reads as the tap having gone wrong.
 */
const offsets = new Map<string, number>();
/** How long a re-mounted list keeps putting itself back while its content is still growing. */
const SETTLE_MS = 800;

/**
 * Props for a ScrollView that comes back where it was. Restoring is not one `contentOffset`: the
 * new content arrives in pieces (fade-ins, rows measured late), and an offset near the bottom of a
 * list that is not tall enough yet gets clamped to the top. So the offset is re-applied on every
 * content-size change until the list settles or the user takes over — and until then the list's own
 * scroll events are not recorded, or its first one (at 0) would overwrite what is being restored.
 */
export function useKeptScroll(slot: string) {
  const ref = useRef<ScrollView>(null);
  const pending = useRef<number | null>(offsets.get(slot) ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = () => { pending.current = null; if (timer.current) clearTimeout(timer.current); };
  return {
    ref,
    scrollEventThrottle: 32,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { if (pending.current === null) offsets.set(slot, e.nativeEvent.contentOffset.y); },
    onScrollBeginDrag: settle,
    onContentSizeChange: () => {
      const y = pending.current;
      if (y === null) return;
      ref.current?.scrollTo({ y, animated: false });
      timer.current ??= setTimeout(settle, SETTLE_MS);
    },
  };
}
