/**
 * @praxis/shared — the contract both the Praxis frontend and the /server agent
 * backend build against. Phase 1 ships the types + constants; the generated
 * Aegis IDL and a typed client are added in Milestone 2.
 */

export * from "./constants";
export * from "./types";
export * from "./serde";
export * from "./provider";
