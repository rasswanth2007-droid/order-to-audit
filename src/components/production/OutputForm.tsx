import { Button, Icon } from "../ui";

export function OutputForm({ onComplete }: { onComplete: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onComplete();
      }}
    >
      <div className="field-grid">
        <label>
          <span>
            Good packets <b>*</b>
          </span>
          <input defaultValue="188" inputMode="numeric" />
          <small>Packets accepted into finished stock</small>
        </label>
        <label>
          <span>
            Rejected packets <b>*</b>
          </span>
          <input defaultValue="6" inputMode="numeric" />
          <small>Packets not accepted as finished goods</small>
        </label>
        <label>
          <span>
            Manufacturing date <b>*</b>
          </span>
          <input type="date" defaultValue="2026-11-27" />
        </label>
      </div>
      <h3>Packaging used</h3>
      <div className="form-table compact">
        <div className="form-row">
          <div>
            <strong>Printed pouch · 200 g</strong>
            <span>PACK-POUCH-200</span>
          </div>
          <label>
            <span>Quantity</span>
            <div className="input-unit">
              <input defaultValue="188" />
              <select>
                <option>pcs</option>
              </select>
            </div>
          </label>
        </div>
        <div className="form-row">
          <div>
            <strong>Shipping carton</strong>
            <span>PACK-CARTON-20</span>
          </div>
          <label>
            <span>Quantity</span>
            <div className="input-unit">
              <input defaultValue="9" />
              <select>
                <option>pcs</option>
              </select>
            </div>
          </label>
        </div>
      </div>
      <h3>Wastage</h3>
      <div className="waste-row">
        <label>
          <span>Item</span>
          <select>
            <option>Printed pouch · 200 g</option>
          </select>
        </label>
        <label>
          <span>Quantity</span>
          <input defaultValue="6" />
        </label>
        <label>
          <span>Unit</span>
          <select>
            <option>pcs</option>
          </select>
        </label>
        <label>
          <span>Reason</span>
          <input defaultValue="Damaged pouches" />
        </label>
      </div>
      <div className="form-footer">
        <p>
          <Icon name="warning" size={16} /> Stock changes only after confirmation.
        </p>
        <Button type="submit">Complete run</Button>
      </div>
    </form>
  );
}
