import { defineRailway, project, service } from "railway/iac";

// Last resort for a per-service CaC repo. Prefer one .railway file for the
// project and drop this if you later combine services into that file.
export const partial = "tubo";

export default defineRailway(() => {
  const tubo = service("tubo", {
    start: "npx tsx apps/api/src/index.ts",
    healthcheck: "/health",
    // builder from CaC: "NIXPACKS"
  });
  return project("imaginative-solace", {
    resources: [tubo],
  });
});
