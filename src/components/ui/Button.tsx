import * as React from 'react';
import { cn } from '@/src/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center rounded-xl text-[10px] uppercase tracking-[0.2em] font-black transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple/50 disabled:opacity-50 disabled:pointer-events-none ring-offset-transparent active:scale-[0.98] hover:-translate-y-0.5';
    
    const variants = {
      primary: 'bg-kreatum-purple text-white hover:bg-kreatum-purple-dark shadow-[0_4px_20px_rgba(162,84,156,0.3)] hover:shadow-[0_8px_30px_rgba(162,84,156,0.5)] dark:bg-kreatum-purple dark:hover:bg-[#b55bb0] dark:shadow-[0_0_20px_rgba(162,84,156,0.3)] dark:hover:shadow-[0_0_40px_rgba(162,84,156,0.6)]',
      secondary: 'bg-black/5 dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] text-kreatum-dark dark:text-white/80 hover:bg-black/10 dark:hover:bg-white/[0.1] hover:border-black/20 dark:hover:border-white/[0.15] backdrop-blur-3xl dark:hover:text-white shadow-sm dark:shadow-[0_4px_15px_rgba(0,0,0,0.2)] dark:hover:shadow-[0_8px_25px_rgba(0,0,0,0.4)]',
      outline: 'border border-black/10 dark:border-white/[0.15] hover:bg-black/5 dark:hover:bg-white/[0.04] text-kreatum-gray dark:text-white/60 hover:text-kreatum-dark dark:hover:text-white/90',
      ghost: 'hover:bg-black/5 dark:hover:bg-white/[0.06] text-kreatum-gray dark:text-white/60 hover:text-kreatum-dark dark:hover:text-white/90',
      danger: 'bg-red-500/10 dark:bg-red-500/[0.15] text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-500/[0.25] border border-red-500/20 dark:border-red-500/30',
    };

    const sizes = {
      sm: 'h-9 px-4',
      md: 'h-12 py-2 px-6',
      lg: 'h-14 px-8 text-xs',
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
