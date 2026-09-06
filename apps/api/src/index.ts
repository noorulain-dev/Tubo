import { serve } from "@hono/node-server";
import { createSampleApp } from "./sample.js";

const authToken = process.env.AUTH_TOKEN || undefined;
const { app } = createSampleApp({ authToken });

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`Revenue Execution OS API listening on http://localhost:${info.port}`);
});
