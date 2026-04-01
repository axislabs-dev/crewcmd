// ─── Built-in Execution Skills ──────────────────────────────────────
// These ship with CrewCmd and are available to all agents regardless
// of company. They represent runtime capabilities an agent can use.

export interface BuiltInSkill {
  slug: string;
  name: string;
  description: string;
  category: "coding" | "tooling" | "browsing";
  runtime: "cli" | "api";
  command?: string;
  icon: string;
  compatibleProviders?: string[];
}

export const BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    slug: "claude-code",
    name: "Claude Code",
    description: "Anthropic's agentic coding tool — edit files, run commands, search code, and manage git workflows",
    category: "coding",
    runtime: "cli",
    command: "claude",
    icon: "🤖",
    compatibleProviders: ["anthropic"],
  },
  {
    slug: "codex",
    name: "Codex",
    description: "OpenAI's CLI coding agent — generate, refactor, and debug code from the terminal",
    category: "coding",
    runtime: "cli",
    command: "codex",
    icon: "🧬",
    compatibleProviders: ["openai"],
  },
  {
    slug: "opencode",
    name: "OpenCode",
    description: "Open-source terminal coding assistant — provider-agnostic code generation and editing",
    category: "coding",
    runtime: "cli",
    command: "opencode",
    icon: "🔓",
  },
  {
    slug: "gemini-cli",
    name: "Gemini CLI",
    description: "Google's CLI coding agent — code generation, analysis, and refactoring powered by Gemini",
    category: "coding",
    runtime: "cli",
    command: "gemini",
    icon: "💎",
    compatibleProviders: ["google"],
  },
  {
    slug: "cursor",
    name: "Cursor",
    description: "AI-powered code editor with inline generation, chat, and multi-file editing",
    category: "coding",
    runtime: "cli",
    command: "cursor",
    icon: "🖱️",
  },
  {
    slug: "pi",
    name: "Pi",
    description: "Lightweight personal coding assistant — quick edits, explanations, and shell integration",
    category: "coding",
    runtime: "cli",
    command: "pi",
    icon: "🥧",
  },
  {
    slug: "github",
    name: "GitHub",
    description: "GitHub CLI integration — manage repos, PRs, issues, actions, and code review",
    category: "tooling",
    runtime: "cli",
    command: "gh",
    icon: "🐙",
  },
  {
    slug: "web-browse",
    name: "Web Browse",
    description: "Browse and extract content from web pages — research, scrape, and summarize",
    category: "browsing",
    runtime: "api",
    icon: "🌐",
  },
  {
    slug: "file-system",
    name: "File System",
    description: "Read, write, search, and manage files and directories in the workspace",
    category: "tooling",
    runtime: "cli",
    icon: "📁",
  },
  {
    slug: "shell",
    name: "Shell",
    description: "Execute shell commands — run scripts, manage processes, and interact with the OS",
    category: "tooling",
    runtime: "cli",
    icon: "🐚",
  },
];
