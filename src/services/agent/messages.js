import { buildMessages } from "../aiService.js";
import { AGENT_PROMPT, capabilitySummary } from "./prompt.js";

// The message array for an agent turn.
//
// Built by CALLING `buildMessages` rather than reimplementing it, so the
// digest-first ordering, the rules message, the scope sentence and the
// `CONTEXT:\n…\n\nQUESTION:` framing all stay exactly as they are — and every
// assertion in tests/ai-assistant.test.js keeps holding.
//
// The agent's own instructions go in as an extra system message positioned
// after the rules and before the history, and only when there are tools to
// explain. With none, this returns precisely what the retrieval path returns.

export function buildAgentMessages({
  message,
  context,
  history = [],
  productName = null,
  routeContext = null,
  toolNames = [],
  attachmentParts = [],
}) {
  const base = withAttachments(
    buildMessages({ message, context, history, productName, routeContext }),
    attachmentParts
  );
  if (!toolNames.length) return base;

  const agentMessage = {
    role: "system",
    content: AGENT_PROMPT + capabilitySummary(toolNames),
  };

  // Inserted after the last system message rather than at a fixed index. The
  // digest is optional (it is absent when content/ has not been crawled), so
  // a hardcoded position would put the agent rules before the rules on some
  // deployments and after them on others.
  let lastSystem = -1;
  for (let i = 0; i < base.length; i++) if (base[i].role === "system") lastSystem = i;

  return [...base.slice(0, lastSystem + 1), agentMessage, ...base.slice(lastSystem + 1)];
}

/**
 * Hangs this turn's files on the question being asked.
 *
 * On the LAST user message and nowhere else. Everything before it is the
 * cached prefix -- the digest, the rules, the history -- and it has to be
 * byte-identical from one request to the next for the provider's prompt cache
 * to hit. Splicing a 1.5MB data URL into an earlier message rewrites that
 * prefix on every single turn and silently forfeits the cache, which is the
 * difference between a cheap follow-up and a full re-read of the whole
 * conversation.
 *
 * The text part keeps its original position, first: the model reads the
 * question, then looks at what it was given.
 */
function withAttachments(messages, parts) {
  if (!parts?.length) return messages;
  let last = -1;
  for (let i = 0; i < messages.length; i++) if (messages[i].role === "user") last = i;
  if (last === -1) return messages;

  const original = messages[last];
  const text = typeof original.content === "string" ? original.content : "";
  return [
    ...messages.slice(0, last),
    { ...original, content: [{ type: "text", text }, ...parts] },
    ...messages.slice(last + 1),
  ];
}

/**
 * The assistant turn that requested tools, in the shape the provider expects
 * back.
 *
 * `content` must be a string even when empty: several OpenAI-compatible
 * endpoints reject `null` here, and the model's own filler prose belongs in
 * the record anyway.
 */
export function toAssistantToolMessage(turn) {
  return {
    role: "assistant",
    content: turn.content || "",
    tool_calls: turn.toolCalls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
    })),
  };
}
