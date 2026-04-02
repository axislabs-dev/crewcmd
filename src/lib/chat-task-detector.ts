/**
 * Heuristic task detector for chat responses.
 *
 * Scans agent response text for patterns that suggest actionable work items
 * (e.g. "I'll create a task", "let me fix", "we should build"). Returns
 * structured task suggestions that can be rendered as <!--action:create_task:...-->
 * markers for the frontend to display as CreateTaskCard components.
 *
 * This is a best-effort heuristic helper, not the primary task creation
 * mechanism. The primary flow is: agent includes action markers directly,
 * or the user creates tasks manually via the task board.
 */

interface TaskSuggestion {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
}

const ACTION_PATTERNS = [
  /I(?:'ll| will) (?:create|add|make|open) (?:a )?task/i,
  /(?:let me|I'll|I can|going to) (?:fix|build|create|implement|set up|write|add|update|deploy|configure)/i,
  /(?:we should|we need to|let's) (?:fix|build|create|implement|set up|write|add|update|deploy|configure)/i,
  /dispatching (?:a )?task/i,
  /assigning (?:this|that|it) to/i,
  /(?:creating|opening) (?:a )?(?:ticket|issue|task|PR|pull request)/i,
];

const PRIORITY_SIGNALS: Array<{ pattern: RegExp; priority: TaskSuggestion["priority"] }> = [
  { pattern: /\b(?:critical|urgent|emergency|outage|down|broken)\b/i, priority: "critical" },
  { pattern: /\b(?:important|high priority|asap|blocker)\b/i, priority: "high" },
  { pattern: /\b(?:low priority|nice to have|minor|cosmetic|when you get a chance)\b/i, priority: "low" },
];

/**
 * Detect actionable work items in agent response text.
 * Returns an array of task suggestions extracted from the text.
 */
export function detectActionableItems(text: string): TaskSuggestion[] {
  const hasAction = ACTION_PATTERNS.some((p) => p.test(text));
  if (!hasAction) return [];

  // Extract a title from the first sentence that matches an action pattern
  const sentences = text.split(/[.!?\n]/).map((s) => s.trim()).filter(Boolean);
  const actionSentence = sentences.find((s) =>
    ACTION_PATTERNS.some((p) => p.test(s))
  );

  if (!actionSentence) return [];

  // Clean up the sentence into a task title
  let title = actionSentence
    .replace(/^(?:I'll|I will|Let me|I can|Going to|We should|We need to|Let's)\s+/i, "")
    .replace(/\s+for (?:you|the team|us)$/i, "")
    .trim();

  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // Truncate overly long titles
  if (title.length > 100) {
    title = title.slice(0, 97) + "...";
  }

  // Determine priority from surrounding context
  let priority: TaskSuggestion["priority"] = "medium";
  for (const signal of PRIORITY_SIGNALS) {
    if (signal.pattern.test(text)) {
      priority = signal.priority;
      break;
    }
  }

  // Use the action sentence and a bit of surrounding context as description
  const actionIndex = sentences.indexOf(actionSentence);
  const contextSentences = sentences.slice(
    Math.max(0, actionIndex - 1),
    Math.min(sentences.length, actionIndex + 3)
  );
  const description = contextSentences.join(". ").trim();

  return [{ title, description, priority }];
}
