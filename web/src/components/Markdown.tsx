import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from './Icons';

function CodeBlock({ lang, children }: { lang: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const copy = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Read the rendered text rather than the React tree: rehype-highlight has
    // already split the source into dozens of nested syntax spans.
    const code = e.currentTarget.closest('.code-block')?.querySelector('code')?.textContent ?? '';
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || 'code'}</span>
        <button className="code-copy" onClick={copy} aria-label="Copy code">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>
          ),
          pre: ({ children }) => {
            // react-markdown hands us <pre><code class="language-x">. Lift the
            // language out so the header can show it, and keep <code> inside.
            const el = children as { props?: { className?: string } } | undefined;
            const lang = /language-(\w+)/.exec(el?.props?.className ?? '')?.[1] ?? '';
            return <CodeBlock lang={lang}>{children}</CodeBlock>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
