import { Monitor, Moon, ScanSearch, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { Badge } from '../components/badges';
import type { DemoMode } from '../data/examples';
import { cx } from '../lib/cx';
import { useTheme } from '../lib/hooks';
import type { ThemePreference } from '../lib/hooks';
import type { Route } from './router';
import { useStore } from './store';

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'system', label: 'System theme', icon: Monitor },
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
];

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const name = useId();
  return (
    <fieldset className="segmented segmented--icons">
      <legend className="visually-hidden">Color theme</legend>
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <label key={value} className="segmented__option" title={label}>
          <input
            type="radio"
            name={name}
            checked={theme === value}
            onChange={() => setTheme(value)}
          />
          <span>
            <Icon size={15} />
            <span className="visually-hidden">{label}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

type Section = 'runs' | 'examples' | 'format' | undefined;

function sectionOf(route: Route): Section {
  switch (route.name) {
    case 'home':
      return 'runs';
    case 'examples':
      return 'examples';
    case 'format':
      return 'format';
    case 'run':
      return route.source === 'example' ? 'examples' : 'runs';
    case 'not-found':
      return undefined;
  }
}

export function AppHeader({ route, demo }: { route: Route; demo?: DemoMode }) {
  const { imports } = useStore();
  const section = sectionOf(route);
  // aria-current="page" only on the exact page; inside a run the section is highlighted.
  const current = (name: Route['name']) => (route.name === name ? 'page' : undefined);

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <a className="brand" href="#/">
          <span className="brand__mark" aria-hidden="true">
            <ScanSearch size={18} />
          </span>
          <span className="brand__name">Agent Incident Investigator</span>
        </a>
        <nav className="app-nav" aria-label="Main">
          <a
            href="#/"
            className={cx(section === 'runs' && 'is-active')}
            aria-current={current('home')}
          >
            Runs
            {imports.length > 0 && <span className="app-nav__count">{imports.length}</span>}
          </a>
          <a
            href="#/examples"
            className={cx(section === 'examples' && 'is-active')}
            aria-current={current('examples')}
          >
            Examples
          </a>
          <a
            href="#/format"
            className={cx(section === 'format' && 'is-active')}
            aria-current={current('format')}
          >
            Format
          </a>
        </nav>
        <div className="app-header__end">
          {demo && (
            <Badge tone="warning" className="demo-flag">
              Demo state: {demo}
            </Badge>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
