# ELECTRO Sandy — Full Product Development Plan

## Working rules
- All work stays on `feature/electro-sandy-complete-suite`; never commit to `main`.
- Preserve the Arabic, English and French interface, including RTL/LTR behavior.
- Keep core sales and inventory workflows usable offline.
- Protect existing local business data. Every migration, restore, sync or update must be reversible or backed up.
- A feature is complete only after automated regression tests and, where Android/native behavior is involved, device validation.
- Firebase rules/configuration and production services are not changed or published automatically.

## Current code inventory (source inspection only; runtime status is not implied)
The current application source already contains implementations or UI flows for:
- Products: create/edit/delete, product photos, barcode fields, warranty and minimum-stock fields.
- Sales: cart, discounts, customer selection, payment methods including mixed payment, invoice display/print/share.
- Stock: central stock, two representative/vehicle stock lists, transfers, stock audits.
- Customers: profiles, statements, loyalty points and debt collection.
- Suppliers and purchases: supplier profiles/accounts, purchase payments and price comparison.
- Returns and warranties.
- Cash entries, daily cash closing, financial reports, profit insights and Excel/PDF-style exports.
- User accounts, roles, PIN authentication, optional biometrics, activity log and auto-lock.
- Local backup export/import and Firebase snapshot sync with optional automatic sync.
- Voice search, camera barcode scan, notifications and three-language support.

These are code-level observations, not proof that every screen or flow is bug-free. Each item must be covered by behavior tests and device checks.

## Implemented on this branch
- Added a dedicated optional internal SKU field, separate from the barcode.
- SKU values are trimmed and compared case-insensitively; duplicate references are rejected while editing the same product remains valid.
- SKU is preserved on create/edit, included in product search and displayed in the product list.
- Added Arabic, English and French translations for the new field and duplicate-SKU validation.
- Added regression tests and included them in the GitHub Actions test command.
- Added product archiving/restoration so historical products are retained instead of deleted; archived products are excluded from sales and blocked from cart insertion.
- Prevented archiving while the product is in the active cart and roll back the archive flag if local persistence fails.
- Added Arabic, English and French translations and automated tests for archive/restore behavior.
- Product-management search now includes the internal SKU as well as name, category and barcode.
- Stock transfers now create durable movement-ledger entries in the existing stock-audit dataset, including source/destination, quantity, actor, timestamp and moved serial numbers; the stock history displays these entries alongside stocktakes.
- Archived products are blocked from stock transfers, and insufficient serial-number inventory is rejected before movement.
- Added automated transfer-ledger and serial-movement regression tests.

## Feature work still required

### P0 — Data safety and reliability
1. Add a versioned data schema and safe migrations; validate old backups before any write.
2. Make restore transactional: snapshot current data, validate the full incoming backup, restore, verify, and roll back on any failure.
3. Add backup integrity metadata (schema version, timestamp, checksum), preview-before-restore and clear recovery instructions.
4. Harden image handling: MIME/content sniffing, size limits, orientation, corrupt-file errors, multi-image edit/replace, and storage quota handling.
5. Audit all destructive actions and ensure confirmation, audit entries and dependent-record handling.
6. Add automated tests for offline use, app restart, storage quota/full storage, malformed backups and migration from older versions.

### P1 — Complete inventory and warehouse operations
1. Add SKU/internal reference, manufacturer/model, category and supplier reference fields with duplicate detection.
2. Add per-unit serial/IMEI tracking with unique validation, warranty linkage and traceability through purchase, transfer, sale and return.
3. Support configurable multiple warehouses/vehicles rather than hard-coded locations; retain the current central store and vehicle workflows as defaults.
4. Add transfer lifecycle: draft, sent, accepted, partially received, rejected and cancelled, with actor/time history.
5. Add stock movement ledger, stock adjustment reasons, damaged/lost/returned stock and discrepancy resolution.
6. Add stock valuation methods and warnings for negative stock or selling below cost.

### P1 — Sales, customers and suppliers
1. Complete returns/exchanges with refund method, restocking decision and invoice linkage.
2. Add installment schedules, due dates, partial payments, customer/supplier account statements and aging summaries.
3. Add customer and supplier import/export with duplicate checks and validation preview.
4. Add invoice numbering rules, configurable tax/discount fields, printable receipt layouts and shareable PDF.
5. Add supplier purchase returns, landed costs and full purchase-to-stock traceability.

### P1 — Cash and accounting controls
1. Add opening float, cash movements, transfers between cash/bank, expenses by category and payment reconciliation.
2. Add immutable closeout records with reopen permission and reason; compare expected vs counted balances.
3. Add gross margin/net profit calculations that consistently include purchase cost, discounts, returns and expenses.
4. Add audit-ready exports and date-filtered reports per seller, vehicle, warehouse, product and payment method.

### P2 — Dashboard, alerts and automation
1. Dashboard KPIs: sales, margin, expenses, cash/bank, debts, stock alerts and seller/vehicle performance.
2. Alerts for low stock, expiry/warranty, overdue installments, unusual expenses and slow-moving stock.
3. Reorder suggestions based on sales velocity, lead time and minimum stock; always require user confirmation before purchase.
4. Scheduled local reports and optional notifications, respecting Android notification permissions.

### P2 — Cloud sync and multi-device
1. Preserve offline-first behavior and current snapshot protocol until a tested migration path exists.
2. Add visible sync state, last successful sync, retry controls and a conflict review screen.
3. Add conflict-safe record-level synchronization only after defining stable record IDs, versioning, tombstones and idempotency.
4. Add device registration/revocation, account ownership checks, least-privilege Firestore rules and retention policy.
5. Verify two or more real devices, simultaneous edits, offline edits, account switching and recovery before enabling by default.

### P2 — Automatic app updates
1. Add a signed release manifest with version, minimum supported version, release notes and APK checksum.
2. Check for updates only when online; show version/size and allow defer/cancel.
3. Download to app-private storage, verify checksum and signature, then invoke Android's supported package installer flow with explicit user approval where required.
4. Never bypass Android install permissions or silently install an APK.
5. Keep the previous installed version/data safe and provide a documented recovery path. Test interrupted downloads and low-storage cases.

### P3 — Advanced usability
- Thermal printer profiles and receipt-width settings.
- Faster barcode/QR workflows and camera permission handling.
- Advanced search/filtering, bulk edit, CSV/Excel import and export.
- Optional AI-assisted summaries/reorder insights only with clear privacy controls; no automatic financial or stock changes.
- Full Arabic/English/French coverage for dynamic messages, dialogs, validation, accessibility labels and printed documents.

## Delivery phases and exit criteria
1. **Baseline & safety:** run the full test suite, inspect open defects, record data schema and backup compatibility. No feature rollout until baseline is green.
2. **Inventory & sales integrity:** serial traceability, movement ledger, transfer lifecycle, return/refund correctness. Tests cover purchase → transfer → sale → return.
3. **Finance & reporting:** cash closeout, debt/installments, supplier accounts and reconciliation. Independently verify representative calculations.
4. **Sync & update safety:** conflict review, multi-device tests, signed update manifest and interrupted-download tests.
5. **Polish & release:** three-language audit, accessibility, performance, Android device matrix, release build and recovery rehearsal.

## Definition of done
- No regression in existing product, sale, transfer, purchase, return, cash, backup or sync data.
- Unit/integration/static tests pass; Android build succeeds.
- Real-device checks cover camera, images, printing/sharing, biometrics, offline restart and cloud sync.
- Arabic/English/French content and direction are correct.
- Changes are documented and delivered in a draft PR for review. Nothing is merged to `main` without explicit approval.
