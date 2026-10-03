import { Fragment, useEffect, type ReactElement, type ReactNode } from "react";
import { themeMounted, useTheme } from "@/lib/theme";

/**
 * Its children mount again whenever the theme changes, and nothing else does. A theme switch uses it
 * to re-read every colour: each screen's content is wrapped in one (a navigator's `screenLayout`,
 * below), so every `themed` style sheet is rebuilt and every colour the React Compiler memoised is
 * read afresh — while the navigators around the screens, and so the tab selection, every stack and
 * every open sheet, stay exactly as they were. Never wrap a navigator in it: that would start its
 * state over (src/lib/theme.ts).
 */
export function ThemeKeyed({ children }: { children: ReactNode }) {
  const theme = useTheme();
  // Effects run once the re-keyed content has committed; the picker's cover waits for this
  // (`themeMounted` itself then waits for the new colours to reach the glass).
  useEffect(() => { themeMounted(); }, [theme]);
  return <Fragment key={theme}>{children}</Fragment>;
}

/** `screenLayout` for a navigator whose screens are all plain screens (no navigator inside). */
export function themeKeyedLayout({ children }: { children: ReactElement }): ReactElement {
  return <ThemeKeyed>{children}</ThemeKeyed>;
}

/**
 * `screenLayout` for a navigator some of whose screens are navigators themselves: those are passed
 * through untouched (their own stacks re-key their screens), the rest are re-keyed. expo-router's
 * `Stack.Screen` does not forward a per-screen `layout`, hence a check by route name here.
 */
export function themeKeyedLayoutExcept(navigators: readonly string[]) {
  return function themeKeyedLayoutFor({ route, children }: { route: { name: string }; children: ReactElement }): ReactElement {
    return navigators.includes(route.name) ? children : <ThemeKeyed>{children}</ThemeKeyed>;
  };
}
