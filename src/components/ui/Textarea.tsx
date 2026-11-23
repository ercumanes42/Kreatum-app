import * as React from 'react';
import { cn } from '@/src/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        lang={props.lang ?? 'es'}
        spellCheck={props.spellCheck ?? true}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        autoCorrect={props.autoCorrect ?? 'on'}
        className={cn(
          "flex min-h-[100px] w-full rounded-xl border border-black/[0.09] dark:border-white/[0.09] bg-white/[0.96] dark:bg-white/[0.045] px-4 py-3 text-sm font-medium leading-relaxed text-kreatum-dark dark:text-white/90 placeholder:text-kreatum-gray/45 dark:placeholder:text-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] hover:border-black/[0.16] dark:hover:border-white/[0.16] focus:outline-none focus:ring-2 focus:ring-kreatum-purple/20 focus:border-kreatum-purple/55 disabled:cursor-not-allowed disabled:opacity-50 transition-[color,background-color,border-color,box-shadow] duration-200",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';
