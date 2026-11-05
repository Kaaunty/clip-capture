import React from 'react';
import { cx } from './cx';
import s from './Alert.module.css';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  /** error: 13px, 10px 14px, raio 8. warning: banner 14px/600, 14px 18px, raio 10, flex gap 10. */
  tone?: 'error' | 'warning';
}

export function Alert({ tone = 'error', className, ...rest }: AlertProps) {
  return <div role={tone === 'error' ? 'alert' : undefined} className={cx(s.alert, s[tone], className)} {...rest} />;
}
