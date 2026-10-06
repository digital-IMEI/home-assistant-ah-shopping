# Changelog

Historical entries describe the behaviour of that version; the [README](README.md) describes the current release.

### Unreleased

- **Scan product** works on plain-HTTP dashboards: without a live camera API it takes a photo with the device camera, decodes it with the bundled ZXing-C++ worker and adds the product. HTTPS keeps the live scanner.
- A visible shopping-list card requests a refresh when it appears and every minute while visible (throttled to once per 30 seconds across all cards on the page), so removals or additions made in the AH app appear without waiting for the full polling interval. Hidden cards and next-order-only cards do not poll.

### 0.2.29

- Mirrors the front-camera preview so left/right movement feels natural. Rear-camera preview keeps its normal orientation.
- Maps the scan guide back to the original camera pixels when mirrored; decoding, overlays, sound and the successful-scan cooldown keep their behaviour.

### 0.2.28

- Reads and transfers only a narrow central camera strip for the first Auto/C++ decoding attempt. Successful strip scans avoid full-crop pixel readback and transfer.
- Reads the broader crop only after a strip miss, retaining rotated/off-centre searches and existing decoder error handling.
- Reuses canvas dimensions rather than resetting the drawing buffers on every frame. No new settings or visual changes; the 1.2-second success cooldown remains unchanged.

### 0.2.27

- Initialises scan audio for automatic/permanent scanners as well as the scan button. Resumes suspended audio on dashboard touches/keyboard interaction, handles rejected resumes and recreates closed audio contexts.
- Shows a small “Geluid aan” button while audio is locked, with a test beep when pressed; hides it once audio is running. Makes the checkout-style beep more audible.
- Plays the beep after audio has resumed and discards stale pending beeps rather than playing them much later. Successful additions remain the only automatic beep trigger.
- Avoids repeatedly decoding the same captured frame, with an 80 ms fallback for WebViews with rounded/frozen frame metadata. Retains the successful-scan cooldown and camera/decoder fallbacks.

### 0.2.26

- Requests 1080p camera input on Android as well, preserving more detail in thin barcode bars when supported by the camera.
- Adds a dense, narrow-strip C++ search before the broader image search, retaining horizontal resolution while reducing work on successful scans.
- Samples expensive full-frame and exhaustive searches instead of running them on every failed frame; includes a sampled alternative threshold for low-contrast images.
- Adds a 15% margin around the scan guide so barcode quiet zones are not clipped. No visual changes and no extra pause before recognition.
- Keeps the 1.2-second successful-scan cooldown and duplicate protection. Adds decoding checks for small, mildly blurred, low-contrast and skewed barcodes.

### 0.2.25

- Reorganises the README around installation, current features, complete settings, entities/actions and privacy.
- Adds troubleshooting, contributor/security guidance, publication checks and structured issue templates.
- Archives the early test report and keeps release history separate from user documentation.
- Adds Hassfest validation and gates automatic releases on successful validation.
- No shopping-list or scanner behaviour changes.

### 0.2.24

- Keeps the last editable quantity at zero for four seconds before deleting the product, with an active plus button to restore it. The row then fades and collapses over 320 ms. Quantity changes and refreshes preserve its position during the undo period.
- Keeps products already in the order when only their extra cart quantity is removed. Failed deletions restore the row; leaving the dashboard commits outstanding removals.
- Displays the newest scanned product for ten seconds. When a new scan makes the previous top row translucent, that row gets five seconds; older translucent rows keep their existing deadlines. Plus/minus adjustments restart the current row's ten- or five-second period. Expired feed rows fade and collapse.
- Updates scanner quantities by patching retained rows/buttons instead of rebuilding the feed, preserving focus, images and running animations.
- Adds browser coverage for the undo period, smooth height transition, pending writes, undo, errors, ordered-product retention, navigation, feed expiry and unchanged feed nodes during quantity adjustments.

### 0.2.23

- Extends the cooldown after a successful AH addition to 1.2 seconds. The horizontal scan line is green during this pause and returns to red when scanning resumes.
- Removes the green border flash, temporary barcode-read message and version/decoder/scanteller overlay. Decoder and AH errors remain visible.
- Does not count cooldown time as barcode absence. A held barcode remains protected after the pause, while removing it for more than 700 ms allows an intentional rescan. Blocks duplicate additions while an AH request is pending and discards in-flight decoded frames during cooldown.
- Tests successful-add-only cooldown, green/red scan feedback, held-code protection after the pause, intentional rescans, pending requests and failed additions.


### 0.2.22

- Runs Auto/WebAssembly scans directly through the C++ worker without waiting for browser BarcodeDetector initialization or detection. A stalled browser detector can no longer block that scan route.
- Schedules each next attempt through requestAnimationFrame instead of depending on video-frame callbacks. No artificial retry delay; the successful-add cooldown remains 350 ms.
- Bounds worker/native detection requests and recovers to Local EAN after a runtime decoder failure, with a visible error. Releases the busy flag even if read-feedback processing fails.
- Shows the running card version, decoder and scan counter in the camera view to distinguish a stalled scan loop from unsuccessful recognition.
- Extends browser tests to cover the complete crop/full-frame scan path, a stalled browser API, worker timeouts, error recovery and callback-independent scheduling.


### 0.2.21

- Auto mode uses locally bundled ZXing-C++ 3.1.5/WebAssembly in a worker; native detection is attempted first when supported. Existing explicit decoders remain available, with a new WebAssembly option.
- Scans the next available video frame after a miss, with no fixed retry delay. Processing is serialized to avoid a growing frame backlog.
- Applies a 350 ms cooldown only after a successful AH add, while preventing a held barcode from being added repeatedly.
- Preserves more image detail and expands to full-camera search after misses, alternating with the guide crop. Detects rotated codes through the C++ reader.
- Shows immediate barcode-read feedback while the AH lookup/add is in progress.
- Worker and WASM assets are bundled with their licenses; the main scanning path does not require an external CDN. Legacy Auto fallback retains the existing decoders if worker initialization fails.
- Browser tests cover local worker loading, standard/rotated/off-center EAN images, blank-image rejection, duplicate protection and immediate-frame/success-cooldown scheduling. Real-camera performance still depends on focus, lighting, motion blur and hardware.


### 0.2.20

- Registers the card as a Lovelace module resource in storage resource mode, so dashboard loading waits for the module. Loads the resource collection before writes and updates only this integration's resource URL when its version changes.
- YAML resource mode retains the automatic frontend fallback. For explicit YAML loading, list `/ah_shopping/ah-shopping-card.js?v=0.2.20` with `type: module` under Lovelace resources.
- Adds **Albert Heijn Next Order Bonus Savings**. The existing **Albert Heijn Shopping Bonus Savings** continues to represent only the cart; it correctly becomes zero when the cart has no discounted products.


### 0.2.19

- Preserves a successful ZXing central-band result instead of overwriting it with a failed Local EAN fallback on every fourth missed primary frame.
- Adds a regression test for that decoder handoff. Includes the dashboard revisit and header changes from 0.2.18.


### 0.2.18

- Re-arms button-auto scanner mode on return to its dashboard route and when the card reconnects. Closing a scanner session stays effective for the current visit; entity updates and scrolling do not reopen it.
- Removes approximation symbols from the total and Bonus text; the underlying product-total calculation is unchanged.
- Adds browser coverage for automatic scanner lifecycle and rendering before entity data arrives.


### 0.2.17

- Recognizes spaced multibuy labels such as `1 + 1 gratis`.
- Rounds each half-price discount to cents before multiplying by the number of pairs.
- Combines the verified Dr. Oetker Big Americans pizza variants for the `2 voor 5.99` offer. Other distinct products are not grouped by matching offer text alone.
- Includes discounts already embedded in unit prices in displayed savings without subtracting them twice.
- Adds `estimated_product_total` and `total_price_difference` to the order entity; retains the original AH `total_price`. Order views display the estimated product total with an ≈ marker, excluding unexplained differences in AH's order amount. Delivery charges, deposits and unsupported or mix-and-match promotions may differ from the amount payable.
- Regression fixture matches the supplied 29-product example: €59.78 product total, €21.87 savings, €0.25 difference from the €60.03 API order amount.


### 0.2.16

- Keeps product order stable across quantity changes and AH refreshes in all three list views. Newly scanned products still move to the top intentionally.
- Updates existing product elements instead of rebuilding the card; preserves the scroll container and focused quantity buttons.
- Restores the visible row synchronously, with a surviving-row fallback after removal. Removes delayed scroll corrections that could override user scrolling.
- Adds a Chromium regression test for delayed and reordered updates in shopping-list, combined and order views.


### 0.2.15

- Extends the post-scan auto-close window to 10 seconds.
- Adds button mode with an initially active camera (`button_auto`).
- Aligns both header subtitles on the same baseline and prevents long notes from wrapping into the product list.

- Shows estimated Bonus savings for ordered products, including reduced unit prices and supported same-product multibuy offers. Combined view adds the separate cart and order savings; it does not apply promotions across the two sources. AH's order total is never reduced again. The ≈ marker distinguishes the order estimate from an authoritative AH discount total; mix-and-match and unrecognized promotions may be missing.
- Ignores malformed or unavailable item arrays when rendering the card.

- Uses a short, fixed-pitch synthesized checkout beep after a successful scan (not an official AH audio recording).


### 0.2.14

- Reads AH fulfillment `reopenable`, `modifiable`, `isAfterCutOff`, `closingDateTime` and transaction state for the next scheduled order.
- Stops merging scheduled-order products into **Winkelmandje + volgende bestelling** as soon as AH reports `isAfterCutOff: true`.
- Removes the cut-off order's quantity, price and delivery information from the combined card while keeping the separate **Volgende bestelling** source available as a read-only overview.
- Adds a card-level barcode decoder selector: **Auto (recommended)**, **ZXing**, **Native BarcodeDetector** or **Local EAN**.
- Forced decoder modes stay on the selected engine, making it possible to compare scanner performance per device/browser.
- Shows a clear error when a forced decoder is unavailable instead of silently falling back.


### 0.2.13

- Restores the non-permanent scanner auto-close timer: 1:00 initially and 0:05 after a successful scan.
- Keeps product-list scroll position anchored to the visible product while quantities update.
- Expands the barcode guide to 90% of the camera width.
- Removes always-visible scanner/zoom diagnostics; only actionable errors remain visible.
- Shows the most recently scanned products first in Winkelmandje during the current dashboard session.
- Registers the dashboard card earlier and makes its frontend bundle self-contained to reduce intermittent `Custom element doesn't exist` load races.
- Aligns the card header into fixed rows so title/total and subtitle/meta line up consistently.
- Uses the same compact product-row layout across Winkelmandje, Volgende bestelling, combined view and scanner overlay.
- Improves desktop/laptop scanning by using ZXing as the primary decoder, requesting up to 1920×1080, retrying a central barcode band and sampling native detection more often.
- Adds explicit scanner feedback when a barcode was decoded correctly but Albert Heijn has no matching product.
- Keeps the permanent scanner header synchronized with live Home Assistant entity data instead of remaining at initial placeholder totals.



### 0.2.12

- Replaces the old full-screen scanner dialog with an **inline scanner** inside the existing shopping card.
- Adds two scanner modes: **Via scan button** replaces the product list temporarily, while **Permanent camera feed** turns a card into a dedicated scanner for side-by-side dashboard layouts.
- Stops the camera whenever the card is not actually visible: backgrounded browser/app, another Home Assistant route/view, or fully outside the viewport.
- Clears the recent-scan overlay when leaving the dashboard view so returning starts a fresh scanning session.
- Makes scanner lifecycle safe across card rerenders and configuration changes so detached video elements cannot keep a camera stream running.
- Adds **Front / Rear** camera selection in the card editor.
- Adds configurable **1×–4× zoom**, default **2×**. Hardware zoom is used when available; otherwise the remaining zoom is applied as a centred digital crop.
- Maps the decoder crop back to the exact visible scan guide, including Home Assistant card aspect ratio, `object-fit: cover` cropping and digital zoom.
- Keeps ZXing as the fast Android/Fully Kiosk primary decoder and samples the heavier local/native fallbacks only after misses instead of on every frame.
- Shows up to five recently scanned products over the camera feed at 100%, 80%, 60%, 40% and 20% opacity.
- Re-scanning the same product updates its quantity and moves it back to the top rather than creating a duplicate overlay row.
- Uses the same shared product-row renderer for the shopping list and scanner overlay to keep both layouts consistent.
- Scanner overlay quantity controls can reduce a product all the way to **0**, removing it from Winkelmandje, with `+` available to add it again.
- Keeps the shopping-list product order stable when quantities change and retains reliable internal/touch scrolling from 0.2.11.



### 0.2.11

- Removes the experimental white front-camera fill-light panel.
- Keeps the visible product order stable while quantities are changed and Home Assistant/AH state refreshes arrive.
- Restores reliable internal product-list scrolling, including touch scrolling in Android/Fully Kiosk.
- Simplifies the combined-view header: the source label is no longer shown next to the delivery slot.
- Shows the delivery date/time on the left below the title.
- Shows Bonus savings and the article count below the total amount on the right.



### 0.2.10

- Optimises barcode scanning for Android/Fully Kiosk tablets.
- Uses **ZXing as the primary decoder on Android** instead of relying on the slower native BarcodeDetector first.
- Scans only the small barcode guide area instead of processing the complete camera frame.
- Downscales the scan crop before decoding to reduce CPU load and latency.
- Uses cropped Native BarcodeDetector as a secondary fallback and the bundled local EAN decoder as the final fallback.
- Requests a lower-latency 1280×720 / 30 fps camera stream instead of processing 1920×1080 frames.
- Applies continuous autofocus, exposure and white-balance constraints when the Android camera/WebView exposes those capabilities.
- Reduces the scan loop delay from 140 ms to 90 ms.



### 0.2.9

- Uses the **front camera by default** when opening the barcode scanner.
- The front/back camera switch remains available.



### 0.2.8

- Adds a bright white fill-light panel on the left side of the screen while the **front camera** is active.
- The fill light covers the middle third of the screen height to illuminate packaging close to the tablet camera.
- Reduces the visible barcode guide to about 60% of the camera width and 20% of its height, encouraging a larger camera-to-product distance for better focus.
- Aligns the bundled local decoder crop with the smaller scan guide.



### 0.2.7

- Treats the scheduled-order quantity as the hard minimum in the combined list.
- Combined rows now display the total quantity: ordered + Winkelmandje.
- Minus only decreases the Winkelmandje quantity and disappears when the total reaches the ordered quantity.
- Plus remains available at the order minimum and adds the product to Winkelmandje.
- Removes the combined-row delete button so an order quantity can never be confused with an editable quantity.
- Shows a compact breakdown such as `2 besteld · 1 extra`.
- Allows setting a positive Winkelmandje quantity for a product that exists only in the order by resolving its product details first.
- Aligns the scanned-product panel to the top of the scanner and uses the same compact row styling as the normal product list.



### 0.2.6

- Replaces the standalone scan action with Home Assistant's native `ha-button` component and fixes its spacing/alignment.
- Adds a subtle auto-close countdown overlay inside the camera field.
- Countdown starts at 1:00 when the scanner opens and resets to 0:05 after every successful scan.
- Makes the combined Winkelmandje + bestelling view partially editable: only the Winkelmandje quantity can be changed; order quantity remains read-only.
- Combined rows now retain separate Winkelmandje and Bestelling quantities even when the same product exists in both.
- Makes combined-list rows more compact with smaller images, reduced spacing and compact source labels.



### 0.2.5

- Removes the separate active-order cart source introduced in 0.2.3/0.2.4.
- Renames AH "Mijn lijst" to **Winkelmandje** in the dashboard/UI while keeping its existing underlying integration data and unique IDs compatible.
- Product sources are now only: Winkelmandje, Next order, and Winkelmandje + Next order.
- Adds a combined Winkelmandje + Next order view that merges identical products and sums quantities.
- All scanning and editable product actions continue to write to AH "Mijn lijst" (now presented as Winkelmandje).
- Keeps the next scheduled order read-only.
- Removes the pixel `height` option from the card editor.
- Implements Home Assistant `getGridOptions()` so card height is controlled from the dashboard Layout panel.
- The product list scrolls inside the Home Assistant-assigned card height.
- Legacy `product_source: cart` and `cart_and_order` configs are migrated in the frontend to the new source names.



### 0.2.4

- Makes `product_source: cart` editable from the dashboard card.
- Adds +/- quantity controls and remove for active cart products.
- Writes cart changes through `PUT /mobile-services/order/v1/items?sortBy=DEFAULT`.
- Applies successful cart changes immediately in Home Assistant and reconciles with AH after about 1 second.
- Protects recent cart writes from stale AH responses for up to 20 seconds, matching the shopping-list conflict strategy.
- Adds `ah_shopping.set_cart_quantity` and `ah_shopping.remove_cart_product` services.
- Keeps `product_source: next_order` and `product_source: cart_and_order` read-only.
- Cart total price remains the last AH-calculated total while a quantity write is pending; AH recalculates it on the reconciliation refresh.



### 0.2.3

- Adds an active AH shopping-cart sensor using `/mobile-services/order/v1/summaries/active?sortBy=DEFAULT`.
- Adds dashboard `product_source` choices for shopping list, active cart, next scheduled order, or cart + order combined.
- Combined cart/order view merges identical products and sums their quantities.
- Cart/order product views are intentionally read-only; +/- remains limited to the shopping list.
- The scanner continues to add products to the shopping list regardless of the displayed product source.
- Card title defaults to the selected product source unless a custom title is configured.



### 0.2.2

- Removes the product-search bar from the dashboard card.
- Makes the scan button full width.
- Adds independent card options `show_header`, `show_scan` and `show_products`.
- Keeps legacy `mode: scan_only` cards working.
- Adds `sensor.albert_heijn_next_order` for the earliest open scheduled AH fulfillment.
- The next-order sensor exposes total quantity, unique product count, delivery slot, total order price, modifiable status and all product lines with quantity/price/Bonus/category details.



### 0.2.1

- Reverts the writable native To-do/checkbox functionality; the native To-do entity is read-only again.
- Scanner is now a continuous session: up to 60 seconds before the first successful scan.
- After a successful scan, the camera remains active for 5 seconds; every subsequent successful scan resets that 5-second window.
- Keeps the camera running while barcode lookups and list writes are processed.
- Prevents the same barcode from being selected repeatedly while it remains in view. To scan the same product again, move it out of frame briefly and present it again.
- Shows the latest successfully scanned product in a panel to the right of the camera, including image, product name, price, Bonus information, current list quantity and +/- controls.
- On narrow screens the scanned-product panel moves below the camera.



### 0.2.0

- Preserves the internal list scroll position across quantity/state updates, so +/- on a bottom item no longer jumps the card back to the top.
- Fixes product search for both AH `products` and `data` response shapes and normalises alternate title/price/unit/image fields.
- Adds visible search states: searching, no results and errors.
- Adds an in-card manual refresh button and shows pending sync changes.
- Adds checked/completed state to list items and a checkbox in the custom card.
- Makes the native Home Assistant To-do entity writable: create free-text items, check/uncheck and delete.
- Quantity writes now preserve item description and checked state.
- Adds conflict-safe reconciliation: local successful writes are protected against stale immediate reads, then reconciled back to AH.
- Serializes writes for the same product.
- Adds configurable full polling interval (1–60 minutes, default 5).
- Adds list diagnostics attributes: `last_synced`, `pending_changes`, and `update_interval_seconds`.



### 0.1.13

- Plays a short locally generated checkout-scanner beep after a barcode has been resolved and successfully added to the AH list.
- Keeps the scanner open after a successful scan and shows product image, name, current price, unit size and Bonus label.
- Adds +/- quantity controls directly to the scan result.
- Adds "Scan volgende" and "Klaar" actions instead of auto-closing the scanner after one second.
- Newly scanned products are inserted into the Home Assistant coordinator immediately, before the background AH refresh completes.
- Keeps an active scanner modal open while Home Assistant entity updates arrive, preventing scan-result UI from disappearing mid-flow.



### 0.1.12

- Adds ZXing 0.23.0 as the primary barcode fallback for browsers without native BarcodeDetector, including Microsoft Edge contexts where BarcodeDetector is unavailable.
- Scanner order is now: native BarcodeDetector → ZXing → bundled lightweight EAN fallback.
- ZXing reuses the already-open camera feed; it does not request a second camera session.
- Scanner status shows whether native, ZXing or local fallback is active and counts processed frames.
- Prevents duplicate custom-element registration if Home Assistant loads the card module twice.



### 0.1.11

- Quantity changes no longer wait for the full shopping-list/product refresh.
- After a successful AH PATCH, Home Assistant updates the local coordinator immediately and refreshes the complete list in the background.
- The dashboard card keeps a per-product pending quantity and serialises rapid +/- clicks, so repeated taps are not ignored while a previous write is in flight.



### 0.1.10

- Adds `mode: scan_only` for a compact scanner-only dashboard card.
- Adds configurable `height` in pixels for the full card.
- When a fixed height is configured, the product list scrolls internally while the header/search controls remain visible.
- Adds optional `scan_label` for the scanner-only button.



### 0.1.9

- Uses the browser/WebView native `BarcodeDetector` for EAN/UPC scanning when available.
- Falls back to the bundled local EAN decoder when native detection is unavailable.
- Shows live scanner diagnostics including decoder mode and scanned frame count.
- Requests a higher camera resolution for improved barcode recognition.
- Adds a frontend cache-buster so Fully Kiosk/Home Assistant does not keep an older scanner script after updating.



### 0.1.8

- Uses the shopping-list product payload and product-detail endpoint as fallbacks when AH omits unavailable products from bulk product lookup.
- Calculates supported multi-buy Bonus savings, including `2e halve prijs`.
- Adds a Bonus savings sensor.
- Regression-tested against a real list where €32.02 subtotal minus €2.89 Bonus equals the AH app total of €29.13.



### 0.1.7

- Fixes list totals when AH returns prices as nested money objects such as `{"amount": 1.10}`.
- Supports doubly nested money values used by some AH API responses.



### 0.1.6

- Fixes empty AH list parsing for the current shoppinglist v2 response.
- Reads product IDs from nested `productDetails.product.webshopId`.
- Keeps free-text AH list items visible instead of dropping them.
- Uses the current `orderBy=userInput&orderByParam=0` list read URL.
