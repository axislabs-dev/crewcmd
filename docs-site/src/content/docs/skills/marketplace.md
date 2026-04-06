---
title: Skills Marketplace
description: Browse, install, and share agent skills.
---

The Skills Marketplace lets you discover and install new capabilities for your agents.

## Browsing Skills

Navigate to **Skills > Marketplace** to browse available skills. Skills are categorized by:
- Type (coding, research, communication, etc.)
- Provider compatibility
- Popularity

## Installing Skills

1. Find a skill in the marketplace
2. Click **Install**
3. Configure any required credentials
4. Assign the skill to agents

## Custom Skills

You can create custom skills for your company:
- Define the skill's runtime, command, and configuration
- Specify provider compatibility
- Declare credential dependencies
- Share within your organization

## Importing Skills

Import skills from external sources:

```
POST /api/skills/import    # Import a skill definition
```

## API

```
GET    /api/skills              # List all skills
GET    /api/skills/browse       # Browse marketplace
POST   /api/skills              # Create custom skill
PATCH  /api/skills/:id          # Update skill
DELETE /api/skills/:id          # Delete skill
POST   /api/skills/import       # Import skill
```
