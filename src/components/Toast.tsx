interface Props {
  message: string | null;
}

export function Toast({ message }: Props) {
  return (
    <div className={`toast ${message ? "show" : ""}`}>
      {message}
    </div>
  );
}