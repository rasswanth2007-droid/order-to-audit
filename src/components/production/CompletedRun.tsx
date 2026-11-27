import { Icon } from "../ui";

export function CompletedRun() {
  return (
    <div className="completed">
      <span className="completed-icon">
        <Icon name="check" size={28} />
      </span>
      <h3>Production recorded</h3>
      <p>188 good packets were added to finished stock.</p>
      <dl>
        <div>
          <dt>Batch number</dt>
          <dd>MUR-261127-01</dd>
        </div>
        <div>
          <dt>Expiry date</dt>
          <dd>26-May-2027</dd>
        </div>
      </dl>
    </div>
  );
}
