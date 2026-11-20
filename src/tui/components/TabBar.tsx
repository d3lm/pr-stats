import { TABS } from '../state/browse';
import { theme } from '../theme';

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
 * Marks alerts with an ASCII asterisk because bullet and circle glyphs vary in size
 * across terminal fonts.
 */
export function SubTabBar<K extends string>({
  tabs,
  active,
  alerts = {},
  hint = 't/T switches',
}: {
  tabs: { key: K; label: string }[];
  active: K;
  alerts?: Partial<Record<K, boolean>>;
  hint?: string | null;
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
      {hint === null ? null : (
        <text wrapMode="none" fg={theme.dim}>
          {hint}
        </text>
      )}
    </box>
  );
}
