import "./Spinner.scss";

export interface SpinnerProps {
  /**
   * Any CSS length. Default is 1.5rem.
   */
  size?: string;
  label?: string;
}

export default function Spinner(props: SpinnerProps) {
  const { size = "1.5rem", label } = props;
  return <span className="cn-spinner" style={{ width: size, height: size }} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
