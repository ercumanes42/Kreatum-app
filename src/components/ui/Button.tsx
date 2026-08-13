import * as React from 'react';
import { cn } from '@/src/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-kreatum-bg-dark disabled:cursor-not-allowed disabled:shadow-none active:scale-[0.98] cursor-pointer';
    
    const variants = {
      primary: 'bg-[linear-gradient(135deg,#8F3F87_0%,#74316E_100%)] text-white hover:brightness-[1.06] disabled:bg-[#6B2E65] disabled:hover:brightness-100 shadow-[0_14px_30px_-19px_rgba(117,49,110,0.9)] hover:shadow-[0_18px_36px_-20px_rgba(117,49,110,0.9)]',
      secondary: 'bg-white/[0.9] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] text-kreatum-dark dark:text-white/90 hover:border-kreatum-purple/25 hover:bg-white shadow-[0_10px_24px_-20px_rgba(16,47,64,0.45)]',
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
