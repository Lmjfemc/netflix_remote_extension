async function refresh() {
  try {
    const r = await fetch("/setup");
    if (!r.ok)
      throw Error("Open this page on the PC at http://localhost:8787/pc");
    const s = await r.json();
    document.getElementById("qr").src = s.qr;
    document.getElementById("code").textContent = s.code;
    const links = document.getElementById("links");
    links.replaceChildren();
    for (const url of s.links) {
      const p = document.createElement("p"),
        a = document.createElement("a");
      a.href = url;
      a.textContent = url.split("/#")[0];
      p.append(a);
      links.append(p);
    }
    document.getElementById("status").textContent = s.pc
      ? "● Netflix connected"
      : "Waiting for extension";
    document.getElementById("status").classList.toggle("online", s.pc);
    document.getElementById("help").textContent = s.pc
      ? "Ready. Pair your phone to start."
      : "Load the extension, then refresh your Netflix tab.";
  } catch (e) {
    document.getElementById("help").textContent = e.message;
  }
}
refresh();
setInterval(refresh, 3000);
