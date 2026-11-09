import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { getComponentSizeClasses } from '@/lib/tokens';

export { default as Input } from './Input.vue';

export const inputVariants = cva(
  'flex w-full box-border rounded-md border border-input bg-background font-[inherit] text-foreground shadow-sm placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none m-0',
  {
    variants: {
      size: {
        default: getComponentSizeClasses('default', 'input'),
        sm: getComponentSizeClasses('sm', 'input'),
        lg: getComponentSizeClasses('lg', 'input'),
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

export type InputVariants = VariantProps<typeof inputVariants>;
