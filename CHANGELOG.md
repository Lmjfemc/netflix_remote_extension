# Changelog

## 0.3.0 — 2026-09-19

- Review fixes: reject revoked WebSocket keys again after upgrade; return
  retryable 503 while native hello restores pairing, without publishing a
  temporary key on a timeout. Upgrade the extension and helper together.
- Retain the last browse catalog across fresh watch documents while allowing
  real empty search results to clear it; ignore catalog messages from old documents.
- Preserve pending address-change notifications when Host validation refreshes
  addresses before the ticker; explicit Stop wins over delayed intent restoration.
- Add deterministic upgrade/reset, startup authentication, address notification,
  document transition and worker reconnect regression tests.

- Pairing survives helper restarts. The extension stores the session key in
  `chrome.storage.local` and hands it back to a new helper through a `hello`
  message; the phone keeps the key in `localStorage`, verifies it with
  `POST /session` before each reconnect (204 valid, 401 reset) and retries with
  2 s to 15 s backoff while the PC is unreachable instead of forgetting the key
  after three failures. A new popup button, 연결 초기화, rotates key and code
  and disconnects the current phone with close code 4002. `/setup` never
  exposes the key.
- Host validation follows network changes: the helper re-reads its LAN
  addresses every 3 s and on the first request from an unknown host (at most
  once per second), re-issues the pairing links/QR to the popup and `/pc`
  page, and no longer needs a restart after the PC moves to another Wi-Fi.
- Netflix adapter robustness: a controller without React state no longer
  throws inside the title fallback; an exception anywhere in the 750 ms
  publish still emits a heartbeat carrying `warning`, so the phone shows the
  reason instead of "Waiting for PC"; a watch page whose player API stays
  missing for 8 s reports "Netflix player API not found" (likely a Netflix
  change). Button/fiber DOM scans now run only while a player is active, the
  React fiber walk is cached per player element and the card scan is skipped
  on watch pages, cutting per-tick DOM work on the large browse page.
- The extension restarts the helper automatically when the Native Messaging
  port drops without the user pressing Stop (helper crash, service worker
  restart). Backoff grows from 1 s to 30 s for up to 10 tries; the popup shows
  "reconnecting" with the attempt count and the last error. The "keep it
  running" intent is held in extension session storage, so a restarted worker
  resumes it without touching disk.
- Catalog is sent as its own message only when the card list changes, or when
  the extension asks for a resync, instead of riding on every 750 ms state
  heartbeat. This removes tens of KB per second of redundant native-messaging,
  LAN and phone-side JSON work; the phone still gets the list on connect.

## 0.2.1

- Fixed unpacked extension ID; no manual extension ID entry during installation.
- Pure CMD install/uninstall replaces the PowerShell host registration scripts.
- Per-user installation copies the helper and extension into `%LOCALAPPDATA%\NetflixRemote`.
- Updates reuse the same installed path; uninstall preserves unrelated files and other host registrations.
- Optional Private-LAN firewall script now targets the installed helper.
- Existing 0.2.0 users must stop/remove the old extension and load the installed extension once.
- This changes installation convenience, not Windows executable trust: the helper remains unsigned.

## 0.2.0

First GitHub release of the Windows / Chrome LAN prototype.

- Go native host embeds the phone remote and PC pairing pages in one EXE.
- Chrome extension starts/stops the helper through Native Messaging.
- QR and six-digit pairing, one active phone, no cloud signaling or account.
- Netflix catalog selection, search, playback state, play/pause, volume/mute,
  fullscreen, next episode, timeline scrubbing and ±10-second seeking.
- Manual/automatic intro skip and a separate manual recap-skip button.
- Serialized seek targets accumulate rapid taps; manual seeks suppress
  automatic intro skipping for the current segment.
- Per-user Windows registration, optional Private-network firewall script,
  build/package scripts, automated adapter and native-host tests.
- Previous Node relay retained under `legacy/` for reference.

Known limits: unsigned unpacked extension and unsigned Windows x64 helper;
trusted LAN HTTP only; pairing resets on server restart; physical-phone
reachability and live recap availability require environment-specific checks.
