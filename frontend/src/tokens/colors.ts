// 01_AURAx SpaceX Design Tokens
export const COLORS = {
  bg: {
    app: '#050507',
    surface: '#0B0D11',
    raised: '#12151C',
    overlay: '#181C26',
    hover: '#1E2330',
  },
  border: {
    subtle: '#1C2029',
    strong: '#2D3442',
    focus: '#4F5B73',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#888E9B',
    tertiary: '#555C6D',
    disabled: '#363B47',
  },
  science: {
    band1: '#6366F1', // 0.75 - 1.09 µm
    band2: '#38BDF8', // 1.10 - 1.62 µm
    band3: '#10B981', // 1.63 - 2.41 µm
    band4: '#FBBF24', // 2.42 - 3.82 µm
    band5: '#F97316', // 3.83 - 4.41 µm
    band6: '#EF4444', // 4.42 - 5.00 µm
    epochA: '#F97316',
    epochB: '#38BDF8',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
  },
} as const;

// Official SPHEREx 6-Detector Visual Bandpass Palette
export const DETECTOR_COLORS: Record<string, string> = {
  D1: '#38BDF8', // 0.75 - 1.11 µm (Near-IR Sky Blue)
  D2: '#2DD4BF', // 1.11 - 1.64 µm (Teal)
  D3: '#34D399', // 1.64 - 2.42 µm (Emerald)
  D4: '#FBBF24', // 2.42 - 3.82 µm (Amber)
  D5: '#FB923C', // 3.82 - 4.42 µm (Orange)
  D6: '#F87171', // 4.42 - 5.00 µm (Warm Red / Rose)
};

export type NavigationTab = 'Home' | 'Explore' | 'Observations' | 'Compare' | 'Wavelengths' | 'Collections' | 'Docs';
