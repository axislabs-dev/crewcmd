# CrewCmd Soft Launch Plan

> Prepared launch notes for an early-access, source-available CrewCmd announcement.

## Positioning

CrewCmd is an AI-native workspace for managing human teams and AI agents side by side: task board, inbox, skills, org chart, and OpenClaw runtime integration in one place.

For soft launch, position CrewCmd as:

- **Early access** — useful today, still moving fast.
- **Source-available** — BSL 1.1, contributions welcome; do not call it OSI open source unless the license changes.
- **Built for agent operators** — people already experimenting with OpenClaw, Claude Code, Cursor, custom agents, internal AI workflows, and small-team automation.
- **Looking for dogfooders** — feedback from people running real agents matters more than broad attention.

Avoid overclaiming that CrewCmd is a finished enterprise platform. The right promise is:

> CrewCmd gives small teams a practical control room for AI agents: deploy a crew, route work, inspect progress, manage skills, and keep humans in the loop.

## Launch Goals

### Primary goals

- Recruit 10–25 serious early users who are already working with AI agents.
- Get install/onboarding feedback from fresh machines and non-core contributors.
- Learn which use cases resonate: dev squads, founder ops, marketing/support agents, internal workflow orchestration.
- Find the top reliability and UX gaps before a larger public launch.

### Secondary goals

- Establish CrewCmd as a credible companion to OpenClaw.
- Start collecting GitHub stars/issues/discussions from relevant users.
- Build a public trail of progress without implying the product is fully polished.

## Target Audience

Best-fit early adopters:

- AI-agent power users running local or self-hosted agents.
- OpenClaw users who want a management layer.
- Small startup teams trying to operationalize agents.
- Developer-tools builders interested in agent orchestration.
- Technical founders who want a lightweight AI ops dashboard.

Not ideal yet:

- Non-technical teams expecting SaaS polish.
- Enterprise buyers needing mature RBAC/compliance workflows.
- Users who want a fully hosted, zero-config product with support guarantees.

## Launch Message

### Short version

CrewCmd is an early-access workspace for managing AI agents like a real team: tasks, inbox, skills, org chart, and OpenClaw runtime integration.

We are looking for technical dogfooders who are already running agents and want a better control room for them.

### One-paragraph version

I have been building CrewCmd, a source-available workspace for managing humans and AI agents side by side. It gives agent-heavy teams a shared task board, priority inbox, skills management, visual org chart, and OpenClaw runtime integration. It is early, but already useful if you are actively experimenting with agent crews and want a better way to deploy, route, inspect, and govern their work. I am looking for a small group of serious dogfooders before pushing it more broadly.

### Social post draft

I’m soft-launching CrewCmd for early dogfooding.

It is a source-available workspace for managing AI agents like a real team:

- deploy agent crews
- route work through a shared inbox
- manage skills
- inspect team structure
- connect to OpenClaw runtimes
- keep humans in the loop

It is early, but real. I’m looking for technical users already running AI agents who want a better control room and are willing to give sharp feedback.

Repo: https://github.com/axislabs-dev/crewcmd
Site: https://crewcmd.dev

### More candid founder version

Most agent tools focus on creating individual agents. My problem has been different: once you have several agents, how do you manage them as a team?

CrewCmd is my attempt at that control layer: task board, inbox, skills, org chart, and OpenClaw integration for agent crews.

It is source-available under BSL 1.1 and still early, so I’m not doing a huge launch yet. I’m looking for a small number of people who are already running agents and want to help shape the workflow before it gets polished.

If that’s you, I’d love feedback.

## Pre-Launch Checklist

### Product readiness

- [ ] Fresh clone quickstart works from README on a clean machine.
- [ ] `pnpm install` succeeds with Node.js 22+ and pnpm 9.x.
- [ ] `pnpm dev` opens the app at `http://localhost:3000`.
- [ ] First-account creation works.
- [ ] OpenClaw gateway import path works with current OpenClaw runtime.
- [ ] Task board basic create/update flow works.
- [ ] Inbox renders and updates reliably.
- [ ] Skills page loads with built-in skills.
- [ ] ClawHub catalog behavior is clearly labelled as browse/import preview.
- [ ] Chat resume/progress persistence works after refresh.
- [ ] Mobile/Tailscale access path is documented accurately if mentioned.

### Quality gates

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint:check` passes, or known lint debt is documented.
- [ ] `pnpm test` passes.
- [ ] `pnpm release:check` passes, or failures are triaged before launch.
- [ ] At least one clean install has been tested outside the main dev machine.
- [ ] Known limitations are documented in README or ROADMAP.

### Repo readiness

- [ ] README reflects what works today, not just the vision.
- [ ] License wording consistently says **source-available / BSL 1.1**.
- [ ] CONTRIBUTING is accurate.
- [ ] SECURITY has a working contact/process.
- [ ] Issue templates exist for bug reports and feedback.
- [ ] GitHub topics are set: `ai-agents`, `agent-orchestration`, `openclaw`, `ai-ops`, `nextjs`, `self-hosted`.
- [ ] Repo description is clear and non-hypey.
- [ ] Screenshots/GIFs are current.
- [ ] No secrets or local-only config are committed.

### Website readiness

- [ ] crewcmd.dev homepage matches current positioning.
- [ ] Install/getting-started CTA links to the correct repo/docs.
- [ ] Early-access wording is visible.
- [ ] License/source-available wording is accurate.
- [ ] Feedback CTA exists: GitHub issues, discussions, or direct contact.
- [ ] Cloudflare deployment is live and verified.

### Feedback loop readiness

- [ ] Create a GitHub issue label: `soft-launch-feedback`.
- [ ] Create a GitHub issue label: `good-first-dogfood`.
- [ ] Create a GitHub discussion or issue titled “Soft launch feedback thread”.
- [ ] Prepare a short feedback form or issue template.
- [ ] Define what feedback matters most:
  - install friction
  - first useful workflow
  - OpenClaw import problems
  - agent/inbox reliability
  - what people expected but could not find

## Launch Plan

### Phase 0 — Internal smoke test

Timing: before posting publicly.

Actions:

1. Run the quality gates.
2. Do a fresh clone/install pass.
3. Verify the README quickstart line by line.
4. Capture any known limitations into README/ROADMAP.
5. Create the soft-launch feedback issue/discussion.

Exit criteria:

- A technical stranger can get CrewCmd running from README without private context.
- Known rough edges are acknowledged rather than hidden.

### Phase 1 — Private friendlies

Timing: day 1–2.

Audience:

- 5–10 trusted technical friends.
- People already interested in OpenClaw/agent workflows.
- A few critical users who will be honest.

Message:

> I’m soft-launching CrewCmd quietly. It’s early, source-available, and aimed at people already running agents. Could you try the README quickstart and tell me where it breaks or feels confusing?

Ask for:

- Did install work?
- What did you think CrewCmd was for after 2 minutes?
- Where did you get stuck?
- What would make it useful for your own agent setup?

### Phase 2 — Public soft launch

Timing: after 3–5 useful private feedback loops.

Channels:

- Roger’s LinkedIn/X.
- Relevant Discord/Slack communities where self-promotion is acceptable.
- OpenClaw community.
- GitHub repo README/site.

Do not blast Product Hunt/HN yet unless the fresh-install experience is strong.

Post style:

- Candid founder note.
- “Early dogfooders wanted.”
- Clear that it is source-available BSL.
- One concrete GIF/screenshot.
- Link to repo and feedback thread.

### Phase 3 — Feedback triage sprint

Timing: first week after soft launch.

Daily tasks:

1. Triage new issues.
2. Label soft-launch feedback.
3. Fix install/onboarding blockers first.
4. Convert repeated confusion into docs changes.
5. Thank contributors quickly.

Priority order:

1. Install and startup failures.
2. OpenClaw gateway import failures.
3. First-run/onboarding confusion.
4. Chat/inbox reliability bugs.
5. Docs and positioning improvements.
6. Nice-to-have UI polish.

### Phase 4 — Broader launch readiness

Timing: after soft-launch feedback stabilizes.

Ready when:

- Fresh install success rate is high.
- README has been validated by external users.
- The top 5 first-run problems are fixed or documented.
- There is a short demo video/GIF.
- There are 2–3 real user quotes or use cases.
- License/positioning is clear.
- The project has at least a small contributor path.

Broader-launch channels:

- Hacker News “Show HN”.
- Product Hunt.
- Indie Hackers.
- Dev.to / Hashnode launch post.
- OpenClaw ecosystem announcement.
- Targeted outreach to AI-agent builders.

## Suggested GitHub Issue: Soft Launch Feedback

Title:

```text
Soft launch feedback: install, first-run, and agent workflow rough edges
```

Body:

```markdown
CrewCmd is in soft launch. If you tried it, thank you — sharp feedback is more valuable than praise right now.

Please include:

1. OS / Node / pnpm versions
2. Install path used: local dev, Docker, Tailscale, external Postgres, etc.
3. Did the README get you running?
4. Where did you get stuck?
5. What did you expect CrewCmd to do?
6. What was the first useful thing you tried?
7. What would make you keep using it?

Known early limitations:

- Source-available BSL 1.1, not OSI open source.
- ClawHub browsing/import is still preview-level.
- Governance workflows are foundational, not complete enterprise guardrails.
- Docker/self-hosting path may need more real-world testing.
```

## Known Risks and How to Say Them

### License risk

Do not say:

> CrewCmd is open source.

Say:

> CrewCmd is source-available under BSL 1.1, with contributions welcome.

### Maturity risk

Do not say:

> Production-ready AI workforce platform.

Say:

> Early-access control room for teams already experimenting with AI agents.

### Integration risk

Do not say:

> Fully integrated with every agent runtime.

Say:

> Built around OpenClaw today, with runtime integration patterns that can expand over time.

## Launch Assets to Prepare

- [ ] 30–60 second demo GIF/video.
- [ ] 3 screenshots:
  - team org chart
  - inbox/chat
  - skills management
- [ ] Short README badge/status line: `Early access` / `Source-available`.
- [ ] Founder note/blog post.
- [ ] GitHub feedback issue/discussion.
- [ ] Short install troubleshooting section.

## Success Metrics

Soft-launch success is not raw traffic. It is signal quality.

Track:

- Number of successful fresh installs.
- Number of meaningful feedback issues.
- Number of people who connect OpenClaw.
- Time from clone to first useful action.
- Top repeated confusion points.
- Stars/watchers as a weak secondary signal.

Target for first soft-launch window:

- 10 fresh installs attempted.
- 5 successful first-run reports.
- 10 actionable feedback items.
- 2–3 people willing to keep dogfooding.

## Recommended Next Actions

1. Run `pnpm release:check`.
2. Fix any quick README/setup blockers.
3. Add the soft-launch feedback issue.
4. Review crewcmd.dev for source-available/early-access wording.
5. Send private friendlies first.
6. Post the public soft-launch note after private feedback catches obvious friction.
