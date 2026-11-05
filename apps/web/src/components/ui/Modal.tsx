import React from 'react';
import { cx } from './cx';
import s from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** px (number) ou string CSS. Padrao 560. */
  maxWidth?: number | string;
  /** md: padding 28, h2 20px. sm: padding 24, h3 18px. */
  size?: 'md' | 'sm';
  /** limita a 90vh com scroll (padrao true) */
  scroll?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Modal({ open, onClose, title, maxWidth = 560, size = 'md', scroll = true, className, children }: ModalProps) {
  if (!open) return null;
  const Heading = size === 'sm' ? 'h3' : 'h2';
  return (
    <div className={s.overlay}>
      <div
        className={cx(s.panel, s[size], scroll && s.scroll, className)}
        style={{ maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth }}
        role="dialog"
        aria-modal="true"
      >
        <div className={s.header}>
          <Heading className={s.title}>{title}</Heading>
          <button type="button" className={s.close} onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
