export const shell = {
  // Surface names shared across the sidebar, header breadcrumb, and command palette.
  surfaces: {
    graph: 'Graph',
    actions: 'Actions',
    clarifications: 'Clarifications',
    proposals: 'Proposals',
    activity: 'Activity',
    history: 'History',
    settings: 'Settings',
  },
  // Top workspace header bar.
  header: {
    // Keep the (G W) keyboard hint literal in every locale.
    workspaceSettingsTooltip: 'Workspace Settings (G W)',
    workspaceLabel: 'Workspace',
    noneRegistered: '(None Registered)',
  },
  // Empty state shown when no workspace is open.
  noWorkspace: {
    title: 'Welcome to Braid',
    description: 'Open a workspace to begin.',
    openWorkspaceTitle: 'Open Workspace',
    openWorkspaceDescription: 'Type a name to create a new one or open an existing workspace under the canonical root.',
  },
  // Left sidebar chrome.
  sidebar: {
    // Keep the (⌘\) keyboard hint literal in every locale.
    expandTooltip: 'Expand Sidebar (⌘\\)',
    collapseTooltip: 'Collapse Sidebar (⌘\\)',
    openWorkspace: 'Open Workspace',
    signInTo: 'Sign in to {name}',
    unreachable: 'Unreachable',
    openWorkspaceOn: 'Open Workspace on {name}',
    noWorkspaceYet: 'No workspace yet.',
    detailsLabel: 'Details',
    hereTitle: 'Here',
    pendingCount: '{count} pending',
    runsInFlight: '{count, plural, one {# run in flight} other {# runs in flight}}',
    pendingClarifications: '{count, plural, one {# pending clarification} other {# pending clarifications}}',
    pendingProposals: '{count, plural, one {# pending proposal} other {# pending proposals}}',
  },
  // Command palette (⌘K).
  commandPalette: {
    accessibilityTitle: 'Command Palette',
    accessibilityDescription: 'Search for a command to run.',
    searchPlaceholder: 'Type a command or search…',
    noMatches: 'No results.',
    goToTitle: 'Go To',
    workspacesTitle: 'Workspaces',
    actionsTitle: 'Actions',
    graphHome: 'Graph (home)',
    workspaceSettings: 'Workspace Settings',
  },
  // Login gate.
  login: {
    title: 'Sign In to Braid',
    description: 'This server requires authentication. Sign in with a Google account whose email is on the allowlist or has an invite.',
    checkingServer: 'Checking server…',
    redirecting: 'Redirecting…',
    signInWithGoogle: 'Sign In with Google',
    googleNotConfigured: 'Google Sign-in isn\'t configured on this server. Ask the admin to set',
  },
  // Account picker and rename dialog.
  userPicker: {
    renameAccount: 'Rename Account',
    dialogTitle: 'Account Name',
    dialogDescription: 'Display name shown in audit trails and HITL reviews. Local install: this is the single account on this machine; defaults to your OS username.',
    displayNameLabel: 'Display Name',
  },
  // Generic multi-select dropdown.
  multiSelect: {
    filterPlaceholder: 'Filter…',
    noMatches: 'No matches.',
    selectedCount: '{count} selected',
    clearAllButton: 'Clear All',
    removeLabel: 'Remove {label}',
    selectPlaceholder: 'Select {label}…',
  },
}

export default shell
