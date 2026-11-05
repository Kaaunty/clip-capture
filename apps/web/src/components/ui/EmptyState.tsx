import React from 'react';
import { cx } from './cx';
import s from './EmptyState.module.css';

export function EmptyState({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(s.empty, className)} {...rest} />;
}
