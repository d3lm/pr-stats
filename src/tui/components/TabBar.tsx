import { TABS, type AuthoredSubTab } from '../state/browse';
import { theme } from '../theme';

/**
 * Renders the tab bar with the active tab highlighted.
 */
export function TabBar({ tab }: { tab: number }) {
  return (
    <box flexDirection="row" height={1} paddingLeft={1} marginTop={1} columnGap={1}>
      {TABS.map((label, i) => (
        <text
          key={label}
          wrapMode="none"
          fg={i === tab ? theme.accent : theme.muted}
          bg={i === tab ? theme.selectedBg : undefined}
        >
          {` ${label} `}
        </text>
      ))}
    </box>
  );
}

const SUB_TABS: { key: AuthoredSubTab; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'merged', label: 'Merged & closed' },
];

/**
 * Renders the sub-tab bar of the Your PRs tab, styled like the tab bar
 * above it, with the t key hint that switches between the sub-tabs.
 */
export function SubTabBar({ active }: { active: AuthoredSubTab }) {
  return (
    <box flexDirection="row" height={1} paddingLeft={1} marginBottom={1} columnGap={1}>
      {SUB_TABS.map(({ key, label }) => (
        <text
          key={key}
          wrapMode="none"
          fg={key === active ? theme.accent : theme.muted}
          bg={key === active ? theme.selectedBg : undefined}
        >
          {` ${label} `}
        </text>
      ))}
      <text wrapMode="none" fg={theme.dim}>
        t switches
      </text>
    </box>
  );
}
