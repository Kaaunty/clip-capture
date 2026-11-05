import React from 'react';
import { cx } from './cx';
import s from './Card.module.css';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'header';
  radius?: 10 | 12 | 14 | 16;
  padding?: 0 | 16 | 24 | 28 | 32;
  bordered?: boolean;
  shadow?: 'none' | 'xs' | 'sm' | 'card' | 'md';
}

export function Card({
  as: Tag = 'div',
  radius = 16,
  padding = 28,
  bordered = true,
  shadow = 'card',
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx(s.card, s[`r${radius}`], s[`p${padding}`], s[`sh_${shadow}`], bordered && s.bordered, className)}
      {...rest}
    />
  );
}
