import type { RunService } from "./pipeline.js";

/**
 * A single live RunService is registered by whichever process (API or worker)
 * drives the pipeline, so background job handlers can run the SAME engine as
 * the manual path without inventing a second reasoning system.
 */
let service: RunService | null = null;

export function setPipelineService(s: RunService): void {
  service = s;
}

export function getPipelineService(): RunService | null {
  return service;
}
