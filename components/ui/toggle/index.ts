import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { getComponentSizeClasses } from '@/lib/tokens';

export { default as Toggle } from './Toggle.vue';

export const toggleVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap box-border rounded-md font-medium font-[inherit] ring-offset-background transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:hover:bg-accent data-[state=on]:hover:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer appearance-none m-0',
  {
    variants: {
      variant: {
        default: 'border border-transparent bg-transparent',
        outline:
          'border border-input bg-transparent shadow-sm hover:bg-muted hover:text-muted-foreground',
      },
      size: {
        default: getComponentSizeClasses('default', 'base'),
        sm: getComponentSizeClasses('sm', 'base'),
        lg: getComponentSizeClasses('lg', 'base'),
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ToggleVariants = VariantProps<typeof toggleVariants>;
