interface NoticeProps {
  type: "success" | "error";
  message: string;
  onDismiss?: () => void;
}

export function Notice({ type, message, onDismiss }: NoticeProps) {
  return (
    <div className={`notice notice-${type}`} role="alert">
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className="notice-dismiss" onClick={onDismiss} aria-label="Fermer">
          ×
        </button>
      )}
    </div>
  );
}
