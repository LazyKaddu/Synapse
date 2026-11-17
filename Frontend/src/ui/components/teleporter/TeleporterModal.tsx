import React, { useEffect, useMemo } from 'react';
import { useGameStore } from '../../../store/gameStore.ts';
import {
  type TeleportTab,
  useTeleportStore,
} from '../../../store/teleportStore.ts';
import { WorldNoise } from '../../../engine/procedural/worldNoise.ts';
import { keycapStyle, TOKENS } from '../building-editor/theme.ts';
import {
  CloseIcon,
  CompassIcon,
  FriendsIcon,
  LandmarkIcon,
  TeleportIcon,
} from './icons.tsx';
import { LandmarksTab } from './LandmarksTab.tsx';
import { CoordinatesTab } from './CoordinatesTab.tsx';
import { FriendsTab } from './FriendsTab.tsx';

export interface TeleporterModalProps {
  onTeleport?: (worldX: number, worldY: number, label?: string) => void;
}

export const TeleporterModal: React.FC<TeleporterModalProps> = ({ onTeleport }) => {
  const isOpen = useTeleportStore((state) => state.isOpen);
  const closeModal = useTeleportStore((state) => state.closeModal);
  const activeTab = useTeleportStore((state) => state.activeTab);
  const setActiveTab = useTeleportStore((state) => state.setActiveTab);
  const showToast = useTeleportStore((state) => state.showToast);

  const worldSeed = useGameStore((state) => state.worldSeed);
  const worldNoise = useMemo(() => new WorldNoise(worldSeed), [worldSeed]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, closeModal]);

  if (!isOpen) {
    return null;
  }

  const handleExecuteTeleport = (worldX: number, worldY: number, label?: string): void => {
    if (onTeleport) {
      onTeleport(worldX, worldY, label);
    } else {
      showToast(label ? `Teleported to ${label}` : 'Teleported!', 'success');
      closeModal();
    }
  };

  const tabs: Array<{ id: TeleportTab; label: string; icon: React.ReactNode }> = [
    { id: 'landmarks', label: 'Landmarks', icon: <LandmarkIcon size={14} /> },
    { id: 'coordinates', label: 'Coordinates', icon: <CompassIcon size={14} /> },
    { id: 'friends', label: 'Friends', icon: <FriendsIcon size={14} /> },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Teleportation Waypoint Modal"
      onClick={closeModal}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99900,
        backgroundColor: 'rgba(9, 11, 16, 0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        fontFamily: TOKENS.fontSans,
      }}
    >
      {/* Modal Dialog Card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '90vh',
          backgroundColor: TOKENS.bgPanel,
          border: `1px solid ${TOKENS.hairlineStrong}`,
          borderRadius: 12,
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'teleportModalEnter 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Modal Header */}
        <header
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${TOKENS.hairline}`,
            backgroundColor: TOKENS.bgRaised,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                backgroundColor: TOKENS.accentSurface,
                color: TOKENS.accent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 0 12px ${TOKENS.accentHairline}`,
              }}
            >
              <TeleportIcon size={20} />
            </div>

            <div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: TOKENS.textPrimary,
                  letterSpacing: -0.2,
                }}
              >
                Teleportation Waypoint
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: TOKENS.textSecondary,
                  marginTop: 2,
                }}
              >
                Instant transit across landmarks, coordinates, and online friends
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={closeModal}
            aria-label="Close modal"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: `1px solid ${TOKENS.hairline}`,
              borderRadius: 6,
              padding: '6px 10px',
              color: TOKENS.textSecondary,
              cursor: 'pointer',
              fontSize: 12,
              backgroundColor: TOKENS.bgPanel,
              transition: `all 140ms ${TOKENS.ease}`,
            }}
          >
            <CloseIcon size={14} />
            <span style={keycapStyle}>Esc</span>
          </button>
        </header>

        {/* Tab Switcher Navigation */}
        <div
          role="tablist"
          style={{
            display: 'flex',
            borderBottom: `1px solid ${TOKENS.hairline}`,
            backgroundColor: TOKENS.bgDeepest,
            padding: '0 16px',
            gap: 4,
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 16px',
                  border: 'none',
                  borderBottom: `2px solid ${isActive ? TOKENS.accent : 'transparent'}`,
                  backgroundColor: 'transparent',
                  color: isActive ? TOKENS.textPrimary : TOKENS.textSecondary,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  transition: `all 140ms ${TOKENS.ease}`,
                }}
              >
                <span style={{ color: isActive ? TOKENS.accent : TOKENS.textMuted }}>
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Modal Scrollable Body */}
        <main
          style={{
            padding: 20,
            overflowY: 'auto',
            maxHeight: 'calc(90vh - 160px)',
            backgroundColor: TOKENS.bgPanel,
          }}
        >
          {activeTab === 'landmarks' && (
            <LandmarksTab worldNoise={worldNoise} onTeleport={handleExecuteTeleport} />
          )}

          {activeTab === 'coordinates' && (
            <CoordinatesTab worldNoise={worldNoise} onTeleport={handleExecuteTeleport} />
          )}

          {activeTab === 'friends' && (
            <FriendsTab onTeleport={handleExecuteTeleport} />
          )}
        </main>

        {/* Modal Footer Hints */}
        <footer
          style={{
            padding: '10px 20px',
            borderTop: `1px solid ${TOKENS.hairline}`,
            backgroundColor: TOKENS.bgDeepest,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 11,
            color: TOKENS.textMuted,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: TOKENS.positive,
              }}
            />
            <span>Anti-stuck safe landing enabled</span>
          </div>

          <div>
            Press <kbd style={keycapStyle}>T</kbd> to toggle in-game
          </div>
        </footer>
      </div>
    </div>
  );
};
