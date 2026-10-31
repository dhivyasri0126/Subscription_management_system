import { useId } from "react";

/* Wraps any input/select with a label and an error message.
   The control is passed as a render function so it gets the right id + aria props. */
export default function FormField({ label, error, children }) {
  const id = useId();
  const errId = `${id}-err`;

  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": error ? errId : undefined })}
      {error && (
        <span className="field-error" id={errId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}