// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'CrewCmd Docs',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/axislabs-dev/crewcmd' },
			],
			logo: {
				light: './src/assets/logo-light.svg',
				dark: './src/assets/logo-dark.svg',
				replacesTitle: false,
			},
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Quick Start', slug: 'getting-started/quick-start' },
						{ label: 'Project Structure', slug: 'getting-started/project-structure' },
					],
				},
				{
					label: 'Configuration',
					items: [
						{ label: 'Environment Variables', slug: 'configuration/environment-variables' },
						{ label: 'Database Setup', slug: 'configuration/database' },
						{ label: 'Authentication', slug: 'configuration/authentication' },
						{ label: 'Zero-Config Startup', slug: 'configuration/zero-config' },
					],
				},
				{
					label: 'Agent Setup',
					items: [
						{ label: 'Creating Agents', slug: 'agents/creating-agents' },
						{ label: 'Providers & Models', slug: 'agents/providers-and-models' },
						{ label: 'Org Chart & Hierarchy', slug: 'agents/org-chart' },
						{ label: 'Blueprints', slug: 'agents/blueprints' },
						{ label: 'Budgets & Cost Control', slug: 'agents/budgets' },
						{ label: 'Governance & Approvals', slug: 'agents/governance' },
					],
				},
				{
					label: 'Chat & Voice',
					items: [
						{ label: 'Chat Interface', slug: 'chat/overview' },
						{ label: 'Hierarchical Threads', slug: 'chat/hierarchical-threads' },
						{ label: 'Voice & Speech', slug: 'chat/voice' },
					],
				},
				{
					label: 'Task Management',
					items: [
						{ label: 'Task Board', slug: 'tasks/task-board' },
						{ label: 'Projects & Goals', slug: 'tasks/projects-and-goals' },
						{ label: 'Time Tracking', slug: 'tasks/time-tracking' },
					],
				},
				{
					label: 'Skills & Marketplace',
					items: [
						{ label: 'Built-in Skills', slug: 'skills/built-in' },
						{ label: 'Skills Marketplace', slug: 'skills/marketplace' },
						{ label: 'Credential Vault', slug: 'skills/credential-vault' },
					],
				},
				{
					label: 'API Reference',
					autogenerate: { directory: 'api' },
				},
			],
		}),
	],
});
