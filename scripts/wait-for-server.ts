import "dotenv/config";

import { setTimeout as delay } from "node:timers/promises";

const serverUrl = (process.env.A2A_SERVER_URL ?? "http://127.0.0.1:10000").replace(/\/$/, "");
const healthUrl = `${serverUrl}/healthz`;
const deadline = Date.now() + 15_000;

while (Date.now() < deadline) {
  if (await isServerReady(healthUrl)) {
    console.log(`A2A Server is ready: ${healthUrl}`);
    process.exit(0);
  }
  await delay(250);
}

throw new Error(`Timed out waiting for A2A Server: ${healthUrl}`);

async function isServerReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}
