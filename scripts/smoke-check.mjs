const targets = [
  ["API", process.env.PCA_SMOKE_API_URL ?? "http://127.0.0.1:8787/api/projects"],
  ["Client", process.env.PCA_SMOKE_CLIENT_URL ?? "http://127.0.0.1:5173"]
];

let failed = false;

for (const [name, url] of targets) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      failed = true;
      console.error(`${name} smoke check failed: ${response.status} ${response.statusText}`);
    } else {
      console.log(`${name} smoke check passed: ${url}`);
    }
  } catch (error) {
    failed = true;
    console.error(`${name} smoke check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) process.exit(1);
