---
title: Projects & Goals
description: Organize work into projects and align with company goals.
---

## Projects

Projects group related tasks together. Each task can belong to one project.

- Create projects to organize sprints, features, or initiatives
- Filter the task board by project
- Track progress per project

```
GET    /api/projects          # List projects
POST   /api/projects          # Create project
PATCH  /api/projects/:id      # Update project
DELETE /api/projects/:id      # Delete project
```

## Goals

Goals are company-level objectives that tasks and projects align to.

- Define goals with descriptions and target dates
- Link tasks and projects to goals
- Track goal progress based on linked task completion

```
GET    /api/goals             # List goals
POST   /api/goals             # Create goal
PATCH  /api/goals/:id         # Update goal
DELETE /api/goals/:id         # Delete goal
```
