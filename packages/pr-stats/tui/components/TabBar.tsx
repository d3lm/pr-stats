import { TABS } from '../state/browse';
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
