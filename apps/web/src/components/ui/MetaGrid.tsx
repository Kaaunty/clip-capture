import React from 'react';
import { cx } from './cx';
import s from './MetaGrid.module.css';

export interface MetaGridProps extends React.HTMLAttributes<HTMLDivElement> {
  minColumn?: 220 | 200;
}

export function MetaGrid({ minColumn = 220, className, ...rest }: MetaGridProps) {
  return <div className={cx(s.grid, s[`c${minColumn}`], className)} {...rest} />;
}

export interface MetaItemProps {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function MetaItem({ label, children, className }: MetaItemProps) {
  return (
    <div className={cx(s.item, className)}>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{children}</span>
    </div>
  );
}
