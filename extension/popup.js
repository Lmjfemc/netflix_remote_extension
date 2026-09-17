const $ = (id) => document.getElementById(id);
let shown = "";
$("extensionId").textContent = chrome.runtime.id;
async function update(type = "status") {
  try {
    const s = await chrome.runtime.sendMessage({ type });
    $("start").disabled = s.running || s.starting;
    $("stop").disabled = !s.running && !s.starting;
    $("status").textContent = s.running
      ? "● 리모컨 서버 실행 중"
      : s.starting
        ? "서버 시작 중…"
        : "서버 꺼짐";
    $("error").textContent = s.error
      ? `서버 연결 실패: ${s.error} 보조 프로그램 설치를 확인하세요.`
      : "";
    $("pairing").hidden = !s.running;
    if (s.setup && shown !== s.setup.code) {
      shown = s.setup.code;
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
update();
setInterval(() => update(), 1000);
