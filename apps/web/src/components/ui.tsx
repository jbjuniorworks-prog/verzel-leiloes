import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, RotateCw, XCircle } from 'lucide-react';
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { errorMessage } from '../lib/api';

/* ------------------------------------------------------------------ Button */

const BUTTON_VARIANTS = {
  primary: 'bg-amber-500 text-stone-950 hover:bg-amber-400 shadow-sm shadow-amber-900/10',
  strong: 'bg-stone-900 text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white',
  secondary:
    'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800',
  ghost: 'text-stone-700 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-500',
} as const;

// `icon`: botão quadrado só com ícone (sem padding horizontal, que espremeria o ícone).
const BUTTON_SIZES = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base', icon: 'size-9 text-sm' } as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  loading?: boolean;
}

export function buttonClass(variant: keyof typeof BUTTON_VARIANTS = 'primary', size: keyof typeof BUTTON_SIZES = 'md', className?: string) {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
}

export function Button({ variant = 'primary', size = 'md', loading, disabled, className, children, ...props }: ButtonProps) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- Card/Badge */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900', className)}>{children}</div>;
}

const BADGE_TONES = {
  neutral: 'bg-stone-100 text-stone-700 ring-stone-300/60 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700',
  live: 'bg-rose-50 text-rose-700 ring-rose-300/60 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-800',
  info: 'bg-sky-50 text-sky-700 ring-sky-300/60 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-800',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-300/60 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800',
  warning: 'bg-amber-50 text-amber-800 ring-amber-300/60 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-800',
  danger: 'bg-rose-50 text-rose-700 ring-rose-300/60 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-800',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({ tone = 'neutral', className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- Alert */

const ALERT_TONES = {
  info: { className: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100', Icon: Info },
  success: {
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100',
    Icon: CheckCircle2,
  },
  warning: {
    className: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100',
    Icon: AlertTriangle,
  },
  danger: { className: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100', Icon: XCircle },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  role,
}: {
  tone?: keyof typeof ALERT_TONES;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}) {
  const { className: toneClass, Icon } = ALERT_TONES[tone];
  return (
    <div role={role} className={clsx('flex gap-3 rounded-xl border p-3 text-sm', toneClass, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed opacity-90">{children}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Forms */

export const inputClass =
  'h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={clsx(inputClass, className)} {...props} />;
});

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      ) : (
        hint && <p className="text-xs text-stone-500 dark:text-stone-400">{hint}</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Feedback */

export function Spinner({ className, label = 'Carregando...' }: { className?: string; label?: string }) {
  return (
    <div role="status" className={clsx('flex items-center justify-center gap-2 py-10 text-sm text-stone-500', className)}>
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 px-6 py-14 text-center dark:border-stone-700">
      {icon && <div className="text-stone-400">{icon}</div>}
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="max-w-md text-sm text-stone-500 dark:text-stone-400">{children}</div>}
    </div>
  );
}

/** Falha ao carregar uma tela (rede, servidor fora): explica e oferece tentar de novo. */
export function LoadError({ title = 'Não foi possível carregar', error, onRetry }: { title?: string; error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState icon={<AlertTriangle className="size-8" />} title={title}>
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw className="size-4" /> Tentar de novo
        </Button>
      )}
    </EmptyState>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('rounded-lg bg-stone-200 motion-safe:animate-pulse dark:bg-stone-800', className)} />;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        {eyebrow && <p className="text-xs font-semibold tracking-[0.2em] text-amber-600 uppercase dark:text-amber-400">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-semibold tracking-tight wrap-anywhere sm:text-4xl">{title}</h1>
        {description && <p className="max-w-2xl text-stone-600 dark:text-stone-400">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- Modal */

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/60 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
    >
      <div className="space-y-4 p-6">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
