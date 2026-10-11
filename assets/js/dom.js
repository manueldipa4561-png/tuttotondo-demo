// Tiny DOM helper for the home sections: guest-visible text always goes through textContent, never innerHTML.
// `style` is a map of CSS custom properties or properties; `attrs` are plain attributes.
export function h(tag, { style, attrs, ...props } = {}, ...children) {
  const el = Object.assign(document.createElement(tag), props);
  Object.entries(style ?? {}).forEach(([key, value]) => el.style.setProperty(key, value));
  Object.entries(attrs ?? {}).forEach(([key, value]) => el.setAttribute(key, value));
  el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// "{name}" placeholders, same convention as the booking page
export const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
