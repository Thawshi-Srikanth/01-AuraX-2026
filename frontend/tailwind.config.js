/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // SpaceX Jet Black & Obsidian Surfaces
        bg: {
          app: '#050507',
          surface: '#0B0D11',
          raised: '#12151C',
          overlay: '#181C26',
          hover: '#1E2330',
        },
        // Hairline Borders
        border: {
          subtle: '#1C2029',
          strong: '#2D3442',
          focus: '#4F5B73',
        },
        // Monochromatic Text & Labels
        text: {
          primary: '#FFFFFF',
          secondary: '#888E9B',
          tertiary: '#555C6D',
          disabled: '#363B47',
        },
        // Functional Colors strictly reserved for scientific data
        science: {
          band1: '#6366F1', // 0.75 - 1.09 µm
          band2: '#38BDF8', // 1.10 - 1.62 µm
          band3: '#10B981', // 1.63 - 2.41 µm
          band4: '#FBBF24', // 2.42 - 3.82 µm
          band5: '#F97316', // 3.83 - 4.41 µm
          band6: '#EF4444', // 4.42 - 5.00 µm
          epochA: '#F97316', // Warm Orange/Red
          epochB: '#38BDF8', // Cool Cyan/Blue
          success: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
