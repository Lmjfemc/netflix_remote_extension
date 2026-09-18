const $ = (id) => document.getElementById(id);
let shown = "";
$("extensionId").textContent = chrome.runtime.id;
async function update(type = "status") {
  try {
    const s = await chrome.runtime.sendMessage({ type });
    const busy = s.running || s.starting || s.reconnecting;
    $("start").disabled = busy;
    $("stop").disabled = !busy;
    $("status").textContent = s.running
      ? "● 리모컨 서버 실행 중"
      : s.starting
        ? "서버 시작 중…"
        : s.reconnecting
          ? `서버 재연결 중… (${s.attempts}회 시도)`
          : "서버 꺼짐";
    $("error").textContent = !s.error
      ? ""
      : s.reconnecting
        ? `연결 끊김: ${s.error} 자동으로 다시 연결합니다.`
        : `서버 연결 실패: ${s.error} 보조 프로그램 설치를 확인하세요.`;
    $("pairing").hidden = !s.running;
    // The host re-issues "ready" when the PC's LAN address changes; the code
    // stays the same then, so key the re-render on code plus links.
    const sig = s.setup ? s.setup.code + "|" + s.setup.links.join("|") : "";
    if (s.setup && shown !== sig) {
      shown = sig;
      $("qr").src = s.setup.qr;
      $("code").textContent = s.setup.code;
      $("links").replaceChildren();
      for (const url of s.setup.links) {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.textContent = url.split("/#")[0];
        const p = document.createElement("p");
        p.append(a);
        $("links").append(p);
      }
    }
  } catch (e) {
    $("error").textContent = e.message;
  }
}
$("start").onclick = () => update("start");
$("stop").onclick = () => update("stop");
$("rotate").onclick = () => update("rotate");
update();
setInterval(() => update(), 1000);
