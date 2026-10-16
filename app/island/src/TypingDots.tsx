/** Three dots that pulse in place: something is being written. */
export function TypingDots() {
  return (
    <span className="dots" aria-label="Writing">
      <span style={{ animationDelay: "0s" }} />
      <span style={{ animationDelay: "-0.17s" }} />
      <span style={{ animationDelay: "-0.34s" }} />
    </span>
  );
}
