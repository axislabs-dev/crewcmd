# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Agent execution engine with adapter-specific executors and control panel UI
- Multi-adapter agent support (OpenClaw Gateway, OpenRouter, HTTP, custom)
- Team blueprints for one-click agent team deployment
- Skills system with marketplace browsing and agent attachment
- Agent inbox with priority tiers and action buttons
- Agent access tiers (private, assigned, team-wide) with per-user permissions
- Simple/Pro mode toggle for UI complexity
- PGlite zero-config local development (no external database required)
- Docker and Docker Compose support
- Email/password authentication alongside GitHub OAuth
- Heartbeat scheduling with cron expressions and timezone support
- Heartbeat execution engine with status tracking
- Escalation paths (blocked tasks, budget exceeded, heartbeat failed, approval timeout, agent offline)
- Routine templates for recurring task creation
- Governance system with approval gates, config versioning, and immutable audit log
- Org chart with delegation flags
- Budget system with per-agent monthly limits, cost tracking, and auto-pause
- Goal hierarchy (company mission → project goals → agent goals → tasks)
- Multi-tenant company support with data isolation
- Company switcher in sidebar
- Slim sidebar (consolidated from 17 to 8 items)
- Light and dark themes
- Welcome hero component

## [0.1.0] - 2026-03-30

### Added
- Initial release as CrewCmd (rebranded from internal Mission Control)
- Task management with full lifecycle (backlog → inbox → queued → assigned → in_progress → review → done/failed/blocked)
- Agent registry with callsigns, status tracking, and soul content
- Project management with documents and context
- Activity logging and audit trail
- OpenClaw gateway integration
- GitHub webhook pipeline for PR tracking
- Voice chat interface with STT/TTS
- Time tracking for human team members
- Workspace file sync
- Cron job management
- REST API with bearer token auth on mutations
