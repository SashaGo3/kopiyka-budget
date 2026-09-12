/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch",
  name: "KopiykaWatch",
  displayName: "Kopiyka",
  icon: "./icon.png",
  bundleIdentifier: "dev.kopiyka.app.watchkitapp",
  deploymentTarget: "10.0",
  colors: { $accent: { light: "#2B2B2E", dark: "#F4F4F1" } },
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
