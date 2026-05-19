/** Inline SVG icons for the admin sidebar (stroke icons, 24×24 viewBox). */

const svg = (paths: string) =>
  `<svg class="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ADMIN_SB_ICONS: Record<string, string> = {
  overview: svg(
    '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'
  ),
  inputs: svg(
    '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
  ),
  processing: svg(
    '<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'
  ),
  "workbench-pipeline": svg(
    '<path d="M4 19V5"/><path d="M4 19h16"/><rect x="8" y="9" width="3" height="7" rx="0.5"/><rect x="13" y="7" width="3" height="9" rx="0.5"/>'
  ),
  runs: svg('<path d="M4 4h16v4H4z"/><path d="M4 10h16v4H4z"/><path d="M4 16h16v4H4z"/>'),
  jobs: svg(
    '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>'
  ),
  "workbench-review": svg(
    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'
  ),
  "workbench-runs": svg('<path d="M4 4h16v4H4z"/><path d="M4 10h16v4H4z"/><path d="M4 16h16v4H4z"/>'),
  "workbench-publish": svg('<path d="M12 19V5M5 12l7-7 7 7"/><path d="M19 21H5"/>'),
  learning: svg(
    '<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>'
  ),
  config: svg(
    '<path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/>'
  ),
  "workbench-playground": svg(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>'
  ),
  "platform-overview": svg(
    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'
  ),
  projects: svg('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>'),
  "global-learning": svg(
    '<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>'
  ),
  engine: svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
  "learning-prompts": svg('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
  "flow-engine": svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
  "prompt-labs": svg('<path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44 2.5 2.5 0 01-2.96-3.08 3 3 0 01-.34-5.58 2.5 2.5 0 011.32-4.24 2.5 2.5 0 014.44-2.54z"/>'),
  "carousel-templates": svg(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>'
  ),
  health: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
};

export function adminSidebarIcon(key: string): string {
  return ADMIN_SB_ICONS[key] ?? "";
}

export function adminSbLink(href: string, label: string, key: string, active: string, extraClass = ""): string {
  const icon = adminSidebarIcon(key);
  const cls = `sb-link${key === active ? " active" : ""}${extraClass ? ` ${extraClass}` : ""}`;
  return `<a href="${href}" class="${cls}">${icon}<span>${label}</span></a>`;
}
