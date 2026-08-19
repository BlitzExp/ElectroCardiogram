import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the CardioScope monitor", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>CardioScope — ECG Monitor<\/title>/i);
  assert.match(html, /CardioScope/);
  assert.match(html, /Connect USB/);
  assert.match(html, /Enable sound/);
  assert.match(html, /Demo signal/);
  assert.match(html, /Not for diagnostic use/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("removes the starter preview and documents the serial contract", async () => {
  const [page, readme, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  assert.match(page, /requestPort/);
  assert.match(page, /baudRate: BAUD_RATE/);
  assert.match(readme, /250 Hz/);
  assert.match(readme, /Serial\.println/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
