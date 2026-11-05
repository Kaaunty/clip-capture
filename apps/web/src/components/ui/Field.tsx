import React from 'react';
import { cx } from './cx';
import s from './Field.module.css';

export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** espacamento inferior: md 16px, sm 14px */
  spacing?: 'md' | 'sm';
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, spacing = 'md', className, children }: FieldProps) {
  return (
    <div className={cx(s.field, s[`sp_${spacing}`], className)}>
      {label && <label className={s.label}>{label}</label>}
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
}

/** size md: padding 10px 12px / raio 8. sm: padding 8px 12px / raio 6. */
type Size = { size?: 'md' | 'sm' };

export function Input({ size = 'md', className, ...rest }: Size & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>) {
  return <input className={cx(s.control, s[size], className)} {...rest} />;
}

export function Select({ size = 'md', className, ...rest }: Size & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'>) {
  return <select className={cx(s.control, s[size], className)} {...rest} />;
}
