/**
 * SVG icon constants for action buttons.
 * All icons are 16×16, stroke-based (Lucide-style).
 */

const S = ' xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const ICON_EDIT =
  `<svg${S}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;

export const ICON_TRASH =
  `<svg${S}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;

export const ICON_RESTORE =
  `<svg${S}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

export const ICON_USER_X =
  `<svg${S}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" x2="22" y1="8" y2="13"/><line x1="22" x2="17" y1="8" y2="13"/></svg>`;

export const ICON_COPY =
  `<svg${S}><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

export const ICON_EYE_OFF =
  `<svg${S}><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;

export const ICON_EYE =
  `<svg${S}><path d="M2.06 12.35a1 1 0 0 1 0-.7C3.3 8.4 7.03 5 12 5s8.7 3.4 9.94 6.65a1 1 0 0 1 0 .7C20.7 15.6 16.97 19 12 19s-8.7-3.4-9.94-6.65"/><circle cx="12" cy="12" r="3"/></svg>`;

export const ICON_SEARCH =
  `<svg${S}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;

/**
 * Wraps an SVG icon string in a <button> with tooltip and aria-label.
 *
 * @param {object} options
 * @param {string} options.icon   - SVG markup
 * @param {string} options.label  - Visible tooltip / aria-label
 * @param {string} [options.action]   - data-action value
 * @param {string} [options.dataId]   - data-id or data-uid value
 * @param {string} [options.dataKey]  - attribute name for the id ("data-id" | "data-uid" | "data-copy-uid")
 * @param {string} [options.cls]      - extra CSS classes
 * @param {string} [options.style]    - inline style
 * @returns {string} HTML string for the icon button
 */
export function iconBtn({ icon, label, action, dataId, dataKey = "data-uid", cls = "", style = "" }) {
  const actionAttr = action ? ` data-action="${action}"` : "";
  const idAttr = dataId ? ` ${dataKey}="${dataId}"` : "";
  const extraClass = cls ? ` ${cls}` : "";
  const inlineStyle = style ? ` style="${style}"` : "";

  return `<button type="button" class="admin-btn-icon${extraClass}"${actionAttr}${idAttr} title="${label}" aria-label="${label}"${inlineStyle}>${icon}</button>`;
}
