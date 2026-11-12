import type { CSSProperties } from 'react';

/**
 * Workshop slate/ink palette tokens aligned to a 4px grid and hairline borders.
 */
export const TOKENS = {
  bgDeepest: '#090b10',
  bgCanvas: '#0e1118',
  bgPanel: '#131722',
  bgRaised: '#1b202e',
  bgHover: '#222839',
  hairline: 'rgba(238, 240, 245, 0.08)',
  hairlineStrong: 'rgba(238, 240, 245, 0.16)',
  textPrimary: '#eef0f5',
  textSecondary: '#a3a9b8',
  textMuted: '#7a8296',
  accent: '#38bdf8',
  accentText: '#09111b',
  accentSurface: 'rgba(56, 189, 248, 0.14)',
  accentHairline: 'rgba(56, 189, 248, 0.4)',
  positive: '#4cc38a',
  positiveSurface: 'rgba(76, 195, 138, 0.12)',
  warning: '#e5a93c',
  warningSurface: 'rgba(229, 169, 60, 0.12)',
  negative: '#e5484d',
  negativeSurface: 'rgba(229, 72, 77, 0.14)',
  fontSans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

export const keycapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: TOKENS.fontMono,
  fontSize: 11,
  lineHeight: 1,
  color: TOKENS.textSecondary,
  backgroundColor: TOKENS.bgRaised,
  border: `1px solid ${TOKENS.hairlineStrong}`,
  borderRadius: 4,
  padding: '3px 6px',
  fontVariantNumeric: 'tabular-nums',
};

export const baseButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 32,
  padding: '0 10px',
  borderRadius: 6,
  border: `1px solid ${TOKENS.hairline}`,
  backgroundColor: TOKENS.bgRaised,
  color: TOKENS.textPrimary,
  fontFamily: TOKENS.fontSans,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: `background-color 140ms ${TOKENS.ease}, border-color 140ms ${TOKENS.ease}, color 140ms ${TOKENS.ease}`,
  whiteSpace: 'nowrap',
};

export const activeButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: TOKENS.accentSurface,
  borderColor: TOKENS.accentHairline,
  color: TOKENS.textPrimary,
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.10)',
};

export const primaryButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: TOKENS.textPrimary,
  borderColor: TOKENS.textPrimary,
  color: TOKENS.bgDeepest,
  fontWeight: 600,
};

export const accentButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: TOKENS.accent,
  borderColor: TOKENS.accent,
  color: TOKENS.accentText,
  fontWeight: 600,
};

export const compactIconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  height: 28,
  padding: '0 8px',
  borderRadius: 6,
  border: `1px solid ${TOKENS.hairline}`,
  backgroundColor: TOKENS.bgRaised,
  color: TOKENS.textSecondary,
  fontFamily: TOKENS.fontSans,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  transition: `background-color 140ms ${TOKENS.ease}, border-color 140ms ${TOKENS.ease}, color 140ms ${TOKENS.ease}`,
  whiteSpace: 'nowrap',
};
