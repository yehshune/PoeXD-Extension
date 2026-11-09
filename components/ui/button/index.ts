import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { getComponentSizeClasses } from '@/lib/tokens';

export { default as Button } from './Button.vue';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap box-border border-solid rounded-md font-medium font-[inherit] ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 appearance-none m-0 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-border bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive:
          'border border-border bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary:
          'border border-border bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost:
          'text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-[pressed=true]:bg-primary aria-[pressed=true]:text-primary-foreground aria-[pressed=true]:hover:bg-primary/90',
        'ghost-destructive': 'text-muted-foreground hover:bg-transparent hover:text-destructive',
        accent:
          'border border-primary bg-accent text-accent-foreground shadow-sm hover:bg-accent/80 font-bold',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: getComponentSizeClasses('default', 'button'),
        sm: getComponentSizeClasses('sm', 'button'),
        lg: getComponentSizeClasses('lg', 'button'),
        icon: getComponentSizeClasses('default', 'icon-button'),
        'icon-sm': getComponentSizeClasses('sm', 'icon-button'),
        'icon-lg': getComponentSizeClasses('lg', 'icon-button'),
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
