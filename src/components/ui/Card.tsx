import * as React from 'react';
import { cn } from '@/src/lib/utils';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "glass-card group relative flex h-full flex-col overflow-hidden rounded-2xl transition-colors duration-200",
        "hover:border-kreatum-purple/25",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-5 border-b border-black/[0.06] dark:border-white/[0.07] relative z-10 transition-colors flex-shrink-0", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lg font-bold tracking-normal text-kreatum-dark dark:text-white/95 transition-colors", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 relative z-10 flex-1 text-kreatum-dark/80 dark:text-white/80", className)} {...props} />;
}
