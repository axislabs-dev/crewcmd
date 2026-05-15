# CrewCmd OSS-Style Launch Readiness Plan

> Practical launch plan for making CrewCmd ready for outside contributors and early dogfooders.
>
> License note: CrewCmd is currently **source-available under BSL 1.1**, not OSI open source. This document uses “OSS-style” to mean open development habits: public repo, clear contributor path, transparent roadmap, issues/PRs, and a free early-access/self-hosted experience where appropriate.

## Launch thesis

CrewCmd should not launch as “another AI agent dashboard.” It should launch as a practical, inspectable control room for humans and AI agents working together:

- private personal workspaces for individual operators;
- shared company workspaces for teams;
- personal runtimes that stay private;
- company/shared runtimes for team-visible work;
- Slack-like channels, DMs, threads, and agent participation modes;
- tasking, audit trails, governance, and human-in-the-loop controls;
- contributor-friendly setup, docs, and tests.

The public promise should be:

> CrewCmd helps small teams manage AI agents like teammates without blurring private personal runtimes into shared company work.

The launch should be staged. Do not invite broad attention until the install path, personal/company runtime split, and chat/tasking loops are credible enough for strangers to try without private context.

## Contributor-ready product bar

Before asking outside people to contribute seriously, these flows should work well enough to dogfood and explain.

### 1. Installation and first run

- Fresh clone works from the README on a clean machine.
- Local dev starts with embedded PGlite and no private infrastructure.
- Required environment variables are minimal and clearly documented.
- Missing optional integrations fail gracefully with actionable messages.
- A new user can create the first account and land in a useful default workspace/channel.
- Seed/demo data exists or can be created without tribal knowledge.

### 2. Personal workspace

- A user can understand “this is mine” within the first session.
- Private chat, private agent work, personal settings, and personal runtime management are visually distinct from company/shared areas.
- Personal runtime setup is obvious and cannot accidentally become shared.
- Personal runtime errors are surfaced as personal setup issues, not generic system failures.

### 3. Company workspace and shared runtime

- A user can create or join a company workspace.
- An owner/admin can connect a company/shared runtime.
- Team-visible channels and org/team agents use company/shared runtime capacity only.
- Shared runtime availability does **not** automatically activate agents in every channel.
- Shared runtime setup has a clear smoke test: create company → connect shared runtime → open `#crew` → invite/use shared agent → inspect audit/history.

### 4. Runtime separation and governance

Hard invariant:

> Personal runtimes can be used only for the owning user’s private/personal work. Shared channels, company agents, team-visible tasks, shared automations, and org/project rooms must use approved shared runtimes.

Required confidence before launch:

- API routes reject personal-runtime binding to shared scopes.
- Chat, voice, tasking, agent invocation, and automation routing follow the same rule.
- Tests cover personal runtime, company runtime, and cross-scope denial.
- UI copy makes runtime scope visible before work is sent.
- Audit logs exist for shared runtime binding/invocation, role changes, agent invitations, and policy-sensitive actions.

### 5. Conversations, threads, and tasking agents

- Default channel is `#crew`; no stale `#general` UX remains.
- Fresh load lands in a valid channel and composer works immediately.
- Refresh preserves conversation and active run state.
- DMs and agent DMs have a clear model.
- Threads preserve context and do not silently route to unsafe scopes.
- Voice input and typed input use the same routing/privacy checks.
- Tasking an agent creates visible progress, completion/failure state, and useful audit trail.
- Failed delegation is obvious and recoverable.

### 6. Skill installation and agent capability setup

- Built-in skills can be installed, listed, configured, and removed without manual database edits.
- Skill install failures are clear about whether the blocker is auth, runtime reachability, missing config, permissions, or package/catalog state.
- Personal skills and company-approved skills are visually and technically distinct.
- Shared agents can use only skills permitted for their shared runtime and scope.
- A contributor can test at least one end-to-end skill flow: install skill → attach to agent → invoke through chat/task → inspect result/audit.

### 7. Contributor path

- `CONTRIBUTING.md` matches reality.
- Architecture docs define key terms: workspace, company, channel, DM, thread, personal runtime, shared runtime, personal agent, team agent, org agent.
- Issues are labelled for first contributors: `good first issue`, `docs`, `tests`, `soft-launch-feedback`, `governance`, `runtime-routing`.
- A short “where to help first” section exists in README or docs.
- CI is stable enough that contributors can trust failures.

## Stage 0 — Private hardening, no launch

### Goal

Make the product coherent enough that a stranger’s first contribution will improve it instead of exposing foundational confusion.

### Audience

- Roger and internal dogfooding only.
- Existing trusted collaborators only when a specific flow needs outside eyes.

### Work to finish

1. Merge the runtime contract documentation.
2. Add/verify enforcement tests for personal vs shared runtime boundaries.
3. Build the shared/company runtime setup path enough for end-to-end testing.
4. Finish the default chat/channel flow: `#crew`, side-pane management, refresh behavior, mobile/voice basics.
5. Validate thread and agent-tasking flows.
6. Validate skill installation and one skill-backed agent invocation.
7. Update README, docs index, and contribution guidance to match the actual product state.

### Exit criteria

- A clean install reaches a useful first screen.
- The personal/company runtime split is enforced by code and tests, not just docs.
- A shared runtime can be connected and used in a company channel without involving a personal runtime.
- At least one complete happy path works:

```text
Install → create account → create/join company → connect shared runtime → install/approve skill → open #crew → invite/use agent → thread/task agent → inspect progress/audit → verify personal runtime remains private
```

## Stage 1 — Private contributor preview

### Goal

Get high-signal feedback from people who will tolerate rough edges and tell the truth.

### Audience

- 5–10 trusted technical friends.
- OpenClaw users already running agents.
- Builders familiar with local/self-hosted dev tools.
- People likely to contribute docs/tests/small fixes.

### Where to launch

Use private/direct channels first:

- direct messages to trusted dev-tool builders;
- OpenClaw community regulars;
- private Slack/Discord groups where feedback requests are normal;
- a small GitHub discussion or issue linked only to invitees.

Avoid Product Hunt, Hacker News, Reddit, and broad X/LinkedIn posts at this stage.

### What to ask for

Ask for narrow, observable feedback:

- Did install work from a fresh clone?
- Did the first screen make sense?
- Could you tell what was personal vs company/shared?
- Could you connect or understand runtime setup?
- Did skill installation and agent capability setup make sense?
- Did `#crew`, DMs, threads, and agent tasking behave how you expected?
- Where did you lose trust?
- What would you contribute first?

### Private preview message

```markdown
I’m getting CrewCmd ready for outside contributors and I’m looking for a few sharp early testers.

It’s a source-available, self-hostable control room for humans and AI agents: chat, channels, tasks, skills, org structure, and OpenClaw runtime integration.

The thing I especially want tested is the product model:

- personal workspaces stay private;
- personal runtimes cannot leak into shared/company work;
- company channels and team agents use shared runtimes;
- threads, DMs, voice, and agent tasking should feel obvious rather than magical.

Could you try the README setup and tell me where it breaks or feels confusing?

Repo: https://github.com/axislabs-dev/crewcmd
Site: https://crewcmd.dev
Feedback thread: <link>
```

### Exit criteria

- 5 fresh install attempts.
- 3 successful first-run reports.
- Top 5 confusion points captured as issues/docs updates.
- Any critical privacy/routing bug is fixed before public posting.

## Stage 2 — Public soft launch

### Goal

Find serious dogfooders and early contributors without overclaiming maturity.

### Audience

- AI-agent power users.
- Dev-tool builders.
- Small-team/founder operators experimenting with agent workflows.
- Self-hosted/local-first users.
- OpenClaw community.

### Where to launch

Recommended order:

1. **GitHub repo** — README, topics, pinned feedback issue/discussion, screenshots.
2. **crewcmd.dev** — concise landing page, install CTA, “source-available early access” wording.
3. **OpenClaw community** — most relevant audience and context.
4. **Roger’s LinkedIn/X** — candid builder note, not hype.
5. **Dev.to / Hashnode / personal blog** — longer launch essay and architecture story.
6. **Relevant Discord/Slack communities** — only where self-promotion/feedback requests are welcome.

Hold back on Product Hunt, Show HN, and broad Reddit until after this soft launch survives real fresh installs.

### Suggested public post

```markdown
I’m soft-launching CrewCmd for early dogfooding.

CrewCmd is a source-available control room for humans and AI agents working together: shared channels, DMs, tasks, skills, org structure, and OpenClaw runtime integration.

The design goal is simple but important: personal runtimes stay private, while company/team work runs through explicit shared runtimes with governance and audit trails.

I’m looking for technical users already running agents who can try the install, break the first-run flow, and tell me where the model is confusing.

Useful if you care about:

- local/self-hosted agent workflows;
- Slack-style channels with AI teammates;
- private personal agents vs shared team agents;
- tasking agents and inspecting progress;
- governance around shared AI work.

It’s early, not enterprise-polished, and currently source-available under BSL 1.1. Sharp feedback is more useful than praise.

Repo: https://github.com/axislabs-dev/crewcmd
Site: https://crewcmd.dev
Feedback: <link>
```

### GitHub issue/discussion prompt

```markdown
# CrewCmd soft-launch feedback

Thanks for trying CrewCmd. I’m especially interested in install friction, first-run confusion, runtime privacy, and agent tasking reliability.

Please include:

1. OS, Node, pnpm versions
2. Local dev or Docker/self-hosted path
3. Did the README get you running?
4. Did personal workspace vs company workspace make sense?
5. Did personal runtime vs shared/company runtime make sense?
6. Did skill installation and agent capability setup make sense?
7. Did `#crew`, DMs, threads, and agent tasking behave as expected?
8. Where did you lose trust?
9. What would make you keep using it or contribute?

Known early limitations:

- source-available BSL 1.1, not OSI open source;
- early-access product, not enterprise-complete;
- shared runtime governance and tests are actively being hardened;
- some agent/voice/tasking flows may still need polish.
```

### Exit criteria

- 10–25 meaningful fresh-install/dogfood attempts.
- Repeated install blockers fixed or documented.
- At least 2–3 people willing to keep dogfooding.
- First external issues/PRs have a clear, kind response loop.
- Runtime privacy model is still intact after feedback-driven changes.

## Stage 3 — Contributor ramp

### Goal

Turn launch attention into useful contributions without letting contributors accidentally work against the architecture.

### Actions

- Create/curate labelled issues:
  - `good first issue` — docs, small UI copy, tests, setup fixes;
  - `help wanted` — scoped implementation with enough context;
  - `runtime-routing` — privacy/scope-sensitive work, reviewed carefully;
  - `governance` — roles, audit logs, policies;
  - `chat-reliability` — channels, DMs, threads, voice, active run state.
- Add a contributor map in docs:
  - install/setup;
  - chat UX;
  - runtime routing/governance;
  - tests;
  - docs/site;
  - OpenClaw integration.
- Keep PR review strict around runtime privacy.
- Convert repeated questions into docs quickly.
- Thank contributors publicly and specifically.

### Contributor onboarding copy

```markdown
Want to help CrewCmd?

The highest-impact contributions right now are not flashy features. They are the pieces that make agent collaboration safe and boring:

- clean install/setup on fresh machines;
- tests for personal vs shared runtime routing;
- clearer docs for workspaces, companies, channels, DMs, and runtimes;
- skill installation and agent capability setup;
- chat/voice reliability;
- tasking-agent progress and failure states;
- governance/audit logs.

If a change touches personal runtime privacy or shared channel routing, please call that out clearly in the PR description.
```

## Stage 4 — Broader launch

### Goal

Launch to a broader developer audience once the first-run and governance story has survived real users.

### Readiness bar

Do this only when:

- clean install is consistently successful;
- README and docs have been validated by non-core users;
- personal runtime vs shared runtime is enforced and tested;
- shared runtime setup has a documented happy path;
- skill installation and at least one skill-backed agent flow are reliable enough for demos;
- chat, DMs, threads, and tasking agents are reliable enough for demos;
- there is a short demo video/GIF;
- there are screenshots of `#crew`, tasking, runtime setup, and governance/audit surfaces;
- there are a few real user quotes, issues, or PRs;
- license wording is accurate everywhere.

### Where to launch

- **Show HN** — when the demo is crisp and install is strong.
- **Product Hunt** — if there is a polished landing page and video.
- **Reddit** — targeted subreddits only, with a useful technical writeup rather than drive-by promotion.
- **Dev.to / Hashnode / personal blog** — architecture/development story.
- **GitHub social graph** — pinned repo, topics, release notes.
- **OpenClaw ecosystem** — deeper integration announcement.
- **Targeted outreach** — agent framework builders, self-hosted AI people, technical founders.

### Show HN style copy

```markdown
Show HN: CrewCmd — a source-available control room for human + AI agent teams

I built CrewCmd because once you have more than one agent, the hard part stops being “can an agent do a task?” and becomes “how do humans and agents coordinate safely?”

CrewCmd gives you Slack-style channels/DMs, tasks, skills, org structure, and OpenClaw runtime integration. A big design constraint is runtime privacy: personal runtimes stay private, and shared/company work uses explicit shared runtimes with governance.

It’s early and source-available under BSL 1.1. I’d especially value feedback from people running local/self-hosted agents or trying to coordinate agent work inside a small team.

Repo: https://github.com/axislabs-dev/crewcmd
Site: https://crewcmd.dev
```

## Messaging guardrails

Say:

- “source-available under BSL 1.1”
- “early access”
- “self-hostable/local dev friendly”
- “for technical dogfooders already experimenting with agents”
- “personal runtimes stay private; shared work uses shared runtimes”
- “governance and audit trails are being hardened”

Do not say yet:

- “fully open source” unless the license changes;
- “enterprise-ready”;
- “secure by default for every org”;
- “agents can join any channel automatically”;
- “zero-config SaaS replacement for Slack.”

## Launch assets

Prepare before Stage 2:

- 30–60 second demo video/GIF.
- Screenshots:
  - `#crew` channel;
  - personal runtime settings;
  - company/shared runtime settings;
  - agent tasking/progress;
  - skill installation/agent capability setup;
  - task/inbox/audit trail;
  - org/team view.
- Feedback issue/discussion.
- Updated README quickstart.
- Current `CONTRIBUTING.md`.
- Known limitations section.
- At least one architecture diagram or short runtime-contract explainer.

## Success metrics

Stage 1:

- 5 fresh install attempts.
- 3 successful runs.
- 5+ actionable issues.
- No unresolved critical runtime privacy bugs.

Stage 2:

- 10–25 serious dogfood attempts.
- 5+ successful installs from non-core users.
- 2–3 ongoing dogfooders.
- 1–3 external PRs or strong issue reports.
- Top repeated confusion converted into docs or fixes.

Stage 4:

- Strong install success rate.
- Demo is understandable without a live explanation.
- Runtime privacy model is clear to new users.
- Contributors can find useful work in under 10 minutes.

## Recommended immediate next actions

1. Keep the runtime contract doc and Slack/channel IA docs linked from this launch plan.
2. Add tests that prove personal runtimes cannot route into shared/company contexts.
3. Finish one clean shared runtime setup path.
4. Re-test skill installation and one skill-backed agent invocation.
5. Re-test `#crew`, DMs, threads, voice input, and agent tasking from a clean user account.
6. Create the soft-launch feedback issue/discussion once Stage 0 exits.
7. Invite private preview testers before posting publicly.
