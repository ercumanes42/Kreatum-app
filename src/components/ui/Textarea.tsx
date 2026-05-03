import * as React from 'react';
import { cn } from '@/src/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "flex min-h-[100px] w-full rounded-2xl border border-black/10 dark:border-white/[0.08] bg-black/5 dark:bg-black/40 px-5 py-4 text-sm text-kreatum-dark dark:text-white/90 placeholder:text-kreatum-gray/50 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-kreatum-purple/50 dark:focus:ring-kreatum-purple/30 focus:border-kreatum-purple/50 dark:focus:border-kreatum-purple/60 focus:bg-white dark:focus:bg-[#0c0c0e]/80 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-300 font-mono shadow-sm dark:shadow-inner",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';
