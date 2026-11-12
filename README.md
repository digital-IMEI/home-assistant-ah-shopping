# Albert Heijn Shopping for Home Assistant

<p align="center"><img src="brand/logo.png" width="120" alt="Albert Heijn"></p>

[![Validation](https://github.com/digital-IMEI/home-assistant-ah-shopping/actions/workflows/validate.yml/badge.svg)](https://github.com/digital-IMEI/home-assistant-ah-shopping/actions/workflows/validate.yml)
[![Release](https://img.shields.io/github/v/release/digital-IMEI/home-assistant-ah-shopping)](https://github.com/digital-IMEI/home-assistant-ah-shopping/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Scan your groceries straight into your Albert Heijn list — from your Home Assistant dashboard.**

A custom integration with a bundled dashboard card for AH **Mijn lijst**, product quantities, prices, Bonus savings and your next scheduled order. Use a phone, laptop or a wall-mounted tablet as a camera barcode scanner.

> **Unofficial community integration for Albert Heijn Netherlands.** Not affiliated with Albert Heijn or Ahold Delhaize. It relies on private AH APIs, which can change without notice. Available through a **HACS custom repository**, not yet included in the default HACS catalogue.

[Installation](#installation) · [Dashboard examples](#dashboard-examples) · [Settings](#settings) · [Entities and actions](#entities-and-actions) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Changelog](CHANGELOG.md)

## What it does

- **Editable shopping list:** view AH Mijn lijst, search or scan products, adjust quantities, mark items completed, restore or remove completed items, and swipe to remove on touch screens.
- **Product details:** images, unit sizes, current prices, previous prices and Bonus labels; optional sorting by department or favourite-store walking route.
- **Scheduled order:** read-only products, quantities and delivery date/time; AH's own order total and Bonus; on delivery day the live delivery window, the number of customers before you and a Besteld › Inpakken › Onderweg › Geleverd progress bar, as in the Appie app.
- **Combined overview:** merge identical products from the list and the next order, while keeping ordered and extra quantities separate.
- **Camera barcode scanner:** on-demand, automatically active on entering a dashboard, or a permanent feed.
- **Fast local decoding:** bundled ZXing-C++/WebAssembly in a background worker, with alternative decoders for different devices.
- **Scan feedback:** a locally generated checkout-style beep, a green scan line during the 1.2-second successful-add cooldown, and a recent-product feed with quantity controls.
- **Comfortable editing:** stable rows and scroll position; four seconds to undo a last-quantity removal, including swipe gestures; Appie-style mobile rows and optional full-screen height.
- **Automation support:** sensors, a read-only native To-do list, and actions for search, lookup, quantities and refresh.
- **Account synchronisation:** configurable polling and protected recent writes, plus refresh when a visible list opens and every 60 seconds while visible (throttled to once per 30 seconds across cards).

### Important: list, cart and order

The editable source is AH's account-wide **Mijn lijst**, labelled **Winkelmandje** in the card. It is **not** an API for submitting, paying for or changing a confirmed order.

In the combined view, the ordered quantity is a read-only minimum. Minus removes only extra list quantity; plus adds to Mijn lijst. Once AH reports the order cut-off has passed, the order disappears from the **combined** view. The separate next-order view remains read-only.

**Bonus follows the card's selected source:** `shopping_list` uses AH's price/Bonus calculation for the current editable list; `next_order` uses the discount reported by AH for the placed order. The combined `shopping_list_and_order` view includes the Bonus from each included source. Displayed totals are already net of discount; never subtract Bonus a second time.

### Related integration: Albert Heijn Delivery

For dedicated delivery tracking, live ETA, Track & Trace messages, ETA freshness checks and adaptive polling, see **[Albert Heijn Delivery](https://github.com/digital-IMEI/home-assistant-ah-delivery)**. It is a separate Home Assistant integration and the preferred reference for delivery-specific functionality. AH Shopping focuses on the shopping list, order contents, Bonus and a compact order overview; it does not depend on AH Delivery. Avoid duplicating or extending delivery-tracking logic here when it already exists in AH Delivery.

## Installation

### Requirements

- Home Assistant **2026.8.2 or newer**.
- An Albert Heijn Netherlands account and internet access to AH.
- HACS, or a manual custom-integration installation.
- For live scanning: a camera, browser camera permission and **HTTPS** (or another secure context). On plain HTTP, the scan button offers photo-based barcode decoding instead of a live preview.
- One AH account per installation is recommended. Multi-account action routing is not supported.

### HACS — recommended

1. Open **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/digital-IMEI/home-assistant-ah-shopping` with type **Integration**.
3. Find **Albert Heijn Shopping**, download it and restart Home Assistant.
4. Open **Settings → Devices & services → Add integration → Albert Heijn Shopping**.

This is an integration, **not** a separate HACS frontend/card repository. The dashboard card and decoder assets are included.

### Connect your AH account

1. Open the AH login link shown by the integration.
2. Log in on AH's own page.
3. When redirected to `appie://login-exit?...`, copy the complete redirect URL or its `code` value.
4. Paste it into the setup form.

If the browser hands the link to the AH app instead of exposing the URL, try a desktop browser. Obtain a fresh code if AH rejects it; authorization codes are short-lived and single-use.

The integration does not store your AH password. It stores access and refresh tokens in Home Assistant to maintain the connection. Keep these tokens, redirect URLs and backups private.

### Manual installation

Download a [release](https://github.com/digital-IMEI/home-assistant-ah-shopping/releases), copy `custom_components/ah_shopping` into your Home Assistant `config/custom_components` directory, then restart and add the integration. Avoid an extra nested folder.

### Updates

Update through HACS, restart Home Assistant and reload dashboard clients. If a browser keeps an old card, perform a hard refresh or clear its site cache. The integration updates its versioned Lovelace resource automatically in storage mode.

## Dashboard examples

Add a **Manual** dashboard card with:

```yaml
type: custom:ah-shopping-card
title: Boodschappen
product_source: shopping_list
```

### Shopping list and next order

```yaml
type: custom:ah-shopping-card
title: Boodschappen
product_source: shopping_list_and_order
scanner_mode: button_auto
scan_camera: rear
scan_zoom: 1
scan_decoder: auto
```

The scanner opens when entering this dashboard, returns to the list after the session and starts again on a later visit. Closing it manually keeps it closed for the current visit.

### Dedicated scanner next to a list card

```yaml
type: custom:ah-shopping-card
scanner_mode: permanent
scan_camera: front
scan_zoom: 1
scan_decoder: auto
show_header: false
```

Put a second card alongside it with `product_source: shopping_list_and_order`. The permanent camera only runs while its card is visible in an active, foreground dashboard.

### Read-only delivery overview

```yaml
type: custom:ah-shopping-card
title: Volgende bestelling
product_source: next_order
show_scan: false
```

Card size is controlled through the Home Assistant dashboard **Layout** settings. Long lists scroll inside the card; there is no pixel-height card option.

## Settings

### Integration

Open the integration's **Configure** screen.

| Setting | Default | Range / behaviour |
| --- | --- | --- |
| Full update interval | 5 minutes | 1–60 minutes. Successful writes update locally and trigger reconciliation. A visible shopping-list card additionally requests a refresh on appearance and every 60 seconds, globally throttled to 30 seconds. |

### Dashboard card

Most settings are available in the visual card editor. `entity` is an optional YAML setting.

| Setting | Default | Options / behaviour |
| --- | --- | --- |
| `title` | Source label | Custom header title. |
| `entity` | Auto-detected | Explicit AH shopping-list sensor; does not select a different scheduled-order account. |
| `product_source` | `shopping_list` | `shopping_list`, `next_order`, `shopping_list_and_order`. |
| `show_header` | `true` | Show title, count, total, Bonus savings and delivery information where available. |
| `show_scan` | `true` | Show the scan button when the scanner is closed. Does not disable permanent/start-active modes. |
| `show_products` | `true` | Show ordinary list rows when the scanner is closed. |
| `scanner_mode` | `button` | `button`: on-demand; `button_auto`: start active on each dashboard visit; `permanent`: visible camera feed. |
| `scan_camera` | `front` | `front` or `rear`; browser chooses the matching available camera. |
| `scan_zoom` | `2` | 1×–4×; editor steps of 0.25. Hardware zoom when available, otherwise a digital crop. |
| `scan_decoder` | `auto` | `auto`, `wasm`, `zxing`, `native`, `local`; see below. |
| `scan_label` | `Scan product` | Text on the scan button. |
| `show_search` | `false` | Optional inline AH product search and add controls. Search starts after 0.8 seconds of inactivity or Enter; select a quantity and confirm or wait 2 seconds. |
| `sort` | `input` | `input` preserves list order; `department` groups products under department headings; `store` follows the Appie app's favourite-store route, falling back to departments if unavailable. |
| `fill_screen` | `false` | Let the card take the room its content needs, growing up to the screen height below the header (respecting mobile safe-area insets) before the list scrolls. On phones (up to 600 px wide), where dashboard sections stack, the card is as long as its list and the page scrolls instead. The camera view keeps the full height. Otherwise the dashboard grid layout applies. |

Legacy `product_source: cart` / `cart_and_order` map to `shopping_list` / `shopping_list_and_order`. Legacy `mode: scan_only` remains compatible.

### Next order progress

With `product_source: next_order` the card shows a progress bar below the header, like the Appie app:

- **Besteld** while the order can still be changed;
- **Inpakken** after the cut-off, once AH has sent the order to its logistics partner;
- **Onderweg** while the driver is out (`OUT_FOR_DELIVERY` / track & trace `UNDERWAY`), with "Nog 3 klanten voor je" or "Je bent de eerstvolgende" below it;
- **Geleverd** when AH reports the order as delivered. AH removes delivered orders from the open orders shortly after, so the card then shows the next order or none.

The header shows AH's live delivery window instead of the booked slot as soon as AH has planned the route. Themes can change the bar colour with `--ah-progress-color`.

### Scanner behaviour

- Button modes close after **60 seconds without a first successful scan**, or **10 seconds after the latest successful scan**. Permanent mode does not auto-close.
- A successful AH addition starts a **1.2-second pause**. The horizontal line turns green for that pause, then red when scanning resumes. Failed decoding attempts have no fixed retry delay.
- A barcode held in view is not repeatedly added. To intentionally scan the same product again, remove it from view for more than **700 ms after the pause**, then present it again.
- Up to five scanned products appear over the camera. The newest overlay row stays for **10 seconds**. When a new scan makes it translucent, it gets **5 seconds**. Older translucent rows retain their deadlines.
- Plus/minus in the overlay updates the existing row without rebuilding the feed, and restarts that row's current 10- or 5-second period.
- A last-quantity removal in the ordinary list stays at **0 for four seconds**, allowing plus to restore it before deletion. Leaving the dashboard commits an outstanding removal.
- These timings are built-in behaviour, **not configurable settings**.

### Decoder choices

| Decoder | Use |
| --- | --- |
| `auto` | Recommended. Starts with locally bundled ZXing-C++/WebAssembly. Falls back if initialization fails; runtime worker failure falls back to Local EAN with a visible error. |
| `wasm` | Explicit ZXing-C++ worker. Initialization errors are visible; runtime failure can recover to Local EAN. |
| `zxing` | Legacy JavaScript ZXing, loaded from jsDelivr. Requires that CDN to be reachable. |
| `native` | Browser BarcodeDetector, if supported. Availability varies by browser. |
| `local` | Bundled lightweight EAN decoder; useful as a basic fallback. |

The main C++ route supports **EAN-13, EAN-8 and UPC-A** and rotated codes. UPC-E support depends on the legacy/native route; it is not advertised as supported by the C++ worker. Check digits are validated before adding a decoded product.

You do not need to align the barcode exactly inside the guide: after missed attempts the scanner also searches the full camera image. Clear focus and adequate barcode size still matter.

## Entities and actions

### Entities

Entity IDs depend on Home Assistant naming and existing installations; use the integration's entity list rather than assuming a fixed ID.

| Entity name | Provides |
| --- | --- |
| Albert Heijn Shopping Cart sensor | Total list quantity; product lines, prices, calculated totals, sync timestamp and pending-change attributes. Existing installations may use `sensor.albert_heijn_shopping_list`. |
| Albert Heijn Shopping Estimated Total | Calculated list product total in EUR. |
| Albert Heijn Shopping Bonus Savings | List-only Bonus savings; zero is correct if the list has no supported discounted products. |
| Albert Heijn Next Order | Next scheduled order quantity; products, delivery slot, status, cut-off and price attributes. On delivery day `expected_time_display` holds AH's live delivery window once the route is planned (shown in Dutch time) and, while the driver is out, `customers_ahead` the number of stops before yours (0 when you are next). `order_state` and `tracking_type` carry AH's status codes, `price_source` is `ah` when the total and Bonus come from AH. `minimum_order_value`, `remaining_to_minimum` (indicative; AH's `submittable` is decisive) and `submittable` come from AH's order limits. |
| Albert Heijn Next Order Bonus Savings | AH's order discount when available, otherwise calculated savings; separate from the list. |
| Albert Heijn Shopping Cart To-do | Read-only native Home Assistant To-do representation. Struck-through products show as completed; edit through the custom card or integration actions. |

### Actions

All action names use the `ah_shopping` domain. Search and lookup require a response variable.

| Action | Required fields | Optional fields | Effect |
| --- | --- | --- | --- |
| `search_products` | `query` | `limit` (1–20; default 8) | Search catalogue; response contains `products`. |
| `lookup_barcode` | `barcode` | — | Look up without adding; response contains `product`. |
| `add_product` | `product_id` | `quantity` (1–99; default 1) | Add/increment a list product. |
| `add_barcode` | `barcode` | `quantity` (1–99; default 1) | Resolve and add/increment a product. |
| `set_quantity` | `product_id`, `quantity` (0–99) | — | Set absolute list quantity; 0 removes it immediately. |
| `remove_product` | `product_id` | — | Remove from the list immediately. |
| `refresh` | — | — | Request a list refresh. |
| `restore_checked` | — | — | Restore all struck-through products on Mijn lijst; returns `count`. |
| `remove_checked` | — | — | Delete all struck-through products on Mijn lijst; returns `count`. Confirmation is shown by the card. |

The four-second undo is a **card feature**; direct actions do not delay removals. Actions operate on the first loaded AH account.

Example for a script or automation action sequence:

```yaml
- action: ah_shopping.search_products
  data:
    query: havermelk
    limit: 5
  response_variable: ah_results
```

## Prices and Bonus: what the total means

The shopping-list **subtotal, Bonus savings and estimated total** now use AH's own GraphQL `totalPrice` calculation for the complete set of product quantities. This supports mixed-product offers such as “2 voor €5,50” without guessing promotion groups locally. The shopping-list sensor exposes `price_source`: `ah`, `ah_pending`, `ah_adjusted` or `estimate`.

If AH's pricing endpoint is unavailable, the integration falls back to locally supported offers, including “N + M gratis” (e.g. 2 + 1), second half price, “N halen M betalen” and “N voor X”. For the next order, AH's own order discount is used when AH returns it (`price_source: ah` on the next-order sensor); otherwise the order savings are a local estimate. Individual product savings remain local estimates. Checkout invoices can still differ due to delivery charges, deposits, substitutions or other AH-specific conditions. Do not assume per-product Bonus amounts add up to the list's AH-calculated total.

Read the [troubleshooting guide](docs/TROUBLESHOOTING.md) before reporting a difference, and never publish account identifiers, addresses or authorization data.

## Privacy and limitations

- Barcode decoding happens on the dashboard device. Camera frames are not sent to AH by this integration; AH receives barcode lookups and account/list requests.
- Product images are loaded from AH; the legacy decoder uses an external CDN.
- This is a cloud integration. Internet is required for lookup, edits and account synchronisation.
- No order checkout, payment, multiple favourites-list management or native To-do editing.
- Camera performance and audio permission depend on the browser/device. An audible beep may require an initial user gesture; the scanner shows **Geluid aan** while audio is blocked, with a test beep when pressed.
- Barcode/catalogue availability and private APIs can change.

## Help, development and publication

- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Report a bug](https://github.com/digital-IMEI/home-assistant-ah-shopping/issues/new/choose)
- [Contributing and tests](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Publication checklist](docs/PUBLISHING.md)
- [Changelog](CHANGELOG.md)

Licensed under [MIT](LICENSE). Bundled decoder licenses and external dependencies are documented in [third-party notices](THIRD_PARTY_NOTICES.md). Albert Heijn names and logos belong to their respective owners; their inclusion does not imply endorsement.
