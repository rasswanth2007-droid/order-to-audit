import { Button } from "../ui";

export function MaterialRows() {
  return (
    <>
      <div className="form-table">
        {[
          ["Flour", "40", "kg"],
          ["Oil", "10.5", "l"],
          ["Spice mix", "1.2", "kg"],
        ].map(([name, qty, unit]) => (
          <div className="form-row" key={name}>
            <div>
              <strong>{name}</strong>
              <span>
                Planned {qty} {unit}
              </span>
            </div>
            <label>
              <span>Actual issued</span>
              <div className="input-unit">
                <input defaultValue={qty} inputMode="decimal" />
                <select defaultValue={unit}>
                  <option>{unit}</option>
                </select>
              </div>
            </label>
          </div>
        ))}
      </div>
      <div className="form-footer">
        <Button>Issue materials</Button>
      </div>
    </>
  );
}
