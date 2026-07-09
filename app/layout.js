import './globals.css';

export const metadata = {
  title: 'SignalDesk',
  description: 'Crypto market intelligence — 3 streams, one daily briefing',
};

// Runs before first paint so a returning light-mode reader never sees a
// flash of the dark default. It also defines the one flip handler the
// header button calls. Two states only — dark (default) and light —
// persisted in localStorage. This is the single piece of client JS in the
// app, by design: display stays CSS-driven, this just flips an attribute.
const THEME_BOOT = `(function(){try{
var KEY='signaldesk_theme';
var t=localStorage.getItem(KEY)==='light'?'light':'dark';
var el=document.documentElement;
el.setAttribute('data-theme',t);
function meta(v){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',v==='light'?'#f4f5f7':'#09090b');}
meta(t);
window.__sdToggleTheme=function(){try{
var cur=el.getAttribute('data-theme')==='light'?'light':'dark';
var next=cur==='light'?'dark':'light';
el.setAttribute('data-theme',next);
localStorage.setItem(KEY,next);
meta(next);
}catch(e){}};
}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#09090b" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
