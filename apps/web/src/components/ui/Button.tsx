import React from 'react';
import { cx } from './cx';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'dangerOutline' | 'ghost';
export type ButtonSize = 'md' | 'sm' | 'xs';

interface BaseProps {
  variant?: ButtonVariant;
  /** md: 10px 18px/14px/r8. sm: 6px 12px/13px/r6. xs: 4px 8px/12px/r6. */
  size?: ButtonSize;
  loading?: boolean;
  /** sombra colorida (primary/danger) */
  elevated?: boolean;
  className?: string;
}

export type ButtonProps =
  | (BaseProps & { as?: 'button' } & React.ButtonHTMLAttributes<HTMLButtonElement>)
  | (BaseProps & { as: 'a'; href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>);

export function Button(props: ButtonProps) {
  const { variant = 'primary', size = 'md', loading = false, elevated = false, className, ...rest } = props as any;
  const cls = cx(s.button, s[variant], s[size], elevated && s.elevated, loading && s.loading, className);

  if (props.as === 'a') {
    const { as: _as, ...anchor } = rest;
    return <a className={cx(cls, s.link)} {...anchor} />;
  }
  const { as: _as, disabled, type = 'button', ...button } = rest;
  return (
    <button
      className={cls}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...button}
    />
  );
}
