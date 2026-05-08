import * as React from 'react';
import { cn } from '@/src/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple/35 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] cursor-pointer';
    
    const variants = {
      primary: 'bg-kreatum-purple text-white hover:bg-kreatum-purple-dark shadow-[0_12px_28px_-18px_rgba(162,84,156,0.75)]',
      secondary: 'bg-white/[0.85] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] text-kreatum-dark dark:text-white/90 hover:border-kreatum-purple/25',
      outline: 'border border-black/10 dark:border-white/10 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] text-kreatum-gray dark:text-white/70 hover:text-kreatum-dark dark:hover:text-white',
      ghost: 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05] text-kreatum-gray dark:text-white/60 hover:text-kreatum-dark dark:hover:text-white',
      danger: 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15 border border-red-500/20',
    };

    const sizes = {
      sm: 'h-9 px-4',
      md: 'h-11 px-6',
      lg: 'h-14 px-10 text-base',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
