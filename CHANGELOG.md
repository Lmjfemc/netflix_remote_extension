# Changelog

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
