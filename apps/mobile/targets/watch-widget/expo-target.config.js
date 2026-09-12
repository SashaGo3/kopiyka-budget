/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch-widget",
  name: "KopiykaWatchWidget",
  displayName: "Kopiyka",
  bundleIdentifier: "dev.kopiyka.app.watchkitapp.widget",
  deploymentTarget: "10.0",
  colors: { $accent: { light: "#2B2B2E", dark: "#F4F4F1" } },
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
