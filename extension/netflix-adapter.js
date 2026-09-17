// All Netflix runtime/DOM dependencies live here. No networking or credentials.
(() => {
  if (window.__netflixLanAdapter) return;
  window.__netflixLanAdapter = true;
  let autoSkip = false,
    lastSkip = 0,
    title = "",
    catalog = [],
    lastCatalog = 0;
  let seekTarget = null,
    seekTask = null,
    seekMovie = null,
    manualIntro = null;
  const visible = (e) => !!e && e.getClientRects().length > 0 && !e.disabled;
  const button = (selector) =>
    [...document.querySelectorAll(selector)].find(visible);
  const intro = () =>
    button(
      '[data-uia="player-skip-intro"], [data-uia="player-skip-intro-button"]',
    );
  const recap = () =>
    button(
      '[data-uia="player-skip-recap"], [data-uia="player-skip-recap-button"]',
    ) ||
    [...document.querySelectorAll("button")].find(
      (e) =>
        visible(e) &&
        /^(줄거리 건너뛰기|지난 이야기 건너뛰기|Skip Recap)$/i.test(
          (e.textContent || e.getAttribute("aria-label") || "").trim(),
        ),
    );
  const next = () =>
    button(
      '[data-uia="control-next"], [data-uia="next-episode-seamless-button"], [data-uia="next-episode-seamless-button-draining"]',
    );
  function player() {
    try {
      const api =
        window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const id = api
        .getAllPlayerSessionIds()
        .find((x) => x.startsWith("watch-"));
      return id ? api.getVideoPlayerBySessionId(id) : null;
    } catch {
      return null;
    }
  }
  // Netflix's own next button uses this controller's getNextEpisodicData.
  // Read only the title and next ID; never traverse account/authentication state.
  function controller() {
    const e = document.querySelector('[data-uia="player"]');
    let f = e?.[Object.keys(e).find((k) => k.startsWith("__reactFiber"))];
    for (let i = 0; f && i < 30; i++, f = f.return)
      if (typeof f.stateNode?.getNextEpisodicData === "function")
        return f.stateNode;
    return null;
  }
  function nextId() {
    try {
      const id = controller()?.getNextEpisodicData()?.id;
      return /^\d{1,12}$/.test(String(id)) ? String(id) : null;
    } catch {
      return null;
    }
  }
  function ads() {
    return !!button('[data-uia="ads-info-container"]');
  }
  function scan() {
    const found = new Map();
    for (const a of document.querySelectorAll(
      'a[href*="jbv="],a[href^="/title/"]',
    )) {
      const u = new URL(a.href),
        id =
          u.searchParams.get("jbv") || u.pathname.match(/\/title\/(\d+)/)?.[1],
        name = a.getAttribute("aria-label") || a.querySelector("img")?.alt;
      if (id && name && !found.has(id))
        found.set(id, {
          id,
          title: name,
          image: a.querySelector("img")?.src || "",
        });
    }
    if (found.size) catalog = [...found.values()].slice(0, 250);
  }
  function snapshot() {
    const p = player(),
      v = document.querySelector("video"),
      playingPage = location.pathname.startsWith("/watch/");
    const titleNode = document.querySelector('[data-uia="video-title"]');
    const t = titleNode
      ? titleNode.children.length
        ? [...titleNode.children]
            .map((e) => e.textContent.trim())
            .filter(Boolean)
            .join(" · ")
        : titleNode.textContent.trim()
      : "";
    if (t) title = t;
    else if (!playingPage) title = "";
    return {
      playingPage,
      ready: !!p && !!v,
      paused: p ? p.isPaused() : true,
      time: p ? p.getCurrentTime() / 1000 : 0,
      duration: p ? p.getDuration() / 1000 : 0,
      seekTarget: seekTarget === null ? null : seekTarget / 1000,
      seeking: seekTarget !== null,
      volume: p ? p.getVolume() : 1,
      muted: p ? p.isMuted() : false,
      title:
        title ||
        controller()?.state.videoMetadata?.getTitle() ||
        document.title.replace(/ - (Netflix|넷플릭스)$/, ""),
      videoId: p ? String(p.getMovieId()) : null,
      ad: ads(),
      canSkipIntro: !!intro(),
      canSkipRecap: !!recap(),
      canNext: !!nextId() || !!next(),
      autoSkip,
      url: location.pathname,
      updatedAt: Date.now(),
    };
  }
  const emit = (m) =>
    window.postMessage(
      { source: "netflix-lan-adapter", ...m },
      location.origin,
    );
  async function skipIntro() {
    const p = player();
    if (!intro() || ads()) throw Error("No intro skip button is available.");
    const now = p.getCurrentTime();
    const marker = p
      .getTimeCodes?.()
      .find(
        (x) =>
          x.type === "skip_credits" &&
          now >= x.startOffsetMs - 1000 &&
          now < x.endOffsetMs,
      );
    lastSkip = Date.now();
    if (marker) await seekTo(p, marker.endOffsetMs, false);
    else intro().click();
  }
  function suppressAutoIntro() {
    if (!manualIntro) return false;
    const p = player(),
      now = seekTarget ?? p?.getCurrentTime();
    if (
      p?.getMovieId() === manualIntro.movie &&
      now >= manualIntro.start &&
      now < manualIntro.end
    )
      return true;
    manualIntro = null;
    return false;
  }
  function publish() {
    try {
      if (Date.now() - lastCatalog > 3000) {
        scan();
        lastCatalog = Date.now();
      }
      if (
        autoSkip &&
        !seekTask &&
        !suppressAutoIntro() &&
        intro() &&
        !ads() &&
        Date.now() - lastSkip > 5000
      )
        skipIntro().catch(() => {});
      emit({ type: "state", state: snapshot(), catalog });
    } catch {}
  }
  function seekTo(p, target, manual = true) {
    if (seekTask && seekMovie !== p.getMovieId())
      return Promise.reject(
        Error("Playback changed during seeking. Please try again."),
      );
    seekTarget = Math.max(
      0,
      Math.min(Math.max(0, p.getDuration() - 1000), target),
    );
    seekMovie = p.getMovieId();
    if (manual) {
      const marker = p
        .getTimeCodes?.()
        .find(
          (x) =>
            x.type === "skip_credits" &&
            seekTarget >= x.startOffsetMs &&
            seekTarget < x.endOffsetMs,
        );
      manualIntro = marker
        ? {
            movie: seekMovie,
            start: marker.startOffsetMs,
            end: marker.endOffsetMs,
          }
        : null;
    }
    if (!seekTask) {
      // Coalesce rapid taps against the latest requested target, never a stale
      // player time. Only issue another seek after the previous one settles.
      seekTask = Promise.resolve()
        .then(async () => {
          const deadline = Date.now() + 5500;
          while (seekTarget !== null) {
            const target = seekTarget;
            if (player()?.getMovieId() !== seekMovie || ads())
              throw Error("Playback changed during seeking.");
            await p.seek(target);
            while (true) {
              await new Promise((r) => setTimeout(r, 60));
              const v = document.querySelector("video");
              if (player()?.getMovieId() !== seekMovie || ads())
                throw Error("Playback changed during seeking.");
              if (
                !v?.seeking &&
                Math.abs(p.getCurrentTime() - target) < 1200 &&
                (!v || Math.abs(v.currentTime * 1000 - target) < 1200)
              )
                break;
              if (Date.now() > deadline)
                throw Error(
                  "Netflix did not finish seeking. Please try again.",
                );
            }
            if (seekTarget === target) break;
            if (Date.now() > deadline)
              throw Error("Netflix did not finish seeking. Please try again.");
          }
        })
        .finally(() => {
          seekTarget = null;
          seekTask = null;
          seekMovie = null;
          publish();
        });
    }
    publish();
    return seekTask;
  }
  const finite = (v) => {
    if (typeof v !== "number" || !Number.isFinite(v))
      throw Error("Invalid numeric value");
    return v;
  };
  async function command(m) {
    const p = player();
    if (m.command === "autoSkip") {
      autoSkip = !!m.value;
      return;
    }
    if (m.command === "browse") {
      location.assign("/browse");
      return;
    }
    if (m.command === "search") {
      if (typeof m.value !== "string" || m.value.length > 100)
        throw Error("Invalid search");
      location.assign("/search?q=" + encodeURIComponent(m.value));
      return;
    }
    if (m.command === "select") {
      if (!/^\d{1,12}$/.test(m.value)) throw Error("Invalid title");
      sessionStorage.setItem("netflix-lan-play", m.value);
      location.assign("/title/" + m.value);
      return;
    }
    if (!p) throw Error("Start a Netflix title first.");
    switch (m.command) {
      case "play":
        await p.play();
        break;
      case "pause":
        p.pause();
        break;
      case "seek":
      case "seekBy":
        if (ads()) throw Error("Seeking is unavailable during ads.");
        await seekTo(
          p,
          m.command === "seek"
            ? finite(m.value) * 1000
            : (seekTarget ?? p.getCurrentTime()) + finite(m.value) * 1000,
        );
        break;
      case "volume":
        p.setVolume(Math.max(0, Math.min(1, finite(m.value))));
        break;
      case "mute":
        p.setMuted(!!m.value);
        break;
      case "skipIntro":
        await skipIntro();
        break;
      case "skipRecap": {
        const b = recap();
        if (!b || ads()) throw Error("No recap skip button is available.");
        const now = p.getCurrentTime(),
          marker = p
            .getTimeCodes?.()
            .find(
              (x) =>
                ["recap", "skip_recap"].includes(x.type) &&
                now >= x.startOffsetMs - 1000 &&
                now < x.endOffsetMs,
            );
        if (marker) await seekTo(p, marker.endOffsetMs);
        else b.click();
        break;
      }
      case "next":
        if (ads()) throw Error("Next episode is unavailable during ads.");
        if (nextId()) location.assign("/watch/" + nextId());
        else if (next()) next().click();
        else throw Error("Next episode is unavailable.");
        break;
      default:
        throw Error("Unsupported control");
    }
  }
  window.addEventListener("message", async (e) => {
    const m = e.data;
    if (
      e.source !== window ||
      m?.source !== "netflix-lan-content" ||
      m.type !== "command"
    )
      return;
    try {
      await command(m);
      emit({ type: "ack", id: m.id });
    } catch (err) {
      emit({ type: "ack", id: m.id, error: err.message });
    }
    publish();
  });
  const pending = sessionStorage.getItem("netflix-lan-play");
  if (pending) {
    let tries = 0;
    const timer = setInterval(() => {
      const a = document.querySelector('a[href^="/watch/"]');
      if (
        a &&
        (new URL(location.href).searchParams.get("jbv") === pending ||
          location.pathname === "/title/" + pending)
      ) {
        sessionStorage.removeItem("netflix-lan-play");
        clearInterval(timer);
        location.assign(a.href);
      } else if (++tries > 40 || location.pathname.startsWith("/watch/")) {
        sessionStorage.removeItem("netflix-lan-play");
        clearInterval(timer);
      }
    }, 500);
  }
  setInterval(publish, 750);
  publish();
})();
