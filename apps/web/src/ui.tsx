import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Check, CircleAlert, CircleDot, Moon, Sun, X, type LucideIcon } from "lucide-react";

/* --------------------------------------------------------------- Icon */
export function Icon({ icon: C, size = 18 }: { icon: LucideIcon; size?: number }) {
  return <C size={size} strokeWidth={1.75} aria-hidden="true" />;
}

/* -------------------------------------------------------------- Button */
type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", icon: IconC, children, className, ...rest },
  ref,
) {
  return (
    <button ref={ref} className={`btn btn-${variant} ${className ?? ""}`} {...rest}>
      {IconC ? <Icon icon={IconC} size={16} /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button className="iconbtn" aria-label={label} title={label} {...rest}>
      <Icon icon={icon} size={18} />
    </button>
  );
}

export function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return <IconButton icon={theme === "light" ? Moon : Sun} label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"} onClick={onToggle} />;
}

/* -------------------------------------------------------------- Inputs */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string }>(
  function Input({ label, id, className, ...rest }, ref) {
    const input = <input ref={ref} id={id} className={`input ${className ?? ""}`} {...rest} />;
    if (!label) return input;
    return (
      <label className="field" htmlFor={id}>
        <span className="field-label">{label}</span>
        {input}
      </label>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }>(
  function Textarea({ label, id, className, ...rest }, ref) {
    const area = <textarea ref={ref} id={id} className={`input ${className ?? ""}`} {...rest} />;
    if (!label) return area;
    return (
      <label className="field" htmlFor={id}>
        <span className="field-label">{label}</span>
        {area}
      </label>
    );
  },
);

/* --------------------------------------------------------- Chip / Badge */
export function Chip({ selected, children }: { selected?: boolean; children: ReactNode }) {
  return <span className={`chip ${selected ? "chip-selected" : ""}`}>{children}</span>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning" | "danger" | "info" | "ai"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/* ------------------------------------------------------------- TaskRow */
export interface TaskRowProps {
  title: string;
  meta?: string;
  status?: "not_started" | "in_progress" | "blocked" | "completed";
  titleNode?: ReactNode;
  onClick?: () => void;
}

export function TaskRow({ title, meta, status = "not_started", titleNode, onClick }: TaskRowProps) {
  const statusIcon =
    status === "completed" ? (
      <Check size={15} strokeWidth={2.5} />
    ) : status === "blocked" ? (
      <CircleAlert size={15} />
    ) : status === "in_progress" ? (
      <CircleDot size={15} />
    ) : (
      <span className="task-circle" />
    );
  return (
    <div className="task-row" onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      <span className={`task-status task-${status}`}>{statusIcon}</span>
      <span className="task-title">{titleNode ?? title}</span>
      {meta ? <span className="task-meta">{meta}</span> : null}
    </div>
  );
}

/* --------------------------------------------------------------- States */
export function Skeleton({ rows = 4, kind = "row" }: { rows?: number; kind?: "row" | "card" }) {
  return (
    <div className={`skeleton-list skeleton-${kind}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner-mini" aria-label="Loading" />;
}

export function EmptyState({ icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon icon={icon} size={22} />
      </div>
      <div className="empty-title">{title}</div>
      {hint ? <div className="empty-hint">{hint}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message = "We couldn't load this.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon icon={CircleAlert} size={22} />
      </div>
      <div className="empty-title">{message}</div>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- Layout */
export function Container({ children, width = "normal" }: { children: ReactNode; width?: "narrow" | "normal" | "wide" }) {
  return <div className={`container container-${width}`}>{children}</div>;
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="section">
      {title ? <h3 className="section-title">{title}</h3> : null}
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className ?? ""}`}>{children}</div>;
}

/* ---------------------------------------------------------- Overlays */
export function Drawer({ open, onClose, title, children, width = 520 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div className="drawer" style={{ width }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="drawer-head">
          <h3>{title}</h3>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Toast */
export interface ToastData {
  id: string;
  message: string;
}

export function Toast({ toast, onClose }: { toast: ToastData; onClose: (id: string) => void }) {
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      <IconButton icon={X} label="Dismiss" onClick={() => onClose(toast.id)} />
    </div>
  );
}