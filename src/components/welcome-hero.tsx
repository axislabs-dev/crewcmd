'use client';

import Link from 'next/link';

/**
 * Welcome hero for the dashboard when no agents exist yet.
 * Guides new users through their first steps with CrewCmd.
 */
export function WelcomeHero() {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '16px',
        padding: '48px 32px',
        textAlign: 'center',
        maxWidth: '640px',
        margin: '0 auto',
      }}
    >
      <div style={{ fontSize: '64px', marginBottom: '16px' }} aria-hidden="true">
        🚀
      </div>

      <h1
        style={{
          fontSize: '28px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          margin: '0 0 8px',
        }}
      >
        Welcome to CrewCmd
      </h1>

      <p
        style={{
          fontSize: '16px',
          color: 'var(--text-secondary)',
          margin: '0 0 32px',
        }}
      >
        Your AI team, ready to work.
      </p>

      <div
        style={{
          display: 'flex',
          gap: '12px',
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginBottom: '40px',
        }}
      >
        <Link
          href="/team?tab=blueprints"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 20px',
            borderRadius: '8px',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: '14px',
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
          Deploy a Team &rarr;
        </Link>
        <Link
          href="/agents/new"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 20px',
            borderRadius: '8px',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            fontSize: '14px',
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
          Create an Agent &rarr;
        </Link>
      </div>

      <div
        style={{
          textAlign: 'left',
          background: 'var(--bg-primary)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <p
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '0 0 16px',
          }}
        >
          Three steps to get started:
        </p>
        <ol
          style={{
            margin: 0,
            paddingLeft: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <li style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Deploy a team template (or create agents individually)
          </li>
          <li style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Set up connections (tell agents which AI tools to use)
          </li>
          <li style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Start assigning work
          </li>
        </ol>
      </div>

      <Link
        href="/dashboard?tour=true"
        style={{
          display: 'inline-block',
          marginTop: '24px',
          fontSize: '13px',
          color: 'var(--accent)',
          textDecoration: 'none',
          fontWeight: 500,
        }}
      >
        Show me around &rarr;
      </Link>
    </div>
  );
}
