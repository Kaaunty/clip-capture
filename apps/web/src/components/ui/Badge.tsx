import React from 'react';
import { cx } from './cx';
import s from './Badge.module.css';

export type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'primary';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** md: 12px, pill, 4px 10px. sm: 11px, raio 4px, 2px 8px. */
  size?: 'md' | 'sm';
  /** peso da fonte (md: 700 padrao; algumas telas usam 600) */
  weight?: 500 | 600 | 700;
}

export function Badge({ tone = 'neutral', size = 'md', weight = 700, className, ...rest }: BadgeProps) {
  return <span className={cx(s.badge, s[tone], s[size], s[`w${weight}`], className)} {...rest} />;
}
