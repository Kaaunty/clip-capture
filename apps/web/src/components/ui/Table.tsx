import React from 'react';
import { cx } from './cx';
import s from './Table.module.css';

export function Table({ className, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cx(s.table, className)} {...rest} />;
}

/** py: 10 (padrao) ou 12 -> padding `${py}px 14px` */
export function Th({
  py = 10,
  className,
  ...rest
}: { py?: 10 | 12 } & React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cx(s.th, s[`th${py}`], className)} {...rest} />;
}

/** py: 12 (padrao) ou 14 -> padding `${py}px 14px` */
export function Td({
  py = 12,
  className,
  ...rest
}: { py?: 12 | 14 } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx(s.td, s[`td${py}`], className)} {...rest} />;
}
