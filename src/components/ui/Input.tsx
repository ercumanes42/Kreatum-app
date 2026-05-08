import * as React from 'react';
import { cn } from '@/src/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-12 w-full rounded-xl border border-black/10 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] px-4 py-2 text-sm font-medium text-kreatum-dark dark:text-white/90 placeholder:text-kreatum-gray/45 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-kreatum-purple/25 focus:border-kreatum-purple/45 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-200",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
