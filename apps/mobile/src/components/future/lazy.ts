/**
 * The forecast screens, loaded the first time they are drawn rather than at launch.
 *
 * Expo's Metro config has `inlineRequires` off and Expo Router evaluates every route at start, so a
 * static import from `InsightCard` or the insight screen would evaluate Purrphecy, the goal, the
 * charts and Siriusia's pictures as the app starts — for people who may never add either card. A
 * `require` inside a function runs when it is called, once, and is cached by Metro after that.
 */
type Future = typeof import("./Purrphecy") & typeof import("./Goal");

let loaded: Future | null = null;

export function future(): Future {
  /* eslint-disable @typescript-eslint/no-require-imports */
  loaded ??= { ...(require("./Purrphecy") as typeof import("./Purrphecy")), ...(require("./Goal") as typeof import("./Goal")) };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return loaded;
}
