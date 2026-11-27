import { Icon } from "./Icon";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "light" : ""}`}>
      <span>
        <Icon name="factory" />
      </span>
      <div>
        <strong>Annam Foods</strong>
        <small>Factory operations</small>
      </div>
    </div>
  );
}
