/**
 * Launch screen = a flat brand-coloured view, nothing else.
 *
 * expo-splash-screen 57 only writes the `SplashScreenBackground` colour into the storyboard when an
 * `image` is configured; with no image it leaves the template's white `systemBackgroundColor` and the
 * dangling centre constraints of the removed image view. This mod is listed before that plugin (mods on
 * the same file run newest-first, and the splash plugin's own base mod must be registered last) and fixes
 * both, so the launch frame is indistinguishable from the app's own background (light and dark come
 * from the `SplashScreenBackground` colorset the splash plugin still generates).
 */
const path = require("path");

// The package's exports map hides its plugin internals; absolute paths bypass it.
const pluginDir = path.join(path.dirname(require.resolve("expo-splash-screen/package.json")), "plugin/build");
const { withIosSplashScreenStoryboard } = require(path.join(pluginDir, "withIosSplashScreenStoryboard.js"));
const { parseColor } = require(path.join(pluginDir, "InterfaceBuilder.js"));

/** @type {import('expo/config-plugins').ConfigPlugin<{ backgroundColor: string }>} */
module.exports = (config, { backgroundColor }) =>
  withIosSplashScreenStoryboard(config, (c) => {
    const xml = c.modResults;
    const view = xml.document.scenes[0]?.scene[0]?.objects[0]?.viewController[0]?.view[0];
    if (view) {
      view.subviews = [{ imageView: [] }];
      view.constraints = [{ constraint: [] }];
      view.color = [{ $: { key: "backgroundColor", name: "SplashScreenBackground" } }];
    }
    const resources = xml.document.resources?.[0];
    if (resources) {
      delete resources.image;
      delete resources.systemColor;
      const { rgb } = parseColor(backgroundColor);
      resources.namedColor = [{
        $: { name: "SplashScreenBackground" },
        color: [{ $: { alpha: "1.000", blue: rgb.blue, green: rgb.green, red: rgb.red, customColorSpace: "sRGB", colorSpace: "custom" } }],
      }];
    }
    return c;
  });
