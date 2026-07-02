import './globals.css';

export const metadata = {
  title: 'SignalDesk',
  description: 'Crypto market intelligence — 3 streams, one daily briefing',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
