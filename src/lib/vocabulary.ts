/** Maps internal technical terms to user-friendly labels */
export const VOCAB = {
  // Agent terminology
  callsign: 'Agent Name',
  adapterType: 'Connection Type',
  adapter: 'Connection',
  'Claude Code': 'Claude Code (Anthropic)',
  'Codex': 'Codex (OpenAI)',
  'Gemini CLI': 'Gemini (Google)',
  'OpenCode': 'OpenCode',
  'OpenClaw Gateway': 'OpenClaw Cloud',
  'Cursor': 'Cursor IDE',
  'Pi': 'Pi Agent',
  'Process': 'Local Process',
  'HTTP': 'API Connection',
  'OpenRouter': 'OpenRouter (Multi-model)',

  // Role terminology
  engineer: 'Software Developer',
  architect: 'System Architect',
  qa: 'Quality Assurance',
  devops: 'DevOps Engineer',
  manager: 'Manager',
  designer: 'Designer',
  writer: 'Content Writer',
  analyst: 'Data Analyst',
  support: 'Support Agent',
  sales: 'Sales Representative',
  researcher: 'Researcher',
  assistant: 'Executive Assistant',
  copywriter: 'Copywriter',
  content_strategist: 'Content Strategist',
  social_media: 'Social Media Manager',

  // Section labels
  adapterConfig: 'Connection Settings',
  workspacePath: 'Working Folder',
  promptTemplate: 'Instructions',
  reportsTo: 'Reports To',
  orgChart: 'Team Structure',

  // Status
  in_progress: 'In Progress',
  queued: 'Waiting',

  // Features
  blueprints: 'Team Templates',
  skills: 'Capabilities',
} as const;

/** Get user-friendly label for a technical term */
export function label(key: string): string {
  return VOCAB[key as keyof typeof VOCAB] ?? key;
}

/** Get description/tooltip for technical concepts */
export const TOOLTIPS: Record<string, string> = {
  adapterType: 'How this agent connects — choose a coding tool you already use, or connect via API',
  model: 'The AI model this agent uses to think and respond',
  workspacePath: 'The folder on your computer where this agent reads and writes files',
  promptTemplate: 'Tell the agent what their job is and how they should behave',
  visibility: 'Who on your team can see and use this agent',
  skills: 'Special abilities you can give your agents — like plugins for a browser',
  blueprints: 'Pre-built teams you can deploy in one click — like hiring a whole department instantly',
};
