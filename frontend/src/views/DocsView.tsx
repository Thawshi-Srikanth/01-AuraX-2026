import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { NavigationTab } from '../tokens/colors';
import mission from '../content/docs/01-mission-overview.md?raw';
import optics from '../content/docs/02-instrument-optics.md?raw';
import archive from '../content/docs/03-backend-relay-and-caching.md?raw';
import coordinates from '../content/docs/04-celestial-coordinates.md?raw';
import photometry from '../content/docs/05-surface-brightness-photometry.md?raw';
import wavelengths from '../content/docs/06-lvf-spectroscopy.md?raw';
import comparison from '../content/docs/07-wcs-reprojection-proper-motion.md?raw';
import './docs.css';

const ARTICLES = [
  { id: 'mission-overview', category: 'Start here', title: 'Your first observation', description: 'Find a target and understand what you are looking at.', content: mission },
  { id: 'instrument-optics', category: 'Understand the data', title: 'How light becomes an image', description: 'Follow light through the telescope, filter, and detector.', content: optics },
  { id: 'celestial-coordinates', category: 'Understand the data', title: 'Find a position in the sky', description: 'Read right ascension, declination, and coordinate epochs.', content: coordinates },
  { id: 'surface-brightness', category: 'Understand the data', title: 'Read brightness and flux', description: 'Understand pixel values before measuring a source.', content: photometry },
  { id: 'lvf-spectroscopy', category: 'Understand the data', title: 'Understand wavelengths', description: 'Why detector position also selects wavelength.', content: wavelengths },
  { id: 'wcs-reprojection', category: 'Compare observations', title: 'Compare dates carefully', description: 'Match wavelengths, align the sky, and inspect a sequence.', content: comparison },
  { id: 'backend-relay-and-caching', category: 'Behind the scenes', title: 'From archive to screen', description: 'Where images come from and what caching changes.', content: archive },
];

function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}
function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}
export const DocsView: React.FC<{ onNavigate?: (tab: NavigationTab) => void }> = ({ onNavigate }) => {
  const [articleId, setArticleId] = useState(ARTICLES[0].id);
  const [query, setQuery] = useState('');
  const [sectionId, setSectionId] = useState('');
  const contentRef = useRef<HTMLElement>(null);
  const article = ARTICLES.find(item => item.id === articleId) ?? ARTICLES[0];
  const index = ARTICLES.indexOf(article);
  const toc = useMemo(() => article.content.split('\n').flatMap(line => {
    const match = /^## (.+)$/.exec(line);
    return match ? [{ title: match[1], id: slug(match[1]) }] : [];
  }), [article]);
  const filtered = ARTICLES.filter(item => (item.title + ' ' + item.content).toLowerCase().includes(query.toLowerCase().trim()));
  const categories = [...new Set(ARTICLES.map(item => item.category))];

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    root.scrollTo({ top: 0, behavior: 'instant' });
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setSectionId(visible[0].target.id);
    }, { root, rootMargin: '0px 0px -65% 0px' });
    root.querySelectorAll('h2[id]').forEach(heading => observer.observe(heading));
    return () => observer.disconnect();
  }, [article]);

  function selectArticle(id: string) {
    if (id === articleId) return;
    setArticleId(id);
    setSectionId('');
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  }

  return (
    <div className="docs-shell">
      <aside className="docs-sidebar" aria-label="Documentation chapters">
        <div className="docs-sidebar-header">
          <p className="docs-eyebrow">AURAx guide</p>
          <label className="docs-search-label" htmlFor="docs-search">Search guides</label>
          <input id="docs-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search guides" />
        </div>
        <nav className="docs-chapters">
          {categories.map(category => {
            const items = filtered.filter(item => item.category === category);
            return items.length > 0 && <div className="docs-chapter-group" key={category}>
              <p className="docs-eyebrow">{category}</p>
              {items.map(item => <button key={item.id} aria-current={item.id === articleId ? 'page' : undefined} onClick={() => selectArticle(item.id)}>{item.title}</button>)}
            </div>;
          })}
          {filtered.length === 0 && <p className="docs-muted" role="status">No matching guides. Try “wavelength” or “brightness”.</p>}
        </nav>
        {onNavigate && <button className="docs-open-sky" onClick={() => onNavigate('Explore')}>Open sky map <span aria-hidden="true">↗</span></button>}
      </aside>
      <main ref={contentRef} className="docs-main" aria-label="Guide content">
        <div className="docs-mobile-nav">
          <label htmlFor="docs-chapter">Choose a guide</label>
          <select id="docs-chapter" value={articleId} onChange={event => selectArticle(event.target.value)}>
            {ARTICLES.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </div>
        <article className="docs-article" key={article.id}>
          <header className="docs-article-header">
            <p className="docs-eyebrow">{article.category}</p>
            <h1>{article.title}</h1>
            <p className="docs-deck">{article.description}</p>
          </header>
          <details className="docs-mobile-toc">
            <summary>On this page</summary>
            {toc.map(item => <a key={item.id} href={'#' + item.id}>{item.title}</a>)}
          </details>
          <div className="docs-prose">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{
              h2: ({ children }) => <h2 id={slug(nodeText(children))}>{children}</h2>,
              h3: ({ children }) => <h3 id={slug(nodeText(children))}>{children}</h3>,
              img: ({ src, alt }) => <a className="docs-figure-link" href={src} target="_blank" rel="noreferrer" aria-label={'Open full-size illustration: ' + (alt ?? '')} title="Open full-size illustration"><img src={src} alt={alt ?? ''} loading="lazy" decoding="async" /></a>,
              a: ({ href, children }) => <a href={href} {...(href?.startsWith('https://') ? { target: '_blank', rel: 'noreferrer' } : {})}>{children}</a>,
            }}>{article.content}</ReactMarkdown>
          </div>
          <nav className="docs-pagination" aria-label="Adjacent guides">
            <div>{index > 0 && <button onClick={() => selectArticle(ARTICLES[index - 1].id)}><span>Previous guide</span>← {ARTICLES[index - 1].title}</button>}</div>
            <div>{index < ARTICLES.length - 1 && <button onClick={() => selectArticle(ARTICLES[index + 1].id)}><span>Next guide</span>{ARTICLES[index + 1].title} →</button>}</div>
          </nav>
        </article>
      </main>
      <aside className="docs-toc" aria-label="On this page">
        <p className="docs-eyebrow">On this page</p>
        <nav>{toc.map(item => <a key={item.id} href={'#' + item.id} aria-current={sectionId === item.id ? 'location' : undefined}>{item.title}</a>)}</nav>
        <p className="docs-figure-note">Illustrations explain concepts. They are schematics, not observations.</p>
      </aside>
    </div>
  );
};
