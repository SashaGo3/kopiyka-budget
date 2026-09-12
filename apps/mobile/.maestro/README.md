# Maestro flows

End-to-end flows against the dev build on the iOS simulator (Metro must be running).

```sh
export PATH="$HOME/.maestro/bin:$PATH"
maestro --device <simulator udid> test .maestro
```

Flows use the accessibility labels the app sets on every control, so they double as
an accessibility check. `_launch.yaml` is shared and dismisses the dev-client onboarding.
