import { Icon, type IconName } from "./Icon";
import { useT } from "@/utils/i18n";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconName;
};

export function Button({
  children,
  variant = "primary",
  icon,
  className = "",
  ...props
}: ButtonProps) {
  const tr = useT();
  const content = typeof children === "string" ? tr(children) : children;
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {icon && <Icon name={icon} />}
      {content}
    </button>
  );
}
