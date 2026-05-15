import "dotenv/config";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);

createApp().listen(port, "127.0.0.1", () => {
  console.log(`Continuity Layer API listening at http://127.0.0.1:${port}`);
});
