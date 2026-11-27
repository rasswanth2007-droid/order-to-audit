import { Badge, Icon } from "../ui";

export function StockPanel({ shortage = false }: { shortage?: boolean }) {
  return (
    <aside className="stock-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">LIVE INVENTORY</p>
          <h2>Stock check</h2>
        </div>
        <Badge tone={shortage ? "danger" : "success"}>{shortage ? "SHORTAGE" : "COVERED"}</Badge>
      </div>
      <div className="stock-product">
        <strong>Murukku 200 g</strong>
        <span>Finished goods</span>
      </div>
      <dl className="metrics">
        <div>
          <dt>Required</dt>
          <dd>120 packet</dd>
        </div>
        <div>
          <dt>On hand</dt>
          <dd>188 packet</dd>
        </div>
        <div>
          <dt>Committed to others</dt>
          <dd>100 packet</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>88 packet</dd>
        </div>
        <div className={shortage ? "shortage" : ""}>
          <dt>Shortage</dt>
          <dd>{shortage ? "32 packet" : "0 packet"}</dd>
        </div>
      </dl>
      {shortage && (
        <div className="produce-note">
          <Icon name="factory" />
          <div>
            <strong>Suggested production</strong>
            <span>Produce 1 batch</span>
          </div>
        </div>
      )}
      <p className="sync-note">
        <Icon name="refresh" size={14} /> Checked just now
      </p>
    </aside>
  );
}
