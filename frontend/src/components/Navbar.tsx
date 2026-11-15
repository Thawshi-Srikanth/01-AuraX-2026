import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, Search, X } from 'lucide-react';
import { NavigationTab } from '../tokens/colors';
import './navigation.css';

interface NavbarProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  onOpenSearch: () => void;
  targetLabel: string;
  coordinateLabel?: string;
  labelUnverified?: boolean;
}

const PRIMARY: { id: NavigationTab; label: string; description: string }[] = [
  { id: 'Home', label: 'Home', description: 'Choose a starting position' },
  { id: 'Explore', label: 'Sky map', description: 'Find your way around the sky' },
  { id: 'Observations', label: 'Images', description: 'View observations and play through dates' },
  { id: 'Compare', label: 'Compare images', description: 'Inspect images across wavelengths and observations' },
];
const SECONDARY: typeof PRIMARY = [
  { id: 'Collections', label: 'Saved targets', description: 'Return to your collections' },
  { id: 'Docs', label: 'Guide', description: 'Learn how to use AURAx and read the data' },
];

export function Navbar({ activeTab, onTabChange, onOpenSearch, targetLabel, coordinateLabel, labelUnverified }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = [...PRIMARY, ...SECONDARY].find(item => item.id === activeTab);
  const secondaryActive = SECONDARY.some(item => item.id === activeTab && item.id !== 'Docs');

  useEffect(() => {
    if (!isOpen) return;
    function closeOutside(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function closeEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [isOpen]);

  function navigate(tab: NavigationTab) {
    setIsOpen(false);
    onTabChange(tab);
    triggerRef.current?.focus();
  }

  return (
    <header className="app-header">
      <div className="app-navigation">
        <button type="button" className="app-brand" onClick={() => { setIsOpen(false); onTabChange('Home'); }} aria-label="AURAx home">
          <img src="/aura.svg" alt="" />
          <span>AURAx</span>
        </button>
        <nav className="app-primary-nav" aria-label="Main navigation">
          {PRIMARY.map(item => <button type="button" key={item.id} aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => { setIsOpen(false); onTabChange(item.id); }}>{item.label}</button>)}
        </nav>
        <span className="app-current-page">{current?.label}</span>
        <div className="app-nav-actions">
          {activeTab !== 'Home' && <button type="button" className="app-search" aria-label="Find a target" onClick={() => { setIsOpen(false); onOpenSearch(); }}>
            <Search size={16} aria-hidden="true" /><span>Find a target</span>
          </button>}
          <button type="button" className="app-guide-link" aria-current={activeTab === 'Docs' ? 'page' : undefined} onClick={() => { setIsOpen(false); onTabChange('Docs'); }}>Guide</button>
          <div ref={menuRef} className="app-menu-container">
            <button ref={triggerRef} type="button" className="app-menu-trigger" aria-label="Navigation menu" aria-expanded={isOpen} aria-controls="app-navigation-menu" data-active={secondaryActive || undefined} onClick={() => setIsOpen(open => !open)}>
              {isOpen ? <X size={17} aria-hidden="true" /> : <Menu size={17} className="app-mobile-menu-icon" aria-hidden="true" />}
              <span className="app-more-label">{secondaryActive ? current?.label : 'More'}</span><span className="app-mobile-menu-label">Menu</span>
              <ChevronDown size={14} className="app-more-chevron" aria-hidden="true" />
            </button>
            {isOpen && <nav id="app-navigation-menu" className="app-navigation-menu" aria-label="All pages">
              <div className="app-menu-primary">
                <p>Explore</p>
                {PRIMARY.map(item => <button type="button" key={item.id} aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><span>{item.label}</span><small>{item.description}</small></button>)}
              </div>
              <div className="app-menu-secondary">
                <p>Tools &amp; help</p>
                {SECONDARY.map(item => <button type="button" key={item.id} className={item.id === 'Docs' ? 'app-menu-guide' : undefined} aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><span>{item.label}</span><small>{item.description}</small></button>)}
              </div>
            </nav>}
          </div>
        </div>
      </div>
      {activeTab !== 'Home' && activeTab !== 'Docs' && <div className="app-target-context">
        <p><span>Target</span><strong title={targetLabel}>{targetLabel}</strong>{coordinateLabel && <span className="app-target-coordinates">{coordinateLabel}</span>}{labelUnverified && <span className="app-target-verification" title="The name came from this link. The supplied coordinates determine the queried position.">URL label · unverified</span>}</p>
        <button type="button" onClick={onOpenSearch}>Change target</button>
      </div>}
    </header>
  );
}
