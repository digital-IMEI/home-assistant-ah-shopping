# Contributing

Thanks for helping improve Albert Heijn Shopping. For usage, start with the [README](README.md); for security issues, read [SECURITY.md](SECURITY.md).

## Before opening a change

- Use a focused pull request with a clear explanation and reproduction.
- Preserve account/list semantics: Mijn lijst is editable; confirmed order lines are read-only.
- Do not include credentials, actual account/order/list IDs, addresses or personal camera screenshots.
- Prefer synthetic fixtures. Changes to private API parsing need redacted examples and regression tests.
- Document changed settings and behaviour. Timings and decoder defaults in the README must match the card.
- Preserve bundled license notices when updating decoder assets.

## Local checks

Python tests use lightweight Home Assistant stubs; they are not a substitute for a real Home Assistant installation.

```sh
python -m pip install pytest aiohttp
python -m compileall -q custom_components/ah_shopping
pytest -q
```

Use Node.js 22 or newer:

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:frontend
```

The browser tests cover retained rows/scroll/focus, scanner lifecycle, bundled WASM loading and decoding, failure recovery, cooldowns, undoable removals and scanner-feed expiry. The additional frontend suites test HTTP photo scanning and refresh, checked-item controls, product search, department/store sorting, full-screen layout and swipe gestures. Python tests also cover checked bulk actions, pricing fallback and AH store-route data.

The **Validate** workflow also runs frontend syntax checks, documentation checks through pytest, HACS custom-repository validation and Hassfest. The separate **Publication checks** workflow runs strict HACS validation without metadata ignores.

## Before a release

Follow [the publication checklist](docs/PUBLISHING.md). Update both the manifest version and versioned frontend URL when releasing a changed card. Update the worker URL if worker/browser cache invalidation is needed.

Automatic releases are gated on a successful Validate run on main. They use the validated commit, not an untested later branch tip.

## Project layout

- `custom_components/ah_shopping/`: integration, account/config flows, API, coordinators, entities and actions.
- `custom_components/ah_shopping/frontend/`: bundled card, worker and decoder assets.
- `tests/`: Python and browser regression tests.
- `docs/`: user troubleshooting, publication guidance and archived early reports.
- [CHANGELOG.md](CHANGELOG.md): historical releases.

Testing with real cameras and accounts remains valuable. Share the device/browser and observed result without uploading private data.
