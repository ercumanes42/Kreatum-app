import * as React from 'react';
import { cn } from '@/src/lib/utils';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "glass-card group relative flex h-full flex-col overflow-hidden rounded-[32px] transition-all duration-300",
        "dark:bg-gradient-to-br dark:from-white/[0.05] dark:to-transparent",
        "hover:shadow-2xl hover:shadow-kreatum-purple/10 hover:border-kreatum-purple/30",
        className
      )}
      {...props}
    >
      {/* Subtle brand glow on hover */}
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-kreatum-purple/[0.05] via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-8 py-6 border-b border-black/5 dark:border-white/[0.06] relative z-10 transition-colors flex-shrink-0", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-2xl font-medium tracking-tight text-kreatum-dark dark:text-white/95 font-serif transition-colors", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-8 relative z-10 flex-1 text-kreatum-dark/80 dark:text-white/80", className)} {...props} />;
}
