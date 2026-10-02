// Everything public about the app lives in app.json. This file only layers in what must not be
// committed: the Apple Developer Team ID, read from apps/mobile/.env (see .env.example). Expo CLI
// loads .env files before evaluating this config, so `expo run:ios --device`, `expo prebuild` and
// the release script all see it; simulator builds work without one.
//
// And the languages, which come from packages/i18n (`bun run i18n` writes locales/): Info.plist text
// per language through `locales`, and CFBundleLocalizations, which is what lists the app under
// Settings → Kopiyka → Language. Adding a language to i18n.config.ts is all it takes.
const languages = require("./locales/languages.json");

module.exports = ({ config }) => {
  const teamId = process.env.APPLE_TEAM_ID;
  return {
    ...config,
    locales: Object.fromEntries(languages.map((l) => [l, `./locales/${l}.json`])),
    ios: {
      ...config.ios,
      ...(teamId ? { appleTeamId: teamId } : {}),
      infoPlist: { ...config.ios.infoPlist, CFBundleDevelopmentRegion: "en", CFBundleLocalizations: languages },
    },
    plugins: [...config.plugins, ["./plugins/withLocalizations", { languages }]],
  };
};
