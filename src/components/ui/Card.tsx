import * as React from 'react';
import { cn } from '@/src/lib/utils';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-[30px] backdrop-blur-xl transition-all duration-500",
        "bg-white/80 border border-black/5 shadow-sm",
        "dark:bg-[#13111C]/95 dark:bg-gradient-to-br dark:from-[#2e2645]/50 dark:to-[#13111C]/90 dark:border-white/[0.08] dark:shadow-[0_15px_40px_-10px_rgba(0,0,0,0.8)]",
        "dark:ring-1 dark:ring-white/[0.02]",
        "hover:dark:border-white/[0.15] hover:dark:shadow-[0_20px_50px_-10px_rgba(0,0,0,0.9)] hover:dark:bg-[#161421]/95",
        className
      )}
      {...props}
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-kreatum-purple/[0.1] via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-8 py-6 border-b border-black/5 dark:border-white/[0.06] relative z-10 transition-colors flex-shrink-0", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-2xl font-light tracking-tighter text-kreatum-dark dark:text-white/90 font-serif transition-colors", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-8 relative z-10 flex-1 text-kreatum-dark/80 dark:text-white/80", className)} {...props} />;
}
