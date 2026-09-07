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

/**
 * Renders the sub-tab bar of a tab with sub-tabs, styled like the tab
 * bar above it, with the t key hint that switches between the sub-tabs.
 * A sub-tab the alerts flag leads with an asterisk in the accent color,
 * so work waiting on another sub-tab shows without switching to it. The
 * ASCII asterisk renders the same in every terminal font, where the
 * bullet and circle glyphs vary in size and sit off center.
 */
export function SubTabBar<K extends string>({
  tabs,
  active,
  alerts = {},
}: {
  tabs: { key: K; label: string }[];
  active: K;
  alerts?: Partial<Record<K, boolean>>;
}) {
  return (
    <box flexDirection="row" height={1} paddingLeft={1} marginBottom={1} columnGap={1}>
      {tabs.map(({ key, label }) => {
        const isActive = key === active;
        const bg = isActive ? theme.selectedBg : undefined;

        return (
          <text key={key} wrapMode="none">
            <span fg={isActive ? theme.accent : theme.muted} bg={bg}>
              {' '}
            </span>
            {alerts[key] === true && (
              <span fg={theme.accent} bg={bg}>
                {'* '}
              </span>
            )}
            <span fg={isActive ? theme.accent : theme.muted} bg={bg}>
              {`${label} `}
            </span>
          </text>
        );
      })}
      <text wrapMode="none" fg={theme.dim}>
        t switches
      </text>
    </box>
  );
}
