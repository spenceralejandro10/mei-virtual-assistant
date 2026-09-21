import puppeteer from "puppeteer-core";
import fs from "node:fs";

const chrome =
  process.env.CHROME_PATH ||
  "/usr/bin/google-chrome";

const browser = await puppeteer.launch({
  headless: true,
  executablePath: chrome,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=swiftshader",
    "--disable-dev-shm-usage"
  ]
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1 });

const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", error => pageErrors.push(String(error)));
page.on("console", msg => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.goto("http://127.0.0.1:4173/", {
  waitUntil: "domcontentloaded",
  timeout: 30000
});

try {
  await page.waitForFunction(
    () => window.Mei3D?.isReady?.() === true,
    { timeout: 120000 }
  );
} catch (error) {
  const boot = await page.evaluate(() => ({
    href: location.href,
    mei3dType: typeof window.Mei3D,
    readyFlag: window.__MEI_3D_READY__,
    loadingText: document.getElementById("mei3dLoading")?.textContent || null,
    canvas: (() => {
      const el = document.getElementById("mei3dCanvas");
      return el ? { width: el.width, height: el.height, clientWidth: el.clientWidth, clientHeight: el.clientHeight } : null;
    })(),
    resources: performance.getEntriesByType("resource")
      .map(r => ({ name: r.name, duration: r.duration, transferSize: r.transferSize }))
      .filter(r => /three|mei-yinn|mei-3d/i.test(r.name))
  }));
  const failureReport = { error: String(error), boot, pageErrors, consoleErrors };
  fs.writeFileSync("/tmp/mei-deep-test.json", JSON.stringify(failureReport, null, 2));
  await page.screenshot({ path: "/tmp/mei-deep-test.png", fullPage: true });
  console.error("MEI_BOOT_DIAGNOSTICS", JSON.stringify(failureReport, null, 2));
  await browser.close();
  throw error;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function quatDistance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z, a.w-b.w);
}

async function diag() {
  return await page.evaluate(() => window.Mei3D.getDiagnostics());
}

const initial = await diag();
if (!initial.ready) throw new Error("3D runtime did not report ready");
if (!initial.requiredBonesPresent) {
  throw new Error("Missing required bones: " + initial.missingBones.join(", "));
}

const bounds = initial.projectedBounds;
if (!bounds) throw new Error("Projected bounds unavailable");
const maxAbsX = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
const maxAbsY = Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y));
if (maxAbsX > 0.985 || maxAbsY > 0.985) {
  throw new Error("Model framing is clipped: " + JSON.stringify(bounds));
}
if (!initial.headProjected || Math.abs(initial.headProjected.x) > 0.95 || Math.abs(initial.headProjected.y) > 0.95) {
  throw new Error("Head is outside the visible camera area: " + JSON.stringify(initial.headProjected));
}

await page.evaluate(() => {
  window.Mei3D.setSpeaking(false);
  window.Mei3D.setState("idle");
});
await sleep(650);
const idle = await diag();

await page.evaluate(() => window.Mei3D.setSpeaking(true));
await sleep(650);
const speakingA = await diag();
await sleep(260);
const speakingB = await diag();

if (quatDistance(speakingA.snapshots.jaw, speakingB.snapshots.jaw) < 0.008) {
  throw new Error("Jaw does not animate while speaking");
}
if (quatDistance(idle.snapshots.head, speakingB.snapshots.head) < 0.006) {
  throw new Error("Head does not add natural movement while speaking");
}

await page.evaluate(() => {
  window.Mei3D.setSpeaking(false);
  window.Mei3D.setState("wave");
});
await sleep(700);
const wave = await diag();
if (quatDistance(idle.snapshots.upperArmR, wave.snapshots.upperArmR) < 0.08) {
  throw new Error("Wave state does not move the right arm enough");
}

await page.evaluate(() => window.Mei3D.setState("dance"));
await sleep(650);
const danceA = await diag();
await sleep(240);
const danceB = await diag();
if (quatDistance(danceA.snapshots.thighR, danceB.snapshots.thighR) < 0.008) {
  throw new Error("Dance state does not animate the leg");
}

await page.evaluate(() => {
  window.Mei3D.setState("idle");
  window.Mei3D.setSpeaking(false);
});
await sleep(350);

await page.screenshot({
  path: "/tmp/mei-deep-test.png",
  fullPage: true
});

const report = {
  initial,
  idle,
  speakingA,
  speakingB,
  wave,
  danceA,
  danceB,
  pageErrors,
  consoleErrors
};

fs.writeFileSync("/tmp/mei-deep-test.json", JSON.stringify(report, null, 2));

if (pageErrors.length) {
  throw new Error("Page errors: " + pageErrors.join(" | "));
}

const fatalConsoleErrors = consoleErrors.filter(msg =>
  !/favicon|speech|microphone|permission/i.test(msg)
);
if (fatalConsoleErrors.length) {
  throw new Error("Console errors: " + fatalConsoleErrors.join(" | "));
}

console.log("MEI_DEEP_TEST_PASS");
console.log(JSON.stringify({
  bones: initial.bones.length,
  animations: initial.animations.length,
  projectedBounds: initial.projectedBounds,
  headProjected: initial.headProjected,
  modelSize: initial.modelSize
}, null, 2));

await browser.close();
