// Everything public about the app lives in app.json. This file only layers in what must not be
// committed: the Apple Developer Team ID, read from apps/mobile/.env (see .env.example). Expo CLI
// loads .env files before evaluating this config, so `expo run:ios --device`, `expo prebuild` and
// the release script all see it; simulator builds work without one.
module.exports = ({ config }) => {
  const teamId = process.env.APPLE_TEAM_ID;
  return {
    ...config,
    ios: { ...config.ios, ...(teamId ? { appleTeamId: teamId } : {}) },
  };
};
