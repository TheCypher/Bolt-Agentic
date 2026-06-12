import type { Agent } from "@bolt-ai/core";
import { createAgent, type AgentDefinition, isAgentDefinition } from "./agentDefinition";

export function defineAgent(def: Agent): Agent;
export function defineAgent(def: AgentDefinition): Agent;
export function defineAgent(def: Agent | AgentDefinition): Agent {
  if (!def) {
    throw new Error("defineAgent called with empty definition");
  }
  if (typeof (def as Agent).run === "function") {
    return def as Agent;
  }
  if (isAgentDefinition(def)) {
    return createAgent(def);
  }
  return createAgent(def as AgentDefinition);
}
