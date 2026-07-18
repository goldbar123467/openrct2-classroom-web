const [expectedCommit, rawUrl = "https://openrct2-classroom-web.vercel.app"] = process.argv.slice(2);

if (!/^[0-9a-f]{40}$/i.test(expectedCommit ?? "")) {
  throw new Error("Usage: node scripts/wait-for-production.mjs <40-character-commit> [https-url]");
}
const productionUrl = new URL(rawUrl);
if (productionUrl.protocol !== "https:") throw new Error("Production verification requires HTTPS.");

const deadline = Date.now() + Number(process.env.DEPLOY_WAIT_MS ?? 12 * 60 * 1000);
const expected = expectedCommit.toLowerCase();
let lastSeen = "unreachable";

while (Date.now() < deadline) {
  try {
    const response = await fetch(productionUrl, {
      cache: "no-store",
      headers: { "cache-control": "no-cache", pragma: "no-cache" },
    });
    const html = await response.text();
    const match = html.match(/<meta\s+name=["']parkworks-commit["']\s+content=["']([^"']+)["']/i);
    lastSeen = `${response.status}/${match?.[1] ?? "missing-marker"}`;
    if (response.ok && match?.[1]?.toLowerCase() === expected) {
      console.log(`Production now serves exact commit ${expected} at ${productionUrl}.`);
      process.exit(0);
    }
  } catch (error) {
    lastSeen = error instanceof Error ? error.message : String(error);
  }
  console.log(`Waiting for ${expected.slice(0, 12)}; production is ${lastSeen}.`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

throw new Error(`Production did not reach ${expected}; last observation: ${lastSeen}.`);
