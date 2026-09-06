// Single-resolution barrel re-export of the core package source, so all API
// modules import core types/values from exactly one module path (avoids the
// "two types with this name" dual-module problem in a not-yet-built workspace).
export * from "../../../packages/core/src/index.js";
