import React from 'react';
import { NavigationTab } from '../tokens/colors';
import { ResolvedTarget } from '../services/api';
import { SkyMapView } from '../components/SkyMapView';

interface ExploreViewProps {
  onNavigate: (tab: NavigationTab) => void;
  onTargetResolved: (target: ResolvedTarget) => void;
  activeTarget?: ResolvedTarget;
}

export const ExploreView: React.FC<ExploreViewProps> = ({ onNavigate, onTargetResolved, activeTarget }) => {
  return (
    <div className="flex-1 w-full h-full flex flex-col relative overflow-hidden bg-bg-app select-none">
      {/* 100% Edge-to-Edge Celestial Sky Atlas Viewport */}
      <SkyMapView onNavigate={onNavigate} onTargetResolved={onTargetResolved} activeTarget={activeTarget} />
    </div>
  );
};

export default ExploreView;
