import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";

test("fixed extension key matches native host allowlist", () => {
  const manifest = JSON.parse(fs.readFileSync("extension/manifest.json"));
  const id = [
    ...createHash("sha256")
      .update(Buffer.from(manifest.key, "base64"))
      .digest()
      .subarray(0, 16),
  ]
    .map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15)))
    .join("");
  const host = JSON.parse(fs.readFileSync("native-host.json"));
  assert.deepEqual(host.allowed_origins, [`chrome-extension://${id}/`]);
  assert.equal(host.path, "netflix-remote.exe");
});

test(
  "CMD install, upgrade, missing payload and safe uninstall",
  {
    skip: process.platform !== "win32" || process.env.TEST_INSTALLER !== "1",
  },
  () => {
    // Only fixture copies use this isolated key and LocalAppData. Never touch the live host.
    const root = path.resolve(
      ".tools",
      `installer-${randomUUID()} 한글 & test!(x)`,
    );
    const source = path.join(root, "release");
    const appData = path.join(root, "local");
    const target = path.join(appData, "NetflixRemote");
    const key = `HKCU\\Software\\NetflixRemoteInstallerTests\\${randomUUID()}`;
    fs.mkdirSync(path.join(source, "dist"), { recursive: true });
    fs.mkdirSync(path.join(source, "extension"));
    for (const name of fs.readdirSync("extension")) {
      fs.copyFileSync(
        path.join("extension", name),
        path.join(source, "extension", name),
      );
    }
    fs.copyFileSync("native-host.json", path.join(source, "native-host.json"));
    for (const name of ["install.cmd", "uninstall.cmd"]) {
      const script = fs
        .readFileSync(name, "utf8")
        .replace(
          "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.netflixlan.remote",
          key,
        );
      fs.writeFileSync(path.join(source, name), script);
    }
    const exe = process.env.NATIVE_HOST_EXE || "dist/netflix-remote.exe";
    fs.copyFileSync(exe, path.join(source, "dist", "netflix-remote.exe"));
    const run = (name) =>
      spawnSync(
        "cmd.exe",
        ["/d", "/s", "/c", `""${path.join(source, name)}" /quiet"`],
        {
          windowsVerbatimArguments: true,
          windowsHide: true,
          env: { ...process.env, LOCALAPPDATA: appData },
          encoding: "utf8",
        },
      );
    const reg = (...args) =>
      spawnSync("reg.exe", args, { encoding: "utf8", windowsHide: true });
    const ok = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);
    try {
      ok(run("install.cmd"));
      assert.deepEqual(
        fs.readFileSync(path.join(target, "netflix-remote.exe")),
        fs.readFileSync(exe),
      );
      assert.equal(reg("query", key, "/ve").status, 0);
      fs.writeFileSync(path.join(target, "keep.txt"), "unrelated");
      fs.writeFileSync(
        path.join(source, "extension", "popup.css"),
        "/* upgrade */",
      );
      ok(run("install.cmd"));
      assert.equal(
        fs.readFileSync(path.join(target, "extension", "popup.css"), "utf8"),
        "/* upgrade */",
      );
      fs.renameSync(
        path.join(source, "native-host.json"),
        path.join(source, "missing.json"),
      );
      assert.notEqual(run("install.cmd").status, 0);
      assert.equal(reg("query", key, "/ve").status, 0);
      ok(run("uninstall.cmd"));
      assert.notEqual(reg("query", key, "/ve").status, 0);
      assert.equal(
        fs.existsSync(path.join(target, "netflix-remote.exe")),
        false,
      );
      assert.equal(
        fs.readFileSync(path.join(target, "keep.txt"), "utf8"),
        "unrelated",
      );
      ok(run("uninstall.cmd"));
      ok(
        reg(
          "add",
          key,
          "/ve",
          "/t",
          "REG_SZ",
          "/d",
          "C:\\OtherInstall\\host.json",
          "/f",
        ),
      );
      ok(run("uninstall.cmd"));
      assert.equal(reg("query", key, "/ve").status, 0);
    } finally {
      reg("delete", key, "/f");
      // Retain fixture files for inspection; no recursive deletion of computed paths.
    }
  },
);
