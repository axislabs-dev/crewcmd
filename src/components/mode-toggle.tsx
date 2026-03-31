'use client';

import { useUIMode } from './mode-provider';

/**
 * Toggle between Simple and Pro UI modes.
 * Simple mode hides technical details; Pro mode shows everything.
 * Place in the sidebar near the theme toggle.
 */
export function ModeToggle() {
  const { mode, setMode } = useUIMode();
  const isPro = mode === 'pro';

  return (
    <button
      onClick={() => setMode(isPro ? 'simple' : 'pro')}
      title="Simple mode hides technical details. Pro mode shows everything."
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        borderRadius: '8px',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: 500,
        transition: 'all 0.2s ease',
        width: '100%',
        justifyContent: 'center',
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
      <span
        style={{
          display: 'inline-flex',
          transition: 'transform 0.3s ease',
          transform: isPro ? 'rotate(0deg)' : 'rotate(-15deg)',
          fontSize: '16px',
        }}
        aria-hidden="true"
      >
        {isPro ? '⌘' : '✦'}
      </span>
      <span>{isPro ? 'Pro' : 'Simple'}</span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          padding: '1px 6px',
          borderRadius: '4px',
          background: isPro ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
          transition: 'all 0.2s ease',
        }}
      >
        {isPro ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
