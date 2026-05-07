import * as React from 'react';
import { cn } from '@/src/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center rounded-2xl text-[10px] uppercase tracking-widest font-bold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple/50 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.97] hover:-translate-y-0.5 cursor-pointer';
    
    const variants = {
      primary: 'bg-kreatum-purple text-white hover:bg-kreatum-purple-dark shadow-lg shadow-kreatum-purple/20 hover:shadow-xl hover:shadow-kreatum-purple/40',
      secondary: 'glass-card bg-white/10 dark:bg-white/5 border-white/20 text-kreatum-dark dark:text-white/90 hover:bg-white/20 dark:hover:bg-white/10 shadow-sm',
      outline: 'border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-kreatum-gray dark:text-white/70 hover:text-kreatum-dark dark:hover:text-white',
      ghost: 'hover:bg-black/5 dark:hover:bg-white/5 text-kreatum-gray dark:text-white/60 hover:text-kreatum-dark dark:hover:text-white',
      danger: 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 border border-red-500/20',
    };

    const sizes = {
      sm: 'h-9 px-4',
      md: 'h-11 px-6',
      lg: 'h-14 px-10 text-[11px]',
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
