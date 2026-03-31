'use client';

import Link from 'next/link';

interface EmptyStateAction {
  /** Button label */
  label: string;
  /** Link destination */
  href: string;
}

/** Props for the reusable empty state component */
interface EmptyStateProps {
  /** Emoji or SVG icon */
  icon: React.ReactNode;
  /** Heading text, e.g. 'No agents yet' */
  title: string;
  /** Description text explaining what to do */
  description: string;
  /** Primary call-to-action button */
  action?: EmptyStateAction;
  /** Secondary call-to-action button */
  secondaryAction?: EmptyStateAction;
}

/** Reusable empty state with icon, message, and optional action buttons */
export function EmptyState({ icon, title, description, action, secondaryAction }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '48px', marginBottom: '16px' }} aria-hidden="true">
        {icon}
      </div>
      <h2
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: '0 0 8px',
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          margin: '0 0 24px',
          maxWidth: '360px',
        }}
      >
        {description}
      </p>
      {(action || secondaryAction) && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {action && (
            <Link
              href={action.href}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'var(--accent)',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--accent)';
              }}
            >
              {action.label}
            </Link>
          )}
          {secondaryAction && (
            <Link
              href={secondaryAction.href}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
                border: '1px solid var(--border-subtle)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-surface-hover)';
                e.currentTarget.style.borderColor = 'var(--border-medium)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-surface)';
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
            >
              {secondaryAction.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Empty state for the Agents page */
export function AgentsEmpty() {
  return (
    <EmptyState
      icon="🤖"
      title="No agents yet"
      description="Deploy a team template or create your first agent to get started."
      action={{ label: 'Deploy a Team', href: '/team?tab=blueprints' }}
      secondaryAction={{ label: 'Create an Agent', href: '/agents/new' }}
    />
  );
}

/** Empty state for the Inbox page */
export function InboxEmpty() {
  return (
    <EmptyState
      icon="✅"
      title="All clear!"
      description="Your agents will send updates here when they have something to report."
    />
  );
}

/** Empty state for the Tasks page */
export function TasksEmpty() {
  return (
    <EmptyState
      icon="📋"
      title="No tasks yet"
      description="Create a task to start assigning work to your agents."
      action={{ label: 'Create a Task', href: '/tasks/new' }}
    />
  );
}

/** Empty state for the Skills page */
export function SkillsEmpty() {
  return (
    <EmptyState
      icon="🧩"
      title="No skills installed"
      description="Browse the marketplace to give your agents new capabilities."
      action={{ label: 'Browse Skills Marketplace', href: '/skills?tab=marketplace' }}
    />
  );
}

/** Empty state for the custom Blueprints tab */
export function BlueprintsEmpty() {
  return (
    <EmptyState
      icon="📐"
      title="No custom templates"
      description="Save your current team setup as a reusable template."
      action={{ label: 'Create Template', href: '/team?tab=blueprints&action=create' }}
    />
  );
}
