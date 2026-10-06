# Troubleshooting

[Back to the README](../README.md)

## Integration or card not found

- Add the repository to HACS as an **Integration**, download it and restart Home Assistant.
- The card is bundled; do not install the repository a second time as a dashboard/plugin.
- Reload the browser after updating. A stale frontend can show "Custom element doesn't exist" or a configuration error.
- In storage-mode dashboards, the integration registers its Lovelace module resource automatically.
- For YAML-managed resources, explicitly add the version matching your installed release:

```yaml
lovelace:
  resources:
    - url: /ah_shopping/ah-shopping-card.js?v=0.2.29
      type: module
```

Check browser network errors for this JS file and the files beneath `/ah_shopping/`. Remove duplicate old resource entries; do not remove resources belonging to other cards.

## Login or reauthentication

Use the login link in the configuration flow, not an old saved authorization URL. Paste the complete `appie://login-exit?...code=...` redirect or just the code. If it has expired/already been exchanged, obtain a new one.

For reauthentication, use the same AH account as the existing integration. Never attach the redirect, code or tokens to a public issue.

## Camera preview missing

Use HTTPS and grant camera permission to the dashboard browser/app. Camera capture takes place on that device, not on the Home Assistant server.

Without HTTPS the browser offers no live camera. **Scan product** then opens the device camera for a single photo instead; hold the barcode flat and sharp in the picture. Each photo adds one product.

In Fully Kiosk, check the app and Android camera permissions. Close other apps using the camera. Try `scan_camera: rear` or `front` as appropriate. A hidden/background card intentionally stops its camera.

## Preview works, but no products are added

Start with `scan_decoder: auto` and `scan_zoom: 1`. Keep the whole barcode and some blank margin in view; avoid glare and an out-of-focus image. The guide is an aiming aid, not a strict boundary.

- Green scan line: AH accepted the addition; the 1.2-second cooldown is running.
- Product-not-found error: barcode recognition worked, but AH could not resolve the code.
- Decoder error: the worker/browser decoder failed; the message identifies any fallback.
- Silent misses: try `wasm` or `local` to compare device behaviour. Legacy `zxing` needs access to jsDelivr.

Keep browser console/network errors for a bug report, but redact account data. Include browser/app, device, decoder, zoom and installed integration version. Do not share camera images containing faces, addresses or private screens.

## Same product should be scanned twice

Wait for the line to return to red. Move the barcode away for more than 700 ms, then present it again. A continuously held barcode is deliberately ignored to prevent double additions. You can also use the overlay plus button.

## Scan beep is silent

Automatic and permanent scanners initialise audio as well. If the browser blocks sound until you interact, press **Geluid aan** in the camera view. It plays a test beep and disappears when browser audio is active. Dashboard touches and keyboard interaction also resume suspended scan audio.

If audio is active but the test remains silent, check the device's media volume and browser/app mute settings. The automatic beep plays after AH accepts a product, not on failed lookups. Browser audio permissions still apply after a full page reload.

## Scanner or overlay disappears

In button modes, the session closes after 60 seconds before a first successful scan, or 10 seconds after the latest success. Use `permanent` for an always-visible feed.

Overlay expiry is separate: newest product 10 seconds; five seconds after becoming translucent. Quantity adjustment restarts that row's applicable period.

## Total or Bonus savings differs from AH

First distinguish **Mijn lijst**, **next order** and the **combined** view. Their totals and savings represent different product sets.

- The list savings sensor does not include order savings; use the separate Next Order Bonus Savings sensor.
- The order card uses calculated product totals, not necessarily AH's final checkout amount.
- Check quantities, current/previous prices, promotion text, supported mixed-product groups and the order cut-off.
- Unit discounts already embedded in the current price are not subtracted twice.
- Delivery charges, deposits, substitutions and unsupported/personalised deals may differ.

For a report, include only anonymised product IDs, quantities, price fields and Bonus text; remove list/order IDs, account details and delivery information.

## Quantity or scrolling issues

A last-quantity deletion stays at zero for four seconds so plus can restore it. Normal rows retain their DOM nodes and scroll anchor. Recent successful writes are temporarily protected against stale AH responses, then reconciled.

If an error restores a row, the deletion was not accepted. Do not retry repeatedly without checking the error. Report the source view, pending_changes, last_synced and steps to reproduce.

## Debug logging

If needed, temporarily enable:

```yaml
logger:
  logs:
    custom_components.ah_shopping: debug
```

Review and redact logs before sharing, then turn debug logging off. There is no guarantee that private API error messages are safe to publish.
