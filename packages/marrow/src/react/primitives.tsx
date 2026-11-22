// The internal controls of marrow/react (design section 6: not exported from the package). They
// are real DOM elements: a button, radio inputs, a range input and a polite live line. Every
// piece of text and every accessible name comes in as a prop, taken from MarrowCopy by the
// caller. The look comes from marrow.css, which holds the --marrow-* custom properties.
import { useId, type ReactNode } from 'react';
import './marrow.css';

export interface PanelProps {
  /** Accessible name of the region. */
  label: string;
  children: ReactNode;
}

export function Panel({ label, children }: PanelProps) {
  return (
    <section aria-label={label} className="marrow-panel">
      {children}
    </section>
  );
}

export interface ButtonProps {
  children: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export function Button({ children, onClick, variant = 'secondary', disabled = false }: ButtonProps) {
  const className = variant === 'primary' ? 'marrow-button marrow-button--primary' : 'marrow-button';
  return (
    <button type="button" className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: string;
}

export interface RadioGroupProps<T extends string> {
  /** Text of the group's legend, which is its accessible name. */
  legend: string;
  /** The name shared by the radio inputs of this group. */
  name: string;
  options: readonly RadioOption<T>[];
  /** The chosen value, or null for none. */
  value: T | null;
  onChange: (value: T) => void;
}

export function RadioGroup<T extends string>({ legend, name, options, value, onChange }: RadioGroupProps<T>) {
  return (
    <fieldset className="marrow-choices">
      <legend>{legend}</legend>
      {options.map((option) => (
        <RadioChoice
          key={option.value}
          name={name}
          option={option}
          checked={option.value === value}
          onChange={onChange}
        />
      ))}
    </fieldset>
  );
}

function RadioChoice<T extends string>({
  name,
  option,
  checked,
  onChange,
}: {
  name: string;
  option: RadioOption<T>;
  checked: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="marrow-choice">
      <input
        id={id}
        type="radio"
        name={name}
        value={option.value}
        checked={checked}
        onChange={() => onChange(option.value)}
      />
      <label htmlFor={id}>{option.label}</label>
    </div>
  );
}

export interface SliderProps {
  label: string;
  min: number;
  max: number;
  /** A number, or 'any' for a continuous range. */
  step: number | 'any';
  value: number;
  onChange: (value: number) => void;
}

export function Slider({ label, min, max, step, value, onChange }: SliderProps) {
  const id = useId();
  return (
    <div className="marrow-choice">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        className="marrow-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

export interface InstructionLineProps {
  text: string;
}

/** The current instruction. Its text changes as the player moves on, and the change is announced politely. */
export function InstructionLine({ text }: InstructionLineProps) {
  return (
    <p className="marrow-instruction" aria-live="polite">
      {text}
    </p>
  );
}
