# Validation — v0.2.1

## Installation update

- Fixed extension ID is derived from the manifest public key and matches the host allowlist.
- Pure CMD scripts tested with a separate test registry key and fixture LocalAppData, including Korean, spaces, ampersand, exclamation mark and parentheses in the path.
- Verified install, repeated install/upgrade, rejection of incomplete payloads, uninstall, repeated uninstall, preservation of unrelated files and preservation of registrations pointing elsewhere.
- Existing live Chrome registration was not changed by these tests.
- Registry-writing fixture test: `$env:TEST_INSTALLER='1'; node --test test/install.test.js`. It is skipped in the default suite and requires permission to write its isolated HKCU test key.
- The v0.2.1 extension migration has not yet been loaded into the user's live Chrome profile. Browser-download security prompts and a fresh Windows machine remain unverified.
- The playback observations below are from v0.2.0; this release changes packaging and installation, not playback logic.

This is a working local prototype. Passing tests do not imply compatibility with every Netflix title, browser update, or physical phone/network.

## Automated checks

- Three Go tests: bounded Native Messaging framing, Host/source/Origin guards, pairing, real WebSocket relay, acknowledgements and phone replacement.
- `go vet ./...`.
- Five adapter tests: accumulated forward taps, mixed-direction/scrub precedence, bounds, manual seek versus automatic intro skip, independent recap behavior and ad blocking.
- Two built-EXE tests: embedded assets from an unrelated working directory, pairing, native/phone command and acknowledgement relay, explicit stop, stdin EOF, listener cleanup.
- One legacy Node relay integration test retained for the archived implementation.

## Go / Chrome live checks

Tested in a logged-in Chrome profile using the actual Netflix player and a separate phone-side browser tab over the PC LAN address.

| Check | Observed result |
| --- | --- |
| Native host start | Extension popup started the Go EXE; pairing page and QR loaded. |
| Catalog and selection | Real Netflix cards reached the phone UI; selection opened a real watch page. |
| Pause | Netflix player reported paused after the phone command. |
| Three +10 taps | Actual position changed from 287.982 to 317.985 seconds. |
| Scrub | Phone slider requested 288 seconds; actual player reached 288.001 seconds. |
| Mute/unmute | Actual Netflix mute state changed; final state restored unmuted. |
| State synchronization | Phone matched the actual player time and paused state. |
| Restart/re-pair | New pairing code restored control after server restart. Refreshing Netflix restored an invalidated content context after extension reload. |
| Mobile layout | At 390px viewport, document width equaled viewport width; recap control stayed visible. |

The extension popup start/restart steps were performed manually. Automated native-process tests separately verified stop and EOF termination. The browser automation surface could not operate extension settings or its popup.

## Earlier Node-prototype live checks

Before the transport migration, real Netflix tests also covered backward seek, volume, Chrome fullscreen/restore, PC-to-phone pause state, catalog search, next episode, manual and automatic intro skip, ad controls and a separate Edge browser at 390 × 844. These are historical adapter checks, not a claim that every feature was repeated against Go.

## Resource observations

The initial Go build was 7,366,656 bytes (7.03 MiB). Release artifact hashes and sizes are supplied with each release.

A native-host sample reached readiness in 38.7 ms. Idle working set was 46.08 MiB and private memory 46.56 MiB, with 0 ms reported CPU during a five-second sample. A later live Chrome-launched sample showed 19.55 MiB working set and 52.63 MiB private memory. These are observations on one PC, not guaranteed limits or controlled benchmarks.

## Not yet verified

- Physical iOS/Android hardware and a second physical Wi-Fi device.
- End-to-end reachability through each user's Windows firewall/router.
- Successful live recap skip in an episode exposing the recap control.
- Full offline/installable PWA behavior (not claimed for LAN HTTP).

The migration did not change the PC network profile or add a Public-network firewall exception. The optional setup script only targets Private networks and LocalSubnet.
