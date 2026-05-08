import * as React from 'react';
import { cn } from '@/src/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "flex min-h-[100px] w-full rounded-xl border border-black/10 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] px-4 py-3 text-sm font-medium leading-relaxed text-kreatum-dark dark:text-white/90 placeholder:text-kreatum-gray/45 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-kreatum-purple/25 focus:border-kreatum-purple/45 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-200",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';
