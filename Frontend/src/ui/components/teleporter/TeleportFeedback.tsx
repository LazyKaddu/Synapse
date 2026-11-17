import React from 'react';
import { useTeleportStore, type ToastType } from '../../../store/teleportStore.ts';
import { TOKENS } from '../building-editor/theme.ts';
import { CloseIcon, SparklesIcon, TeleportIcon } from './icons.tsx';

export const TeleportFeedback: React.FC = () => {
  const flashActive = useTeleportStore((state) => state.flashActive);
  const toast = useTeleportStore((state) => state.toast);
  const clearToast = useTeleportStore((state) => state.clearToast);

  const getToastColors = (type: ToastType = 'info') => {
    switch (type) {
      case 'success':
        return {
          border: 'rgba(74, 222, 128, 0.5)',
          glow: '0 4px 20px rgba(74, 222, 128, 0.25)',
          badgeColor: '#4ade80',
          badgeBg: 'rgba(74, 222, 128, 0.15)',
        };
      case 'error':
        return {
          border: 'rgba(248, 113, 113, 0.5)',
          glow: '0 4px 20px rgba(248, 113, 113, 0.25)',
          badgeColor: '#f87171',
          badgeBg: 'rgba(248, 113, 113, 0.15)',
        };
      case 'warning':
        return {
          border: 'rgba(251, 191, 36, 0.5)',
          glow: '0 4px 20px rgba(251, 191, 36, 0.25)',
          badgeColor: '#fbbf24',
          badgeBg: 'rgba(251, 191, 36, 0.15)',
        };
      case 'info':
      default:
        return {
          border: 'rgba(56, 189, 248, 0.5)',
          glow: '0 4px 20px rgba(56, 189, 248, 0.25)',
          badgeColor: '#38bdf8',
          badgeBg: 'rgba(56, 189, 248, 0.15)',
        };
    }
  };

  const toastStyle = toast ? getToastColors(toast.type) : null;

  return (
    <>
      {/* 1. Fullscreen Radial Cyan/Blue Pulse Vignette */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 99990,
          opacity: flashActive ? 1 : 0,
          transition: 'opacity 240ms cubic-bezier(0.22, 1, 0.36, 1)',
          background:
            'radial-gradient(circle at center, rgba(56, 189, 248, 0.45) 0%, rgba(14, 165, 233, 0.28) 45%, rgba(6, 182, 212, 0.55) 75%, rgba(2, 132, 199, 0.82) 100%)',
          boxShadow: 'inset 0 0 140px rgba(56, 189, 248, 0.65)',
        }}
      />

      {/* 2. Floating HUD Toast Notification */}
      {toast && toastStyle && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 18px',
            borderRadius: 10,
            backgroundColor: 'rgba(15, 23, 42, 0.94)',
            backdropFilter: 'blur(16px)',
            border: `1px solid ${toastStyle.border}`,
            boxShadow: `0 8px 30px rgba(0, 0, 0, 0.5), ${toastStyle.glow}`,
            color: TOKENS.textPrimary,
            fontFamily: TOKENS.fontSans,
            fontSize: 13,
            maxWidth: '90vw',
            animation: 'teleportToastIn 200ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              backgroundColor: toastStyle.badgeBg,
              color: toastStyle.badgeColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {toast.type === 'success' ? (
              <SparklesIcon size={14} />
            ) : (
              <TeleportIcon size={14} />
            )}
          </div>

          <div
            style={{
              fontWeight: 500,
              lineHeight: 1.4,
              color: TOKENS.textPrimary,
            }}
          >
            {toast.message}
          </div>

          <button
            type="button"
            onClick={clearToast}
            aria-label="Dismiss notification"
            style={{
              background: 'none',
              border: 'none',
              color: TOKENS.textMuted,
              cursor: 'pointer',
              padding: 2,
              marginLeft: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
            }}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </>
  );
};
