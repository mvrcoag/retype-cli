export const APP_NAME = "ReType";
export const APP_VERSION = "1.1.0";
export const APP_AUTHOR = "mvrcoag";
export const APP_DESCRIPTION = `The TypeScript Refactoring CLI - @${APP_AUTHOR}`;

export const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/*.d.ts",
  "**/*.test.ts",
  "**/*.spec.ts",
];

export const ENTITY_KINDS = [
  "function",
  "class",
  "variable",
  "interface",
  "type",
  "enum",
] as const;

export const COLORS = {
  primary: "#60A5FA",
  secondary: "#34D399",
  warning: "#FBBF24",
  error: "#F87171",
  info: "#38BDF8",
  muted: "#9CA3AF",
  accent: "#A78BFA",
} as const;

export const ICONS = {
  function: "fn",
  class: "C",
  variable: "V",
  interface: "I",
  type: "T",
  enum: "E",
  success: "\u2714",
  error: "\u2718",
  warning: "\u26A0",
  info: "\u2139",
  arrow: "\u2192",
  back: "\u2190",
} as const;
