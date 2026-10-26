import "./Wordmark.css";

/** El nombre de la app sobre fondo claro: "Git" en peso medio y "Sight" en negrita. */
export default function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark${className ? ` ${className}` : ""}`}>
      <span className="wordmark__git">Git</span>
      <span className="wordmark__sight">Sight</span>
    </span>
  );
}
