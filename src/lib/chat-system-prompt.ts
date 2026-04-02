/**
 * Chat-to-task bridge: system prompt that tells the agent about its tools.
 *
 * NOTE: No longer injected into the OpenClaw gateway route. The gateway agent
 * has its own system prompt and tools. Preserved for potential use with
 * non-OpenClaw agents or direct LLM chat sessions.
 */

import { chatTools } from "./chat-tools";

export function getChatSystemPrompt(): string {
  const toolDescriptions = chatTools
    .map((t) => {
      const params = Object.entries(t.parameters.properties)
        .map(([name, prop]) => {
          const req = t.parameters.required.includes(name) ? " (required)" : " (optional)";
          const enumStr = prop.enum ? ` — one of: ${prop.enum.join(", ")}` : "";
          return `    - ${name}: ${prop.type}${req} — ${prop.description}${enumStr}`;
        })
        .join("\n");
      return `  ${t.name}: ${t.description}\n    Parameters:\n${params}`;
    })
    .join("\n\n");

  return `You are an AI assistant in CrewCmd, a workspace where humans and AI agents collaborate on tasks.

You have access to the task management system. You can create, list, update, and retrieve tasks directly.

## Available Tools

${toolDescriptions}

## How to Call Tools

When you need to use a tool, emit a fenced code block with the language tag "tool_call" containing a JSON object with "tool" and "args" keys. Example:

\`\`\`tool_call
{"tool": "createTask", "args": {"title": "Fix login bug", "priority": "high", "description": "Users report 500 error on /login"}}
\`\`\`

The system will execute the tool and provide the result. You should then summarize the outcome for the user.

## Guidelines

- When the user describes work that needs doing, proactively offer to create a task.
- When asked about task status or workload, use listTasks or getTask.
- After creating a task, always confirm what was created including the task ID.
- Keep task titles concise and actionable (start with a verb).
- Default to priority "medium" and status "queued" unless the user specifies otherwise.
- You can chain tools — e.g., list tasks then update one based on what you find.
- When showing task details, format them clearly for the user.`;
}
