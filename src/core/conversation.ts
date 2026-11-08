/**
 * The conversation this process is working on, for gateways that route and cache by it
 * (OpenCode Go/Zen: `x-opencode-session`, "a stable session ID … for each conversation").
 * One conversation runs at a time per process: the TUI's session, `ot -p`'s, one eval
 * question. The session layer sets it when a conversation starts, resumes or is cleared;
 * side calls (title, web side model, auto-mode reviewer) read it at request time. A
 * subagent is its own conversation and passes its id explicitly instead (agent.ts).
 */
let current: string | undefined

export function setConversation(id: string | undefined) {
  current = id || undefined
}

export const conversationId = () => current

/** A subagent's own conversation id: stable for that agent, grouped under its session. */
export const childConversation = (session: string | undefined, agentId: string) => `${session || "session"}/${agentId}`
