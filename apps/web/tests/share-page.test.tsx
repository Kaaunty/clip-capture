/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import ShareEventView from '../src/app/share/[token]/ShareEventView';
import SharePage from '../src/app/share/[token]/page';

afterEach(() => {
  cleanup();
});

describe('ShareEventView', () => {
  it('renders multiple camera angles and unavailable badge', () => {
    const props = {
      eventName: 'Lance 28/09 18:30 - Campo 1',
      angles: [
        { id: '1', cameraName: 'Gol Norte', status: 'READY', videoUrl: 'https://s3/c1.mp4' },
        { id: '2', cameraName: 'Lateral Direita', status: 'CAMERA_UNAVAILABLE', videoUrl: null },
      ],
    };
    render(<ShareEventView {...props} />);
    expect(screen.getByText('Gol Norte')).toBeDefined();
    expect(screen.getByText('Lateral Direita')).toBeDefined();
    expect(screen.getByText('Câmera Indisponível')).toBeDefined();
  });

  it('renders video player controls and download button for ready angles', () => {
    const props = {
      eventName: 'Lance 28/09 18:30 - Campo 1',
      angles: [
        {
          id: '1',
          cameraName: 'Gol Norte',
          status: 'READY',
          videoUrl: 'https://s3/c1.mp4',
          downloadUrl: 'https://s3/c1.mp4?download=1',
        },
      ],
    };
    const { container } = render(<ShareEventView {...props} />);
    const video = container.querySelector('video');
    expect(video).toBeDefined();
    expect(video?.getAttribute('src')).toBe('https://s3/c1.mp4');
    expect(video?.getAttribute('controls')).not.toBeNull();
    expect(screen.getByText(/Baixar/i)).toBeDefined();
  });

  it('renders WhatsApp share button with encoded message', () => {
    const props = {
      eventName: 'Lance 28/09 18:30 - Campo 1',
      shareUrl: 'http://localhost:3000/share/sampletoken123',
      angles: [
        { id: '1', cameraName: 'Gol Norte', status: 'READY', videoUrl: 'https://s3/c1.mp4' },
      ],
    };
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', props.shareUrl);
    }
    render(<ShareEventView {...props} />);
    const waButton = screen.getByText('Compartilhar no WhatsApp');
    expect(waButton).toBeDefined();
    const link = waButton.closest('a');
    expect(link?.getAttribute('href')).toContain('whatsapp.com');
    expect(link?.getAttribute('href')).toContain('sampletoken123');
  });

  it('renders clean error state for expired or invalid token', () => {
    render(
      <ShareEventView
        error="Link expirado ou inválido"
        eventName=""
        angles={[]}
      />
    );
    expect(screen.getByText('Link expirado ou inválido')).toBeDefined();
  });

  it('renders SharePage server component with error state when token not found', async () => {
    const pageElement = await SharePage({
      params: Promise.resolve({ token: 'nonexistent-token-xyz' }),
    });
    render(pageElement);
    expect(screen.getByText('Link expirado ou inválido')).toBeDefined();
  });
});
