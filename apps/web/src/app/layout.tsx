import React from 'react';

export const metadata = {
  title: 'Clip Capture',
  description: 'Gravação e compartilhamento de lances esportivos',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, padding: 0, fontFamily: 'sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
