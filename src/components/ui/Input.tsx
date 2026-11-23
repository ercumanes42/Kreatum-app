import * as React from 'react';
import { cn } from '@/src/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    const assistWriting = !props.type || props.type === 'text' || props.type === 'search';
    return (
      <input
        ref={ref}
        lang={props.lang ?? (assistWriting ? 'es' : undefined)}
        spellCheck={props.spellCheck ?? assistWriting}
        autoCapitalize={props.autoCapitalize ?? (assistWriting ? 'sentences' : undefined)}
        autoCorrect={props.autoCorrect ?? (assistWriting ? 'on' : undefined)}
        className={cn(
          "flex h-12 w-full rounded-xl border border-black/[0.09] dark:border-white/[0.09] bg-white/[0.96] dark:bg-white/[0.045] px-4 py-2 text-sm font-medium text-kreatum-dark dark:text-white/90 placeholder:text-kreatum-gray/55 dark:placeholder:text-white/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] hover:border-black/[0.16] dark:hover:border-white/[0.16] focus:outline-none focus:ring-2 focus:ring-kreatum-purple/20 focus:border-kreatum-purple/55 disabled:cursor-not-allowed disabled:opacity-50 transition-[color,background-color,border-color,box-shadow] duration-200",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
